// Pull pending community submissions ("Add your photo" on the live site) into
// the curation pipeline as `community` candidates.
//
//   npm run places:fetch:submissions            (needs SUPABASE_SERVICE_ROLE_KEY)
//   npm run places:fetch:submissions -- --dry-run
//
// For every photo_submissions row with status 'pending':
//   * download the ORIGINAL from the private `submissions` bucket into
//     data/submissions/<id>.<ext> (git-ignored; it still has full EXIF)
//   * add/refresh a candidate: source 'community', source_id = submission id,
//     lat/lng = the contributor's pin (NOT the EXIF), heading from EXIF if any,
//     author = credit name (or the anonymous fallback), license 'contributed'
// Withdrawn submissions are dropped from candidates.json and their local copy
// is deleted. Approving/rejecting and deleting originals is done by
// scripts/places/submissions-sync.ts after publishing.
//
// Run the usual steps afterwards: places:names -> curation -> select -> publish
// -> places:submissions:sync. Community-specific curation rules are in
// docs/community-photos.md.

import { existsSync } from 'node:fs'
import { readFile, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import exifr from 'exifr'
import sharp from 'sharp'
import { candidateKey, dataPath, ensureDir, mergeCandidates, readCandidates, writeCandidates } from './lib/files'
import { onCampus } from './lib/campus-filter'
import { cellId, haversineM } from './lib/geo'
import { heicToJpeg } from './lib/heic'
import { downloadThumbs } from './lib/thumbs'
import type { Candidate } from './lib/types'

export const SUBMISSIONS_BUCKET = 'submissions'
export const SUBMISSIONS_DIR = dataPath('submissions')
export const ANONYMOUS_CREDIT = 'NUguessr community'

export interface SubmissionRow {
  id: string
  storage_path: string
  original_filename: string | null
  lat: number
  lng: number
  location_source: 'exif' | 'exif_adjusted' | 'pin'
  exif_lat: number | null
  exif_lng: number | null
  captured_at: string | null
  indoor: boolean
  building: string | null
  spot_description: string | null
  credit_name: string | null
  status: 'pending' | 'approved' | 'rejected' | 'withdrawn'
  created_at: string
}

export function serviceClient() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('Set NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY in .env.local')
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

export function localOriginal(row: Pick<SubmissionRow, 'id' | 'storage_path'>): string {
  const ext = (row.storage_path.split('.').pop() ?? 'jpg').toLowerCase().replace(/[^a-z]/g, '')
  return path.join(SUBMISSIONS_DIR, `${row.id}.${ext || 'jpg'}`)
}

/** Credit line text. Plain text only; rendered as text everywhere. */
export function creditFor(row: Pick<SubmissionRow, 'credit_name'>): string {
  const name = (row.credit_name ?? '').replace(/\s+/g, ' ').trim()
  return name || ANONYMOUS_CREDIT
}

/** What the curator sees as the starting display name. Admin-only. */
export function suggestedName(row: Pick<SubmissionRow, 'indoor' | 'building' | 'spot_description'>): string | null {
  const building = row.building?.trim() || null
  const spot = row.spot_description?.trim() || null
  if (row.indoor && building) return spot ? `${building}, ${spot}` : building
  return null // outdoor: osm-names fills in the nearest named feature
}

export async function toCandidate(row: SubmissionRow, file: string): Promise<Candidate> {
  const buf = await readFile(file)
  let exif: Record<string, unknown> | undefined
  try {
    exif = await exifr.parse(buf, { gps: true, exif: true, tiff: true, xmp: false, translateValues: true })
  } catch {
    exif = undefined
  }
  const dir = exif?.GPSImgDirection
  const heading = typeof dir === 'number' && Number.isFinite(dir) ? +(((dir % 360) + 360) % 360).toFixed(1) : null
  const isHeic = /\.(heic|heif)$/i.test(file)
  const meta = await sharp(isHeic ? await heicToJpeg(buf) : buf).rotate().metadata()
  const rotated = meta.orientation && meta.orientation >= 5
  const author = creditFor(row)
  const exifPinDistance =
    row.exif_lat !== null && row.exif_lng !== null ? Math.round(haversineM(row.lat, row.lng, row.exif_lat, row.exif_lng)) : null

  return {
    source: 'community',
    source_id: row.id,
    // Local file: never exposed publicly (publish/select/export null it out).
    source_url: pathToFileURL(file).href,
    image_remote_url: pathToFileURL(file).href,
    lat: +row.lat.toFixed(7),
    lng: +row.lng.toFixed(7),
    heading,
    author,
    license: 'contributed',
    attribution: `Photo: ${author}`,
    captured_at: row.captured_at,
    width: (rotated ? meta.height : meta.width) ?? 0,
    height: (rotated ? meta.width : meta.height) ?? 0,
    title: [row.building, row.spot_description, row.original_filename].filter(Boolean).join(' · ') || null,
    suggested_name: suggestedName(row),
    cell: cellId(row.lat, row.lng),
    submission: {
      indoor: row.indoor,
      building: row.building,
      spot_description: row.spot_description,
      location_source: row.location_source,
      exif_lat: row.exif_lat,
      exif_lng: row.exif_lng,
      exif_pin_distance_m: exifPinDistance,
      credit_name: row.credit_name,
      submitted_at: row.created_at,
    },
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const db = serviceClient()
  ensureDir(SUBMISSIONS_DIR)

  const { data, error } = await db
    .from('photo_submissions')
    .select(
      'id, storage_path, original_filename, lat, lng, location_source, exif_lat, exif_lng, captured_at, indoor, building, spot_description, credit_name, status, created_at'
    )
    .in('status', ['pending', 'withdrawn'])
    .order('created_at', { ascending: true })
    .limit(1000)
  if (error) throw new Error(`photo_submissions query failed: ${error.message}`)
  const rows = (data ?? []) as SubmissionRow[]
  const pending = rows.filter((r) => r.status === 'pending')
  const withdrawn = new Set(rows.filter((r) => r.status === 'withdrawn').map((r) => r.id))

  const kept: Candidate[] = []
  const skipped: string[] = []
  for (const row of pending) {
    if (!onCampus(row.lat, row.lng)) {
      // The DB only checks a bounding box; the pipeline uses the real campus polygon.
      skipped.push(`${row.id}: pin ${row.lat.toFixed(5)},${row.lng.toFixed(5)} is outside the campus polygon (review by hand)`)
    }
    const file = localOriginal(row)
    if (!existsSync(file)) {
      if (dryRun) {
        skipped.push(`${row.id}: would download ${row.storage_path}`)
        continue
      }
      const dl = await db.storage.from(SUBMISSIONS_BUCKET).download(row.storage_path)
      if (dl.error || !dl.data) {
        skipped.push(`${row.id}: download failed (${dl.error?.message ?? 'no data'})`)
        continue
      }
      await writeFile(file, Buffer.from(await dl.data.arrayBuffer()))
    }
    try {
      kept.push(await toCandidate(row, file))
    } catch (e) {
      skipped.push(`${row.id}: unreadable image (${(e as Error).message})`)
    }
  }

  // Merge (not replace): community candidates already published or rejected
  // stay in candidates.json for the record; withdrawn ones are dropped.
  const existing = readCandidates().filter((c) => !(c.source === 'community' && withdrawn.has(c.source_id)))
  const merged = mergeCandidates(existing, kept)
  if (!dryRun) {
    writeCandidates(merged.list)
    for (const id of withdrawn) {
      for (const ext of ['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp']) {
        const f = path.join(SUBMISSIONS_DIR, `${id}.${ext}`)
        if (existsSync(f)) await unlink(f)
      }
    }
  }
  console.log(
    `Community submissions: ${pending.length} pending -> ${kept.length} candidates (+${merged.added} new, ${merged.updated} refreshed)` +
      `${withdrawn.size ? `, ${withdrawn.size} withdrawn dropped` : ''}${dryRun ? ' [dry run: nothing written]' : ''}`
  )
  for (const s of skipped) console.log(`  note ${s}`)
  if (!dryRun && kept.length) {
    const t = await downloadThumbs(kept)
    console.log(`thumbs: ${t.ok} written, ${t.skipped} cached, ${t.failed.length} failed`)
  }
  const keys = new Set(kept.map(candidateKey))
  if (keys.size) console.log(`Next: npm run places:names, curate (see docs/community-photos.md), select, publish, places:submissions:sync`)
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e)
    process.exit(1)
  })
}
