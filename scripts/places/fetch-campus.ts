// Fetches Northeastern's campus outline from OSM Overpass and writes
//   data/osm/campus.json              (raw rings, full resolution)
//   scripts/places/campus-polygon.json (simplified, committed)
// Run: npx tsx scripts/places/fetch-campus.ts   (cached; pass --force to refetch)
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fetchJson } from './lib/http'
import { OSM_DIR, readJson, writeJson } from './lib/files'
import { ringBBox, simplifyRing, type LatLng } from './lib/geo'

const OVERPASS = 'https://overpass-api.de/api/interpreter'
const RAW_FILE = path.join(OSM_DIR, 'campus.json')
const COMMITTED_FILE = path.join(__dirname, 'campus-polygon.json')

interface OverpassGeomEl {
  type: 'way' | 'relation'
  id: number
  tags?: Record<string, string>
  geometry?: { lat: number; lon: number }[]
  members?: { type: string; role: string; geometry?: { lat: number; lon: number }[] }[]
}

/** Stitch relation outer-way segments into closed rings. */
function stitch(segments: LatLng[][]): LatLng[][] {
  const rings: LatLng[][] = []
  const segs = segments.map((s) => [...s])
  const same = (a: LatLng, b: LatLng) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9
  while (segs.length) {
    let ring = segs.shift()!
    let grew = true
    while (!same(ring[0], ring[ring.length - 1]) && grew) {
      grew = false
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i]
        const end = ring[ring.length - 1]
        if (same(end, s[0])) ring = ring.concat(s.slice(1))
        else if (same(end, s[s.length - 1])) ring = ring.concat([...s].reverse().slice(1))
        else continue
        segs.splice(i, 1)
        grew = true
        break
      }
    }
    if (ring.length >= 4) rings.push(ring)
  }
  return rings
}

async function main() {
  const force = process.argv.includes('--force')
  let raw = readJson<{ elements: OverpassGeomEl[] } | null>(RAW_FILE, null)
  if (!raw || force) {
    const q = `[out:json][timeout:60];
(
  way["amenity"="university"]["name"~"Northeastern"](around:2500,42.339,-71.089);
  relation["amenity"="university"]["name"~"Northeastern"](around:2500,42.339,-71.089);
);
out geom;`
    raw = await fetchJson<{ elements: OverpassGeomEl[] }>(OVERPASS, {
      method: 'POST',
      body: new URLSearchParams({ data: q }),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      label: 'overpass campus',
    })
    writeJson(RAW_FILE, raw)
  }
  const rings: { id: string; name: string; ring: LatLng[] }[] = []
  for (const el of raw.elements) {
    const name = el.tags?.name ?? ''
    if (el.type === 'way' && el.geometry) {
      rings.push({ id: `way/${el.id}`, name, ring: el.geometry.map((g) => [g.lat, g.lon] as LatLng) })
    } else if (el.type === 'relation' && el.members) {
      const outers = el.members.filter((m) => m.role !== 'inner' && m.geometry).map((m) => m.geometry!.map((g) => [g.lat, g.lon] as LatLng))
      for (const r of stitch(outers)) rings.push({ id: `relation/${el.id}`, name, ring: r })
    }
  }
  console.log(`campus elements: ${raw.elements.length}, rings: ${rings.length}`)
  for (const r of rings) {
    const bb = ringBBox([r.ring])
    console.log(`  ${r.id} "${r.name}" pts=${r.ring.length} bbox S${bb.south.toFixed(4)} W${bb.west.toFixed(4)} N${bb.north.toFixed(4)} E${bb.east.toFixed(4)}`)
  }
  const simplified = rings.map((r) => ({ id: r.id, name: r.name, ring: simplifyRing(r.ring, 3).map(([a, b]) => [+a.toFixed(6), +b.toFixed(6)]) }))
  const all = simplified.map((r) => r.ring as LatLng[])
  const bbox = ringBBox(all)
  writeJson(COMMITTED_FILE, {
    source: 'OpenStreetMap contributors (ODbL), amenity=university name~Northeastern',
    fetched_at: new Date().toISOString(),
    bbox,
    rings: simplified,
  })
  console.log(`overall bbox`, bbox)
  console.log(`wrote ${COMMITTED_FILE}${existsSync(RAW_FILE) ? ` and ${RAW_FILE}` : ''}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
