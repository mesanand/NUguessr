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

export async function processImage(
  input: Buffer,
  opts: { crop?: CropFractions | null } = {}
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
}

/**
 * Download (http/https) or read (file://, own photos) an image.
 * HEIC/HEIF own photos are converted to JPEG (via heic-convert) so sharp can
 * decode them without libheif's HEVC plugin.
 */
export async function fetchImage(url: string, opts: FetchImageOptions = {}): Promise<Buffer> {
  const { retries = 4, timeoutMs = 60_000 } = opts
  const parsed = new URL(url)

  let buffer: Buffer
  if (parsed.protocol === "file:") {
    buffer = await readFile(fileURLToPath(parsed))
  } else if (parsed.protocol === "http:" || parsed.protocol === "https:") {
    buffer = await fetchWithRetry(url, retries, timeoutMs)
  } else {
    throw new Error(`unsupported image URL protocol: ${parsed.protocol}`)
  }

  if (isHeic(buffer)) buffer = await heicToJpeg(buffer)
  return buffer
}

async function fetchWithRetry(url: string, retries: number, timeoutMs: number): Promise<Buffer> {
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, "Api-User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "follow",
      })
      if (res.ok) return Buffer.from(await res.arrayBuffer())

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
