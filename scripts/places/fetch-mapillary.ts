// Gathers Mapillary street-level images on campus (Graph API v4).
// Needs MAPILLARY_TOKEN (client access token, "MLY|..."); exits cleanly without it.
//
// - Splits CAMPUS_BOUNDS into tiles of TILE_DEG x TILE_DEG (0.0025 deg² << the
//   API's 0.01 deg² bbox limit) and pages each with limit=2000; tiles that come
//   back full are split again.
// - Prefers computed_geometry / computed_compass_angle (SfM-corrected) over raw.
// - Keeps images from the last MAX_AGE_YEARS, on campus (lib/campus-filter.ts).
// - Thins to 1 image per ~20 m cell per 60° heading bucket (newest, then largest);
//   panoramas only when a cell has no flat image.
// License: Mapillary imagery is CC BY-SA 4.0; author = creator.username.
//
// Run: MAPILLARY_TOKEN=... npm run places:fetch:mapillary [-- --no-thumbs]
import { fetchJson, redact } from './lib/http'
import { readCandidates, replaceSource, writeCandidates } from './lib/files'
import { CAMPUS_BOUNDS, onCampus } from './lib/campus-filter'
import { cellId } from './lib/geo'
import { downloadThumbs } from './lib/thumbs'
import type { Candidate } from './lib/types'

const GRAPH = 'https://graph.mapillary.com/images'
const TILE_DEG = 0.0025
const PAGE_LIMIT = 2000
const MAX_AGE_YEARS = 7
const FIELDS = [
  'id',
  'computed_geometry',
  'geometry',
  'compass_angle',
  'computed_compass_angle',
  'captured_at',
  'thumb_2048_url',
  'thumb_1024_url',
  'thumb_original_url',
  'is_pano',
  'creator',
  'width',
  'height',
].join(',')

interface MlyImage {
  id: string
  computed_geometry?: { type: 'Point'; coordinates: [number, number] }
  geometry?: { type: 'Point'; coordinates: [number, number] }
  compass_angle?: number
  computed_compass_angle?: number
  captured_at?: number // epoch ms
  thumb_2048_url?: string
  thumb_1024_url?: string
  thumb_original_url?: string
  is_pano?: boolean
  creator?: { id: string; username?: string }
  width?: number
  height?: number
}

async function fetchTile(token: string, w: number, s: number, e: number, n: number, depth = 0): Promise<MlyImage[]> {
  const url = `${GRAPH}?access_token=${encodeURIComponent(token)}&bbox=${w},${s},${e},${n}&fields=${FIELDS}&limit=${PAGE_LIMIT}`
  const json = await fetchJson<{ data?: MlyImage[]; error?: { message: string } }>(url, { label: 'mapillary tile' })
  if (json.error) throw new Error(`Mapillary error for ${redact(url)}: ${json.error.message}`)
  const data = json.data ?? []
  if (data.length >= PAGE_LIMIT && depth < 3) {
    // Tile saturated: split into quadrants so nothing is silently truncated.
    const mx = (w + e) / 2
    const my = (s + n) / 2
    const parts = await Promise.all([
      fetchTile(token, w, s, mx, my, depth + 1),
      fetchTile(token, mx, s, e, my, depth + 1),
      fetchTile(token, w, my, mx, n, depth + 1),
      fetchTile(token, mx, my, e, n, depth + 1),
    ])
    return parts.flat()
  }
  return data
}

function toCandidate(img: MlyImage): Candidate | null {
  const geom = img.computed_geometry ?? img.geometry
  if (!geom) return null
  const [lng, lat] = geom.coordinates
  const remote = img.thumb_2048_url ?? img.thumb_original_url
  if (!remote) return null
  const author = img.creator?.username ?? 'Mapillary contributor'
  const headingRaw = img.computed_compass_angle ?? img.compass_angle
  const heading = typeof headingRaw === 'number' && headingRaw >= 0 ? +(((headingRaw % 360) + 360) % 360).toFixed(1) : null
  return {
    source: 'mapillary',
    source_id: img.id,
    source_url: `https://www.mapillary.com/app/?pKey=${img.id}`,
    image_remote_url: remote,
    thumb_url: img.thumb_1024_url ?? remote,
    lat: +lat.toFixed(7),
    lng: +lng.toFixed(7),
    heading,
    author,
    license: 'CC BY-SA 4.0',
    attribution: `Photo: ${author}, CC BY-SA 4.0, via Mapillary`,
    captured_at: img.captured_at ? new Date(img.captured_at).toISOString() : null,
    width: img.width ?? 0,
    height: img.height ?? 0,
    title: null,
    suggested_name: null,
    cell: cellId(lat, lng),
  }
}

async function main() {
  const token = process.env.MAPILLARY_TOKEN
  if (!token) {
    console.log('MAPILLARY_TOKEN is not set — skipping Mapillary. Get a client token at https://www.mapillary.com/dashboard/developers and add MAPILLARY_TOKEN=... to .env.local.')
    return
  }
  const { south, west, north, east } = CAMPUS_BOUNDS
  const raw = new Map<string, MlyImage>()
  for (let s = south; s < north; s += TILE_DEG)
    for (let w = west; w < east; w += TILE_DEG) {
      const n = Math.min(s + TILE_DEG, north)
      const e = Math.min(w + TILE_DEG, east)
      const imgs = await fetchTile(token, +w.toFixed(6), +s.toFixed(6), +e.toFixed(6), +n.toFixed(6))
      for (const i of imgs) raw.set(i.id, i)
      console.log(`  tile ${s.toFixed(4)},${w.toFixed(4)}: ${imgs.length} (total ${raw.size})`)
    }

  const reasons: Record<string, number> = {}
  const bump = (r: string) => (reasons[r] = (reasons[r] ?? 0) + 1)
  const cutoff = Date.now() - MAX_AGE_YEARS * 365.25 * 86400_000
  const eligible: { c: Candidate; pano: boolean; t: number }[] = []
  for (const img of raw.values()) {
    if (!img.captured_at || img.captured_at < cutoff) {
      bump(`older than ${MAX_AGE_YEARS} years / no date`)
      continue
    }
    const c = toCandidate(img)
    if (!c) {
      bump('no geometry / no image url')
      continue
    }
    if (!onCampus(c.lat, c.lng)) {
      bump('outside campus')
      continue
    }
    eligible.push({ c, pano: !!img.is_pano, t: img.captured_at })
  }

  // Thin: one per (20 m cell, 60° bucket); flat images beat panos, then newer, then larger.
  eligible.sort((a, b) => Number(a.pano) - Number(b.pano) || b.t - a.t || b.c.width * b.c.height - a.c.width * a.c.height)
  const slots = new Set<string>()
  const flatCells = new Set(eligible.filter((e) => !e.pano).map((e) => e.c.cell))
  const kept: Candidate[] = []
  for (const { c, pano } of eligible) {
    if (pano && flatCells.has(c.cell)) {
      bump('pano (cell has flat coverage)')
      continue
    }
    const slot = `${c.cell}|${c.heading == null ? 'x' : Math.floor(c.heading / 60)}`
    if (slots.has(slot)) {
      bump('thinned (cell+heading bucket taken)')
      continue
    }
    slots.add(slot)
    kept.push(c)
  }

  const merged = replaceSource(readCandidates(), 'mapillary', kept)
  writeCandidates(merged.list)
  console.log(`\nMapillary: ${raw.size} raw -> ${eligible.length} eligible -> ${kept.length} kept (+${merged.added} new, -${merged.removed} removed)`)
  for (const [k, v] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) console.log(`  rejected ${String(v).padStart(5)}  ${k}`)
  if (!process.argv.includes('--no-thumbs')) {
    const t = await downloadThumbs(merged.list.filter((c) => c.source === 'mapillary'))
    console.log(`thumbs: ${t.ok} downloaded, ${t.skipped} cached, ${t.failed.length} failed`)
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? redact(e.message) : e)
  process.exit(1)
})
