// npm run places:publish -- [--dry-run] [--limit N] [--input data/selected.json] [--out data/publish] [--self-test]
//
// data/selected.json -> processed <uuid>.webp (metadata stripped) ->
//   storage bucket `images` + `places` row (upsert on source,source_id) ->
//   place_candidates.place_id/status = approved.
//
// Credentials (never printed):
//   SUPABASE_URL (preferred) or NEXT_PUBLIC_SUPABASE_URL, and SUPABASE_SERVICE_ROLE_KEY.
// Without a service key the images are still processed into data/publish/ and
// data/publish/places.sql is written for manual upload + SQL import.
//
// Idempotent / resumable: data/publish/published.json is rewritten after every
// item; anything already published (and, with a DB, present in `places`) is skipped.

import { existsSync } from "node:fs"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"

import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import exifr from "exifr"
import sharp from "sharp"

import {
  IMAGES_BUCKET,
  assertNoMetadata,
  fetchImage,
  newImagePath,
  processImage,
} from "../../src/lib/publish-image"
import type { CandidateSource } from "./lib/types"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One entry of data/selected.json (Candidate + curation fields). */
export interface SelectedPlace {
  source: CandidateSource
  source_id: string
  source_url: string | null
  image_remote_url: string
  author: string | null
  license: string | null
  attribution: string | null
  name: string | null
  notes: string | null
  difficulty: number | null
  lat: number
  lng: number
  heading: number | null
  /** Optional crop (fractions of the oriented image) used to remove name signs. */
  crop?: { left: number; top: number; width: number; height: number } | null
  /** Optional regions (fractions of the cropped image) to blur, hiding small name text. */
  redact?: { left: number; top: number; width: number; height: number }[] | null
}

interface PublishedRecord {
  place_id: number | null
  image_path: string
  width: number
  height: number
  bytes: number
  published_at: string
  uploaded: boolean
  source: CandidateSource
  source_id: string
  source_url: string | null
  image_remote_url: string
  author: string | null
  license: string | null
  attribution: string | null
  name: string | null
  notes: string | null
  difficulty: number | null
  lat: number
  lng: number
  heading: number | null
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const ROOT = process.cwd()
let PUBLISH_DIR = path.join(ROOT, "data", "publish")
let PUBLISHED_JSON = path.join(PUBLISH_DIR, "published.json")
let PLACES_SQL = path.join(PUBLISH_DIR, "places.sql")
function setOutDir(dir: string) {
  PUBLISH_DIR = dir
  PUBLISHED_JSON = path.join(dir, "published.json")
  PLACES_SQL = path.join(dir, "places.sql")
}
const CONCURRENCY = 3
/** Minimum gap between downloads from the same host (Commons etiquette). */
const HOST_GAP_MS: Record<string, number> = { "upload.wikimedia.org": 1000 }
const DEFAULT_HOST_GAP_MS = 300

function parseArgs(argv: string[]) {
  const args = { dryRun: false, selfTest: false, limit: Infinity, input: path.join(ROOT, "data", "selected.json") }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--dry-run") args.dryRun = true
    else if (a === "--self-test") args.selfTest = true
    else if (a === "--limit") args.limit = Number(argv[++i])
    else if (a.startsWith("--limit=")) args.limit = Number(a.slice(8))
    else if (a === "--input") args.input = path.resolve(argv[++i])
    else if (a === "--out") setOutDir(path.resolve(argv[++i]))
    else if (a.startsWith("--input=")) args.input = path.resolve(a.slice(8))
    else if (a === "--help" || a === "-h") {
      console.log("usage: npm run places:publish -- [--dry-run] [--limit N] [--input data/selected.json] [--out data/publish] [--self-test]")
      process.exit(0)
    } else {
      throw new Error(`unknown argument: ${a}`)
    }
  }
  if (!Number.isFinite(args.limit) && args.limit !== Infinity) throw new Error("--limit needs a number")
  if (args.limit !== Infinity && (!Number.isInteger(args.limit) || args.limit < 0)) throw new Error("--limit needs a non-negative integer")
  return args
}

const keyOf = (p: { source: string; source_id: string }) => `${p.source}:${p.source_id}`
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// ---------------------------------------------------------------------------
// Self-test: GPS EXIF in, nothing out.
// ---------------------------------------------------------------------------

async function selfTest(): Promise<void> {
  console.log("[self-test] building a 3000x1500 JPEG with GPS EXIF + orientation 6 ...")
  const input = await sharp({
    create: { width: 3000, height: 1500, channels: 3, background: { r: 200, g: 40, b: 40 } },
  })
    .jpeg({ quality: 90 })
    .withExif({
      IFD0: { Make: "NUguessrTest", Model: "SelfTest", Software: "selftest" },
      IFD3: {
        GPSLatitudeRef: "N",
        GPSLatitude: "42/1 20/1 24/1",
        GPSLongitudeRef: "W",
        GPSLongitude: "71/1 5/1 24/1",
      },
    })
    .withMetadata({ orientation: 6 })
    .toBuffer()

  // Sanity: the fixture really carries GPS (otherwise the test proves nothing).
  const inGps = await exifr.gps(input)
  if (!inGps || inGps.latitude == null) throw new Error("self-test fixture has no GPS; test is invalid")
  const inMeta = await sharp(input).metadata()
  if (!inMeta.exif) throw new Error("self-test fixture has no EXIF; test is invalid")
  console.log(`[self-test] fixture GPS = ${inGps.latitude.toFixed(4)}, ${inGps.longitude.toFixed(4)}; orientation = ${inMeta.orientation}`)

  const out = await processImage(input)
  const outMeta = await sharp(out.buffer).metadata()
  const outParsed = await exifr.parse(out.buffer, { gps: true, xmp: true, iptc: true }).catch(() => undefined)
  const outGps = await exifr.gps(out.buffer).catch(() => undefined)

  const checks: Array<[string, boolean]> = [
    ["format is webp", outMeta.format === "webp"],
    ["no exif", !outMeta.exif],
    ["no xmp", !outMeta.xmp],
    ["no iptc", !outMeta.iptc],
    ["no icc profile", !outMeta.icc],
    ["exifr.gps() empty", !outGps || (outGps.latitude == null && outGps.longitude == null)],
    ["exifr.parse() has no GPS keys", !outParsed || !Object.keys(outParsed).some((k) => /gps|latitude|longitude/i.test(k))],
    // Orientation 6 = rotate 90deg: 3000x1500 -> 1500x3000 -> fit 2000 -> 1000x2000
    ["auto-oriented + resized to 1000x2000", out.width === 1000 && out.height === 2000],
    ["no orientation tag left", outMeta.orientation == null || outMeta.orientation === 1],
  ]

  let failed = 0
  for (const [label, ok] of checks) {
    console.log(`[self-test] ${ok ? "PASS" : "FAIL"} ${label}`)
    if (!ok) failed++
  }
  await assertNoMetadata(out.buffer)

  // Small images are not enlarged.
  const small = await processImage(
    await sharp({ create: { width: 640, height: 480, channels: 3, background: { r: 0, g: 0, b: 0 } } }).jpeg().toBuffer()
  )
  const noEnlarge = small.width === 640 && small.height === 480
  console.log(`[self-test] ${noEnlarge ? "PASS" : "FAIL"} no enlargement (640x480 stays 640x480)`)
  if (!noEnlarge) failed++

  if (failed) throw new Error(`self-test failed (${failed} check(s))`)
  console.log("[self-test] OK: output carries no EXIF/GPS/XMP/IPTC")
}

// ---------------------------------------------------------------------------
// Input / state
// ---------------------------------------------------------------------------

function validateSelected(raw: unknown): SelectedPlace[] {
  if (!Array.isArray(raw)) throw new Error("selected.json must be an array")
  const out: SelectedPlace[] = []
  const seen = new Set<string>()
  raw.forEach((r: Record<string, unknown>, i) => {
    const problems: string[] = []
    if (!["wikimedia", "mapillary", "own"].includes(String(r.source))) problems.push("source")
    if (!r.source_id) problems.push("source_id")
    if (typeof r.image_remote_url !== "string" || !r.image_remote_url) problems.push("image_remote_url")
    if (typeof r.lat !== "number" || Math.abs(r.lat) > 90) problems.push("lat")
    if (typeof r.lng !== "number" || Math.abs(r.lng) > 180) problems.push("lng")
    const difficulty = r.difficulty == null ? null : Number(r.difficulty)
    if (difficulty != null && ![1, 2, 3].includes(difficulty)) problems.push("difficulty")
    // A crop removes a name sign; silently dropping it would publish a giveaway.
    let crop: SelectedPlace["crop"] = null
    if (r.crop != null) {
      const c = r.crop as Record<string, unknown>
      const vals = [c.left, c.top, c.width, c.height]
      if (
        vals.every((v) => typeof v === "number" && v >= 0 && v <= 1) &&
        (c.left as number) + (c.width as number) <= 1.0001 &&
        (c.top as number) + (c.height as number) <= 1.0001 &&
        (c.width as number) > 0.2 &&
        (c.height as number) > 0.2
      ) {
        crop = { left: c.left as number, top: c.top as number, width: c.width as number, height: c.height as number }
      } else {
        problems.push("crop")
      }
    }
    let redact: SelectedPlace["redact"] = null
    if (r.redact != null) {
      const list = Array.isArray(r.redact) ? (r.redact as Record<string, unknown>[]) : null
      const ok =
        list?.every(
          (c) =>
            [c.left, c.top, c.width, c.height].every((v) => typeof v === "number" && v >= 0 && v <= 1) &&
            (c.left as number) + (c.width as number) <= 1.0001 &&
            (c.top as number) + (c.height as number) <= 1.0001
        ) ?? false
      if (ok) redact = list!.map((c) => ({ left: c.left as number, top: c.top as number, width: c.width as number, height: c.height as number }))
      else problems.push("redact")
    }
    if (problems.length) {
      console.warn(`[publish] skipping selected[${i}]: invalid ${problems.join(", ")}`)
      return
    }
    const place: SelectedPlace = {
      source: r.source as CandidateSource,
      source_id: String(r.source_id),
      source_url: (r.source_url as string) ?? null,
      image_remote_url: r.image_remote_url as string,
      author: (r.author as string) ?? null,
      license: (r.license as string) ?? null,
      attribution: (r.attribution as string) ?? null,
      name: (r.name as string) ?? null,
      notes: (r.notes as string) ?? null,
      difficulty,
      lat: r.lat as number,
      lng: r.lng as number,
      heading: typeof r.heading === "number" ? r.heading : null,
      crop,
      redact,
    }
    if (seen.has(keyOf(place))) {
      console.warn(`[publish] skipping duplicate ${keyOf(place)}`)
      return
    }
    seen.add(keyOf(place))
    out.push(place)
  })
  return out
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  if (!existsSync(file)) return fallback
  return JSON.parse(await readFile(file, "utf8")) as T
}

/** Serialized, atomic writes of published.json. */
let writeChain: Promise<void> = Promise.resolve()
function savePublished(map: Map<string, PublishedRecord>): Promise<void> {
  writeChain = writeChain.then(async () => {
    const tmp = `${PUBLISHED_JSON}.tmp`
    await writeFile(tmp, JSON.stringify([...map.values()], null, 2) + "\n")
    await rename(tmp, PUBLISHED_JSON)
  })
  return writeChain
}

// ---------------------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------------------

function getSupabase(): { client: SupabaseClient; url: string } | null {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return {
    url: url.replace(/\/+$/, ""),
    client: createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }),
  }
}

async function existingPlaces(client: SupabaseClient, items: SelectedPlace[]): Promise<Map<string, { id: number; image_url: string }>> {
  const found = new Map<string, { id: number; image_url: string }>()
  const bySource = new Map<string, string[]>()
  for (const it of items) bySource.set(it.source, [...(bySource.get(it.source) ?? []), it.source_id])
  for (const [source, ids] of bySource) {
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await client
        .from("places")
        .select("id, image_url, source, source_id")
        .eq("source", source)
        .in("source_id", ids.slice(i, i + 200))
      if (error) throw new Error(`places lookup failed: ${error.message}`)
      for (const row of data ?? []) found.set(keyOf(row as { source: string; source_id: string }), { id: row.id, image_url: row.image_url })
    }
  }
  return found
}

function placeRow(p: SelectedPlace, imagePath: string) {
  return {
    image_url: imagePath,
    lat: p.lat,
    lng: p.lng,
    name: p.name,
    notes: p.notes,
    source: p.source,
    source_id: p.source_id,
    source_url: p.source_url,
    author: p.author,
    license: p.license,
    attribution: p.attribution,
    heading: p.heading,
    difficulty: p.difficulty,
    active: true,
  }
}

async function uploadObject(client: SupabaseClient, imagePath: string, buffer: Buffer): Promise<void> {
  const { error } = await client.storage.from(IMAGES_BUCKET).upload(imagePath, buffer, {
    contentType: "image/webp",
    upsert: false,
    cacheControl: "31536000",
  })
  // Resuming after a crash between upload and insert: the object is already there.
  if (error && !/exists|duplicate/i.test(error.message)) throw new Error(`upload failed: ${error.message}`)
}

async function upsertPlace(client: SupabaseClient, p: SelectedPlace, imagePath: string): Promise<number> {
  const { data, error } = await client
    .from("places")
    .upsert(placeRow(p, imagePath), { onConflict: "source,source_id" })
    .select("id")
    .single()
  if (error || !data) throw new Error(`places upsert failed: ${error?.message ?? "no row returned"}`)
  return data.id as number
}

async function markCandidate(client: SupabaseClient, p: SelectedPlace, placeId: number): Promise<void> {
  const { error } = await client
    .from("place_candidates")
    .update({ place_id: placeId, status: "approved", updated_at: new Date().toISOString() })
    .eq("source", p.source)
    .eq("source_id", p.source_id)
  if (error) console.warn(`[publish] place_candidates update skipped for ${keyOf(p)}: ${error.message}`)
}

// ---------------------------------------------------------------------------
// SQL fallback
// ---------------------------------------------------------------------------

const sqlLit = (v: unknown) =>
  v == null ? "null" : typeof v === "number" ? String(v) : typeof v === "boolean" ? String(v) : `'${String(v).replace(/'/g, "''")}'`

async function writePlacesSql(records: PublishedRecord[]): Promise<void> {
  const cols = ["image_url", "lat", "lng", "name", "notes", "source", "source_id", "source_url", "author", "license", "attribution", "heading", "difficulty", "active"] as const
  const lines = [
    "-- Generated by scripts/places/publish.ts. Upload data/publish/<image_url> to the",
    "-- `images` bucket first (same object paths), then run this. Idempotent.",
    "begin;",
  ]
  for (const r of records) {
    const row = placeRow(r, r.image_path)
    lines.push(
      `insert into public.places (${cols.join(", ")}) values (${cols.map((c) => sqlLit(row[c])).join(", ")})\n` +
        `  on conflict (source, source_id) do update set ${cols.filter((c) => c !== "source" && c !== "source_id").map((c) => `${c} = excluded.${c}`).join(", ")};`
    )
    lines.push(
      `update public.place_candidates c set place_id = p.id, status = 'approved', updated_at = now()\n` +
        `  from public.places p where p.source = ${sqlLit(r.source)} and p.source_id = ${sqlLit(r.source_id)}\n` +
        `  and c.source = p.source and c.source_id = p.source_id;`
    )
  }
  lines.push("commit;", "")
  await writeFile(PLACES_SQL, lines.join("\n"))
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const lastHit = new Map<string, number>()
async function politeGap(url: string): Promise<void> {
  if (!/^https?:/i.test(url)) return
  const host = new URL(url).host
  const gap = HOST_GAP_MS[host] ?? DEFAULT_HOST_GAP_MS
  // Reserve the slot synchronously so concurrent workers queue up.
  const prev = lastHit.get(host) ?? 0
  const at = Math.max(Date.now(), prev + gap)
  lastHit.set(host, at)
  if (at > Date.now()) await sleep(at - Date.now())
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (args.selfTest) return selfTest()

  if (!existsSync(args.input)) throw new Error(`input not found: ${path.relative(ROOT, args.input)}`)
  const selected = validateSelected(JSON.parse(await readFile(args.input, "utf8")))
  await mkdir(PUBLISH_DIR, { recursive: true })

  const published = new Map<string, PublishedRecord>(
    (await readJson<PublishedRecord[]>(PUBLISHED_JSON, [])).map((r) => [keyOf(r), r])
  )

  const db = getSupabase()
  if (db) console.log(`[publish] database: ${new URL(db.url).host} (service role)`)
  else
    console.log(
      `[publish] no SUPABASE_SERVICE_ROLE_KEY: images will be processed into ${path.relative(ROOT, PUBLISH_DIR)} and places.sql written there;\n` +
        "          uploading to storage + inserting rows needs SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
    )
  if (args.dryRun) console.log("[publish] --dry-run: downloading + processing only; nothing is written or uploaded")

  const inDb = db ? await existingPlaces(db.client, selected) : new Map<string, { id: number; image_url: string }>()

  const todo: SelectedPlace[] = []
  let skipped = 0
  for (const p of selected) {
    const rec = published.get(keyOf(p))
    const row = inDb.get(keyOf(p))
    const done = db ? Boolean(row) : Boolean(rec && existsSync(path.join(PUBLISH_DIR, rec.image_path)))
    if (done) {
      skipped++
      // Published elsewhere (e.g. the admin UI): record it so places.sql/manifest stay complete.
      if (row && !rec && !args.dryRun) {
        published.set(keyOf(p), {
          ...p, place_id: row.id, image_path: row.image_url, width: 0, height: 0, bytes: 0,
          published_at: new Date().toISOString(), uploaded: true,
        })
      } else if (row && rec && rec.place_id !== row.id && !args.dryRun) {
        published.set(keyOf(p), { ...rec, place_id: row.id, uploaded: true })
      }
      continue
    }
    todo.push(p)
  }
  const batch = todo.slice(0, args.limit)
  console.log(`[publish] ${selected.length} selected, ${skipped} already published, ${todo.length} to do, processing ${batch.length}`)

  const results = { published: 0, processedOnly: 0, failed: 0, bytes: 0 }
  const uploadedThisRun: string[] = []
  const failures: string[] = []

  let next = 0
  async function worker(): Promise<void> {
    while (next < batch.length) {
      const p = batch[next++]
      const label = `${keyOf(p)}${p.name ? ` (${p.name})` : ""}`
      try {
        const existing = published.get(keyOf(p))
        const localExisting = existing ? path.join(PUBLISH_DIR, existing.image_path) : null
        let imagePath: string
        let out: { buffer: Buffer; width: number; height: number }

        if (existing && localExisting && existsSync(localExisting)) {
          // Processed earlier (e.g. without a key): reuse the same file + path.
          imagePath = existing.image_path
          const buffer = await readFile(localExisting)
          await assertNoMetadata(buffer)
          out = { buffer, width: existing.width, height: existing.height }
        } else {
          await politeGap(p.image_remote_url)
          const raw = await fetchImage(p.image_remote_url)
          out = await processImage(raw, { crop: p.crop ?? null, redact: p.redact ?? null })
          await assertNoMetadata(out.buffer)
          imagePath = newImagePath()
        }

        if (args.dryRun) {
          console.log(`[publish] dry-run ok ${label}: ${out.width}x${out.height}, ${Math.round(out.buffer.length / 1024)} KB`)
          results.processedOnly++
          results.bytes += out.buffer.length
          continue
        }

        const localPath = path.join(PUBLISH_DIR, imagePath)
        if (!existsSync(localPath)) await writeFile(localPath, out.buffer)

        let placeId: number | null = null
        if (db) {
          await uploadObject(db.client, imagePath, out.buffer)
          placeId = await upsertPlace(db.client, p, imagePath)
          await markCandidate(db.client, p, placeId)
          uploadedThisRun.push(imagePath)
          results.published++
        } else {
          results.processedOnly++
        }
        results.bytes += out.buffer.length

        published.set(keyOf(p), {
          ...p,
          place_id: placeId,
          image_path: imagePath,
          width: out.width,
          height: out.height,
          bytes: out.buffer.length,
          published_at: new Date().toISOString(),
          uploaded: Boolean(db),
        })
        await savePublished(published)
        console.log(`[publish] ${db ? "published" : "processed"} ${label} -> ${imagePath}${placeId ? ` (place ${placeId})` : ""}`)
      } catch (err) {
        results.failed++
        failures.push(`${label}: ${(err as Error).message}`)
        console.error(`[publish] FAILED ${label}: ${(err as Error).message}`)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batch.length) }, worker))

  if (!args.dryRun) {
    await savePublished(published)
    await writePlacesSql([...published.values()])
  }

  // Verify a few public objects really have no metadata.
  let verification = "skipped"
  if (db && !args.dryRun) {
    const pool = uploadedThisRun.length
      ? uploadedThisRun
      : [...published.values()].filter((r) => r.uploaded).map((r) => r.image_path)
    const sample = [...pool].sort(() => Math.random() - 0.5).slice(0, 3)
    const outcomes: string[] = []
    for (const objectPath of sample) {
      const publicUrl = `${db.url}/storage/v1/object/public/${IMAGES_BUCKET}/${objectPath}`
      try {
        const buf = await fetchImage(publicUrl, { retries: 2 })
        await assertNoMetadata(buf)
        const gps = await exifr.gps(buf).catch(() => undefined)
        outcomes.push(`OK ${objectPath} (${buf.length} B, gps=${gps ? "PRESENT" : "none"})`)
      } catch (err) {
        outcomes.push(`FAIL ${objectPath}: ${(err as Error).message}`)
      }
    }
    outcomes.forEach((o) => console.log(`[verify] ${o}`))
    verification = sample.length ? (outcomes.every((o) => o.startsWith("OK")) ? `${sample.length}/${sample.length} clean` : "FAILED") : "nothing uploaded"
    if (verification === "FAILED") process.exitCode = 1
  }

  console.log("\n[publish] summary")
  console.log(`  selected:        ${selected.length}`)
  console.log(`  already done:    ${skipped}`)
  console.log(`  published (DB):  ${results.published}`)
  console.log(`  processed only:  ${results.processedOnly}${args.dryRun ? " (dry run)" : db ? "" : ` (no service key; see ${path.relative(ROOT, PLACES_SQL)})`}`)
  console.log(`  failed:          ${results.failed}`)
  console.log(`  output size:     ${(results.bytes / 1024 / 1024).toFixed(1)} MB`)
  console.log(`  remaining:       ${Math.max(0, todo.length - batch.length)}${args.limit !== Infinity ? " (--limit)" : ""}`)
  console.log(`  verification:    ${verification}`)
  if (failures.length) {
    console.log("  failures:")
    failures.forEach((f) => console.log(`    - ${f}`))
    process.exitCode = 1
  }
}

main().catch((err) => {
  console.error(`[publish] ${(err as Error).message}`)
  process.exit(1)
})
