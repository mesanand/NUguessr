// Enriches candidates with nearby named OSM features (admin-only hints).
//  - One cached Overpass query (data/osm/features.json; --refresh to refetch)
//    for named buildings / amenities / leisure / plazas / parks / artwork in the
//    campus bbox (+ small margin).
//  - nearby_features = top 5 within 80 m (distance to polygon outline, 0 inside).
//  - suggested_name = an OSM feature name the Commons title mentions (within
//    300 m), else the nearest named feature within 40 m, else null.
// Names stay in title/suggested_name only — never anywhere public.
//
// Run: npm run places:names
import { fetchJson } from './lib/http'
import { OSM_DIR, readCandidates, readJson, writeCandidates, writeJson } from './lib/files'
import { CAMPUS_BOUNDS } from './lib/campus-filter'
import { cellId, distToRingM, haversineM, type LatLng } from './lib/geo'
import path from 'node:path'

const OVERPASS = 'https://overpass-api.de/api/interpreter'
const FEATURES_FILE = path.join(OSM_DIR, 'features.json')
const MARGIN = 0.002

interface OsmEl {
  type: 'node' | 'way' | 'relation'
  id: number
  lat?: number
  lon?: number
  tags?: Record<string, string>
  geometry?: { lat: number; lon: number }[]
  members?: { type: string; role: string; geometry?: { lat: number; lon: number }[] }[]
}

export interface Feature {
  id: string
  name: string
  kind: string
  rings: LatLng[][] // polygons/lines; a node is a single-point ring
  closed: boolean
}

async function loadFeatures(refresh: boolean): Promise<Feature[]> {
  let raw = readJson<{ elements: OsmEl[] } | null>(FEATURES_FILE, null)
  if (!raw || refresh) {
    const { south, west, north, east } = CAMPUS_BOUNDS
    const bb = `${south - MARGIN},${west - MARGIN},${north + MARGIN},${east + MARGIN}`
    const q = `[out:json][timeout:90][bbox:${bb}];
(
  nwr["name"]["building"];
  nwr["name"]["amenity"];
  nwr["name"]["leisure"];
  nwr["name"]["tourism"];
  nwr["name"]["historic"];
  nwr["name"]["place"~"square|plaza"];
  nwr["name"]["highway"="pedestrian"];
  nwr["name"]["landuse"~"grass|recreation_ground"];
  nwr["name"]["railway"="station"];
  nwr["name"]["public_transport"="station"];
);
out geom;`
    raw = await fetchJson<{ elements: OsmEl[] }>(OVERPASS, {
      method: 'POST',
      body: new URLSearchParams({ data: q }),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      label: 'overpass features',
    })
    writeJson(FEATURES_FILE, raw)
    console.log(`Overpass: ${raw.elements.length} named features cached to ${FEATURES_FILE}`)
  } else console.log(`Overpass: using cached ${raw.elements.length} features (--refresh to refetch)`)

  const out: Feature[] = []
  for (const el of raw.elements) {
    const t = el.tags ?? {}
    const name = t.name
    if (!name) continue
    const kind = t.building ? 'building' : t.amenity ?? t.leisure ?? t.tourism ?? t.historic ?? t.place ?? t.highway ?? t.landuse ?? t.railway ?? 'feature'
    if (el.type === 'node' && el.lat != null && el.lon != null) {
      out.push({ id: `node/${el.id}`, name, kind, rings: [[[el.lat, el.lon]]], closed: false })
    } else if (el.type === 'way' && el.geometry) {
      const ring = el.geometry.map((g) => [g.lat, g.lon] as LatLng)
      const closed = ring.length > 3 && haversineM(ring[0][0], ring[0][1], ring[ring.length - 1][0], ring[ring.length - 1][1]) < 1
      out.push({ id: `way/${el.id}`, name, kind, rings: [ring], closed })
    } else if (el.type === 'relation' && el.members) {
      const rings = el.members
        .filter((m) => m.role !== 'inner' && m.geometry?.length)
        .map((m) => m.geometry!.map((g) => [g.lat, g.lon] as LatLng))
      // Member ways may be fragments; treat as lines unless individually closed.
      if (rings.length) out.push({ id: `relation/${el.id}`, name, kind, rings, closed: false })
    }
  }
  return out
}

export function featureDistance(f: Feature, lat: number, lng: number): number {
  let best = Infinity
  for (const r of f.rings) {
    const closed = f.closed || (r.length > 3 && haversineM(r[0][0], r[0][1], r[r.length - 1][0], r[r.length - 1][1]) < 1)
    best = Math.min(best, distToRingM(lat, lng, r, closed))
  }
  return best
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const GENERIC = new Set(['northeastern university', 'boston', 'parking', 'garage'])

async function main() {
  const features = await loadFeatures(process.argv.includes('--refresh'))
  const named = features.filter((f) => !GENERIC.has(norm(f.name)))
  console.log(`${named.length} usable named features`)
  const cands = readCandidates()
  let withName = 0
  let fromTitle = 0
  for (const c of cands) {
    const dists = named
      .map((f) => ({ f, d: featureDistance(f, c.lat, c.lng) }))
      .filter((x) => x.d <= 300)
      .sort((a, b) => a.d - b.d)
    // Dedupe by name (a building can appear as node + way).
    const seen = new Set<string>()
    const uniq = dists.filter((x) => (seen.has(x.f.name) ? false : (seen.add(x.f.name), true)))
    c.nearby_features = uniq.filter((x) => x.d <= 80).slice(0, 5).map((x) => ({ name: x.f.name, distance_m: Math.round(x.d) }))

    let suggestion: string | null = null
    if (c.title) {
      // "Northeastern University" in a title is not the Green Line stop named "Northeastern".
      const t = ` ${norm(c.title).replace(/\bnortheastern university\b/g, ' ')} `
      const hit = uniq
        .filter((x) => norm(x.f.name).length >= 5 && t.includes(` ${norm(x.f.name)} `))
        .sort((a, b) => norm(b.f.name).length - norm(a.f.name).length || a.d - b.d)[0]
      if (hit) {
        suggestion = hit.f.name
        fromTitle++
      }
    }
    if (!suggestion && uniq[0] && uniq[0].d <= 40) suggestion = uniq[0].f.name
    c.suggested_name = suggestion
    if (suggestion) withName++
    c.cell = c.cell ?? cellId(c.lat, c.lng)
  }
  writeCandidates(cands)
  console.log(`${cands.length} candidates: ${withName} with suggested_name (${fromTitle} matched from title), ${cands.filter((c) => c.nearby_features?.length).length} with nearby features`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
