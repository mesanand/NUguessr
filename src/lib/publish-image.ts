// Image processing shared by the admin curation UI (server actions) and
// scripts/places/publish.ts. Plain Node only: no Next.js / server-only imports.
//
// Every published photo goes through processImage():
//   1. .rotate()  — apply the EXIF orientation to the pixels FIRST, so the
//                   image still looks right once the metadata is gone
//   2. resize to fit inside 2000x2000 (never enlarge)
//   3. WebP q82
// sharp drops ALL metadata (EXIF incl. GPS, XMP, IPTC, ICC) unless
// withMetadata/keepExif/keepIccProfile/withExif is called — never call them
// here: the GPS tag is the answer to the round.

import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

import sharp from "sharp"

export const USER_AGENT = "NUguessr/1.0 (github.com/mesanand/NUguessr)"
export const MAX_DIMENSION = 2000
export const WEBP_QUALITY = 82
export const IMAGES_BUCKET = "images"

export type ProcessedImage = { buffer: Buffer; width: number; height: number }

/** Crop rectangle as fractions (0..1) of the auto-oriented image. */
export type CropFractions = { left: number; top: number; width: number; height: number }

/**
 * Blur rectangles (fractions of the image AFTER cropping) — used to hide small
 * readable text that names the place (a nameplate, an address number, a
 * distant station sign) without throwing the whole photo away.
 */
async function redactRegions(input: Buffer, regions: CropFractions[]): Promise<Buffer> {
  const oriented = await sharp(input, { failOn: "error" }).rotate().toBuffer({ resolveWithObject: true })
  const { width: W, height: H } = oriented.info
  const overlays: sharp.OverlayOptions[] = []
  for (const r of regions) {
    const left = Math.max(0, Math.floor(r.left * W))
    const top = Math.max(0, Math.floor(r.top * H))
    const width = Math.max(8, Math.min(W - left, Math.ceil(r.width * W)))
    const height = Math.max(8, Math.min(H - top, Math.ceil(r.height * H)))
    // Pixelate (downscale hard, upscale back) then blur: text can't be recovered.
    const block = Math.max(2, Math.round(Math.min(width, height) / 6))
    const patch = await sharp(oriented.data)
      .extract({ left, top, width, height })
      .resize(Math.max(1, Math.round(width / block)), Math.max(1, Math.round(height / block)), { kernel: "nearest" })
      .resize(width, height, { kernel: "cubic" })
      .blur(Math.max(3, block / 2))
      .toBuffer()
    overlays.push({ input: patch, left, top })
  }
  return sharp(oriented.data).composite(overlays).toBuffer()
}

export async function processImage(
  input: Buffer,
  opts: { crop?: CropFractions | null; redact?: CropFractions[] | null } = {}
): Promise<ProcessedImage> {
  let source = input
  if (opts.crop) {
    // Orient first so the fractions refer to the image as displayed, then crop.
    const oriented = await sharp(input, { failOn: "error" }).rotate().toBuffer({ resolveWithObject: true })
    const { width: W, height: H } = oriented.info
    const c = opts.crop
    const left = Math.max(0, Math.round(c.left * W))
    const top = Math.max(0, Math.round(c.top * H))
    const width = Math.min(W - left, Math.round(c.width * W))
    const height = Math.min(H - top, Math.round(c.height * H))
    if (width < 200 || height < 200) throw new Error(`crop too small: ${width}x${height}`)
    source = await sharp(oriented.data).extract({ left, top, width, height }).toBuffer()
  }
  if (opts.redact?.length) source = await redactRegions(source, opts.redact)
  const { data, info } = await sharp(source, { failOn: "error" })
    .rotate()
    .resize({
      width: MAX_DIMENSION,
      height: MAX_DIMENSION,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: WEBP_QUALITY })
    .toBuffer({ resolveWithObject: true })

  return { buffer: data, width: info.width, height: info.height }
}

/** Random, meaningless object path: `<uuid>.webp` (optionally `prefix/<uuid>.webp`). */
export function newImagePath(prefix?: string): string {
  const name = `${randomUUID()}.webp`
  const clean = prefix?.replace(/^\/+|\/+$/g, "")
  return clean ? `${clean}/${name}` : name
}

/**
 * Throws if the buffer still carries EXIF/XMP/IPTC or any GPS tag.
 * Used by the publish self-test and post-upload verification.
 */
export async function assertNoMetadata(buffer: Buffer): Promise<void> {
  const meta = await sharp(buffer).metadata()
  const leftovers = (["exif", "xmp", "iptc"] as const).filter((k) => meta[k])
  if (leftovers.length) throw new Error(`metadata still present: ${leftovers.join(", ")}`)

  const exifr = (await import("exifr")).default
  const gps = await exifr.gps(buffer).catch(() => undefined)
  if (gps && (gps.latitude != null || gps.longitude != null)) {
    throw new Error("GPS coordinates still present")
  }
  const parsed = await exifr
    .parse(buffer, { gps: true, tiff: true, exif: true, xmp: true, iptc: true })
    .catch(() => undefined)
  if (parsed && Object.keys(parsed).some((k) => /gps|latitude|longitude/i.test(k))) {
    throw new Error("GPS tags still present")
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export type FetchImageOptions = {
  retries?: number
  /** Abort a single attempt after this many ms. */
  timeoutMs?: number
  /**
   * Allow file:// URLs (own photos). Scripts only — the admin server action
   * must never set this (it would let a candidate row read server files).
   */
  allowFile?: boolean
  /**
   * Extra exact origins (e.g. "http://127.0.0.1:54321") allowed besides the
   * image-host allowlist, http included. Scripts only (publish verification).
   */
  extraOrigins?: string[]
}

/** Max downloaded body size; larger responses are aborted mid-stream. */
export const MAX_IMAGE_BYTES = 40 * 1024 * 1024
const MAX_REDIRECTS = 3

/**
 * SSRF guard: http(s) image fetches may only go to these hosts (https only).
 * Wikimedia Commons (upload./thumb. etc.), Mapillary and its Facebook CDN.
 */
export function isAllowedImageHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, "")
  const under = (domain: string) => h === domain || h.endsWith(`.${domain}`)
  return under("wikimedia.org") || under("mapillary.com") || under("fbcdn.net")
}

function assertAllowedUrl(url: URL, extraOrigins: string[]): void {
  if (extraOrigins.includes(url.origin)) return
  if (url.protocol !== "https:") throw new Error(`refusing non-https image URL (${url.protocol}//${url.host})`)
  if (url.username || url.password) throw new Error("refusing image URL with credentials")
  if (url.port && url.port !== "443") throw new Error(`refusing image URL with port ${url.port}`)
  if (!isAllowedImageHost(url.hostname)) throw new Error(`image host not allowed: ${url.hostname}`)
}

/**
 * Download (https, allowlisted hosts) or read (file://, own photos, only with
 * allowFile) an image.
 * HEIC/HEIF own photos are converted to JPEG (via heic-convert) so sharp can
 * decode them without libheif's HEVC plugin.
 */
export async function fetchImage(url: string, opts: FetchImageOptions = {}): Promise<Buffer> {
  const { retries = 4, timeoutMs = 60_000, allowFile = false } = opts
  const extraOrigins = (opts.extraOrigins ?? []).map((o) => new URL(o).origin)
  const parsed = new URL(url)

  let buffer: Buffer
  if (parsed.protocol === "file:") {
    if (!allowFile) throw new Error("file:// image URLs are not allowed here")
    buffer = await readFile(fileURLToPath(parsed))
    if (buffer.length > MAX_IMAGE_BYTES) throw new Error(`image larger than ${MAX_IMAGE_BYTES} bytes`)
  } else if (parsed.protocol === "http:" || parsed.protocol === "https:") {
    assertAllowedUrl(parsed, extraOrigins)
    buffer = await fetchWithRetry(parsed.toString(), retries, timeoutMs, extraOrigins)
  } else {
    throw new Error(`unsupported image URL protocol: ${parsed.protocol}`)
  }

  if (isHeic(buffer)) buffer = await heicToJpeg(buffer)
  return buffer
}

class FatalFetchError extends Error {}

/** One request chain: manual redirects, every hop re-validated, body capped. */
async function fetchOnce(url: string, timeoutMs: number, extraOrigins: string[]): Promise<Response> {
  const signal = AbortSignal.timeout(timeoutMs)
  let current = new URL(url)
  for (let hop = 0; ; hop++) {
    const res = await fetch(current, {
      headers: { "User-Agent": USER_AGENT, "Api-User-Agent": USER_AGENT },
      signal,
      redirect: "manual",
    })
    if (res.status < 300 || res.status >= 400 || res.status === 304) return res
    await res.body?.cancel().catch(() => {})
    const location = res.headers.get("location")
    if (!location) throw new FatalFetchError(`HTTP ${res.status} redirect without Location`)
    if (hop >= MAX_REDIRECTS) throw new FatalFetchError(`too many redirects (> ${MAX_REDIRECTS})`)
    const next = new URL(location, current)
    try {
      assertAllowedUrl(next, extraOrigins)
    } catch (err) {
      throw new FatalFetchError(`redirect rejected: ${(err as Error).message}`)
    }
    current = next
  }
}

async function readCapped(res: Response): Promise<Buffer> {
  const declared = Number(res.headers.get("content-length"))
  if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) {
    await res.body?.cancel().catch(() => {})
    throw new FatalFetchError(`image larger than ${MAX_IMAGE_BYTES} bytes (content-length ${declared})`)
  }
  if (!res.body) return Buffer.alloc(0)
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_IMAGE_BYTES) {
      await reader.cancel().catch(() => {})
      throw new FatalFetchError(`image larger than ${MAX_IMAGE_BYTES} bytes`)
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks, total)
}

async function fetchWithRetry(url: string, retries: number, timeoutMs: number, extraOrigins: string[]): Promise<Buffer> {
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchOnce(url, timeoutMs, extraOrigins)
      if (res.ok) return await readCapped(res)

      await res.body?.cancel().catch(() => {})
      const retryable = res.status === 429 || res.status >= 500
      lastError = new Error(`HTTP ${res.status}`)
      if (!retryable) break
      if (attempt === retries) break
      const retryAfter = Number(res.headers.get("retry-after"))
      const wait =
        Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(retryAfter * 1000, 120_000)
          : Math.min(1000 * 2 ** attempt, 30_000)
      console.warn(`[fetchImage] HTTP ${res.status} from ${new URL(url).host}; retry ${attempt + 1}/${retries} in ${Math.round(wait / 1000)}s`)
      await sleep(wait)
    } catch (err) {
      lastError = err
      if (err instanceof FatalFetchError) break
      if (attempt === retries) break
      await sleep(Math.min(1000 * 2 ** attempt, 30_000))
    }
  }
  const host = new URL(url).host
  throw new Error(`failed to download image from ${host}: ${lastError instanceof Error ? lastError.message : String(lastError)}`)
}

function isHeic(buffer: Buffer): boolean {
  if (buffer.length < 12 || buffer.toString("ascii", 4, 8) !== "ftyp") return false
  const brand = buffer.toString("ascii", 8, 12)
  return ["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"].includes(brand)
}

type HeicConvert = (opts: { buffer: Buffer; format: "JPEG" | "PNG"; quality?: number }) => Promise<ArrayBuffer>

async function heicToJpeg(buffer: Buffer): Promise<Buffer> {
  // Optional dev dependency; only needed for own HEIC photos.
  const specifier = "heic-convert"
  const mod = (await import(/* webpackIgnore: true */ specifier)) as { default?: HeicConvert } & HeicConvert
  const convert: HeicConvert = mod.default ?? mod
  // heic-convert copies EXIF into the JPEG; processImage strips it again.
  return Buffer.from(await convert({ buffer, format: "JPEG", quality: 0.95 }))
}
