/**
 * places:labels — build the OPTIONAL place-name layer for the guess map.
 *
 * The basemap (build-basemap.ts) has no names on purpose. Players can turn
 * on "Names" to see building, street and park names when they need help;
 * this script makes that layer from OpenStreetMap: one point per label, with
 * the zoom at which it appears and, for streets, the angle of the street.
 *
 *   npx tsx scripts/places/build-labels.ts
 *
 * Output: public/map/campus-labels.json (copy it to the portfolio's
 * public/nuguessr/map/ too, where the game runs).
 * Data © OpenStreetMap contributors, ODbL — attribution shown on the map.
 */
import fs from "node:fs"
import path from "node:path"
import { paddedBounds } from "../../src/lib/campus"
import { fetchJson } from "./lib/http"

type Kind = "building" | "street" | "place"

interface OsmWay {
  type: "way"
  id: number
  tags?: Record<string, string>
  geometry?: { lat: number; lon: number }[]
}

export interface Label {
  name: string
  kind: Kind
  lat: number
  lng: number
  /** Street labels follow the street: degrees, -90..90 (text never upside down). */
  angle?: number
  /** Show from this map zoom (campus map runs 15..19). */
  minZoom: number
}

const OUT = path.resolve(__dirname, "../../public/map/campus-labels.json")
const [[south, west], [north, east]] = paddedBounds(0.004)
const bbox = `${south},${west},${north},${east}`

const query = `[out:json][timeout:90];
(
  way["building"]["name"](${bbox});
  way["highway"~"^(primary|secondary|tertiary|residential|unclassified|pedestrian|living_street)$"]["name"](${bbox});
  way["leisure"~"^(park|garden|common|pitch|stadium)$"]["name"](${bbox});
  way["place"="square"]["name"](${bbox});
);
out geom;`

const r5 = (n: number) => Math.round(n * 1e5) / 1e5
const inBox = (lat: number, lng: number) => lat >= south && lat <= north && lng >= west && lng <= east

/** Metres between two points (equirectangular is fine at campus scale). */
function metres(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const k = Math.PI / 180
  const x = (b.lon - a.lon) * k * Math.cos(((a.lat + b.lat) / 2) * k)
  const y = (b.lat - a.lat) * k
  return Math.hypot(x, y) * 6371000
}

/** Area-weighted centroid of a closed ring, plus its area in m². */
function centroid(g: { lat: number; lon: number }[]) {
  let a = 0
  let cx = 0
  let cy = 0
  for (let i = 0, j = g.length - 1; i < g.length; j = i++) {
    const p = g[i]!
    const q = g[j]!
    const f = q.lon * p.lat - p.lon * q.lat
    a += f
    cx += (q.lon + p.lon) * f
    cy += (q.lat + p.lat) * f
  }
  if (Math.abs(a) < 1e-14) {
    const lat = g.reduce((s, p) => s + p.lat, 0) / g.length
    const lon = g.reduce((s, p) => s + p.lon, 0) / g.length
    return { lat, lon, area: 0 }
  }
  const lon = cx / (3 * a)
  const lat = cy / (3 * a)
  const m2 = Math.abs(a / 2) * (111320 * Math.cos((lat * Math.PI) / 180)) * 110540
  return { lat, lon, area: m2 }
}

/** Points every `spacing` metres along a line, each with the local street angle. */
function along(g: { lat: number; lon: number }[], spacing: number) {
  const segs: { a: { lat: number; lon: number }; b: { lat: number; lon: number }; len: number }[] = []
  for (let i = 1; i < g.length; i++) segs.push({ a: g[i - 1]!, b: g[i]!, len: metres(g[i - 1]!, g[i]!) })
  const total = segs.reduce((s, x) => s + x.len, 0)
  if (total < 60) return []
  const count = Math.max(1, Math.floor(total / spacing))
  const out: { lat: number; lon: number; angle: number }[] = []
  for (let n = 0; n < count; n++) {
    let target = (total * (n + 0.5)) / count
    for (const s of segs) {
      if (target <= s.len) {
        const t = s.len ? target / s.len : 0
        const lat = s.a.lat + (s.b.lat - s.a.lat) * t
        const lon = s.a.lon + (s.b.lon - s.a.lon) * t
        // Screen angle: x grows east, y grows south.
        const dx = (s.b.lon - s.a.lon) * Math.cos((lat * Math.PI) / 180)
        const dy = -(s.b.lat - s.a.lat)
        let angle = (Math.atan2(dy, dx) * 180) / Math.PI
        if (angle > 90) angle -= 180
        if (angle < -90) angle += 180
        out.push({ lat, lon, angle: Math.round(angle) })
        break
      }
      target -= s.len
    }
  }
  return out
}

async function main() {
  const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`
  const res = await fetchJson<{ elements: OsmWay[] }>(url, { label: "overpass labels" })
  const ways = res.elements.filter((e) => e.type === "way" && e.geometry?.length && e.tags?.name)

  const labels: Label[] = []
  const seen = new Set<string>()

  // Buildings and places: one label at the middle of the shape. Big shapes
  // appear a zoom level earlier.
  for (const w of ways) {
    const tags = w.tags!
    if (tags.highway) continue
    const kind: Kind = tags.building ? "building" : "place"
    const c = centroid(w.geometry!)
    if (!inBox(c.lat, c.lon)) continue
    const name = tags.name!.trim()
    const key = `${kind}:${name}:${r5(c.lat).toFixed(3)}:${r5(c.lon).toFixed(3)}`
    if (seen.has(key)) continue
    seen.add(key)
    const minZoom = kind === "place" ? (c.area > 8000 ? 16 : 17) : c.area > 6000 ? 17 : 18
    labels.push({ name, kind, lat: r5(c.lat), lng: r5(c.lon), minZoom })
  }

  // Streets: OSM splits a street into many ways; label each way along its
  // length, then drop labels of the same street that land too close together.
  const streets = ways.filter((w) => w.tags!.highway)
  const placed: { name: string; lat: number; lon: number }[] = []
  for (const w of streets.sort((a, b) => b.geometry!.length - a.geometry!.length)) {
    const name = w.tags!.name!.trim()
    const major = /^(primary|secondary|tertiary)$/.test(w.tags!.highway!)
    for (const p of along(w.geometry!, major ? 320 : 260)) {
      if (!inBox(p.lat, p.lon)) continue
      if (placed.some((q) => q.name === name && metres(q, p) < 220)) continue
      placed.push({ name, lat: p.lat, lon: p.lon })
      labels.push({ name, kind: "street", lat: r5(p.lat), lng: r5(p.lon), angle: p.angle, minZoom: major ? 16 : 17 })
    }
  }

  const out = {
    attribution: "© OpenStreetMap contributors (ODbL)",
    generated_at: new Date().toISOString(),
    labels: labels.sort((a, b) => a.minZoom - b.minZoom),
  }
  fs.writeFileSync(OUT, JSON.stringify(out))
  const by = (k: Kind) => labels.filter((l) => l.kind === k).length
  console.log(
    `wrote ${labels.length} labels (${by("building")} buildings, ${by("street")} streets, ${by("place")} places) to ${path.relative(process.cwd(), OUT)}, ${Math.round(fs.statSync(OUT).size / 1024)} KB`
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
