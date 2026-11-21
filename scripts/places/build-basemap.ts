/**
 * places:basemap — build the label-free guess-map basemap.
 *
 * Third-party "no labels" raster tiles either need an API key now (CARTO)
 * or still print street names (Esri light gray "base"), so the guess map
 * draws campus geometry itself: buildings, paths, roads, green space, water
 * and rail from OpenStreetMap, saved as a small GeoJSON with NO names or
 * other tags — it cannot leak a label.
 *
 *   npx tsx scripts/places/build-basemap.ts
 *
 * Output: public/map/campus-basemap.json (committed).
 * Data © OpenStreetMap contributors, ODbL — attribution shown on the map.
 */
import fs from "node:fs"
import path from "node:path"
import { paddedBounds } from "../../src/lib/campus"
import { fetchJson } from "./lib/http"

type Kind = "building" | "major" | "minor" | "path" | "green" | "water" | "rail" | "pitch"

interface OsmWay {
  type: "way"
  id: number
  tags?: Record<string, string>
  geometry?: { lat: number; lon: number }[]
}
interface OsmRelation {
  type: "relation"
  id: number
  tags?: Record<string, string>
  members?: { type: string; role: string; geometry?: { lat: number; lon: number }[] }[]
}

const OUT = path.resolve(__dirname, "../../public/map/campus-basemap.json")
// Map maxBounds pad is 0.004°; fetch a bit more so panning to the edge stays drawn.
const [[south, west], [north, east]] = paddedBounds(0.006)
const bbox = `${south},${west},${north},${east}`

const query = `[out:json][timeout:90];
(
  way["building"](${bbox});
  way["highway"](${bbox});
  way["leisure"~"^(park|garden|playground|common|recreation_ground)$"](${bbox});
  way["leisure"~"^(pitch|track|stadium)$"](${bbox});
  way["landuse"~"^(grass|recreation_ground|village_green|meadow)$"](${bbox});
  way["natural"~"^(water|wood|scrub|grassland)$"](${bbox});
  relation["natural"="water"](${bbox});
  relation["leisure"="park"](${bbox});
  way["waterway"="riverbank"](${bbox});
  way["railway"~"^(rail|subway|light_rail|tram)$"]["tunnel"!="yes"](${bbox});
);
out geom;`

function classify(tags: Record<string, string> = {}): Kind | null {
  if (tags.building) return "building"
  if (tags.railway) return "rail"
  if (tags.highway) {
    if (tags.tunnel === "yes" || tags.highway === "proposed" || tags.highway === "construction") return null
    if (/^(motorway|trunk|primary|secondary|tertiary)(_link)?$/.test(tags.highway)) return "major"
    // Driveways/parking aisles and separately mapped sidewalks/crossings add
    // megabytes of clutter without helping anyone orient themselves.
    if (tags.highway === "service" && /^(parking_aisle|driveway|drive-through)$/.test(tags.service ?? "")) return null
    if (/^(residential|unclassified|service|living_street|road|busway)$/.test(tags.highway)) return "minor"
    if (/^(sidewalk|crossing|traffic_island)$/.test(tags.footway ?? "")) return null
    if (/^(footway|pedestrian|path|cycleway|steps|track|corridor)$/.test(tags.highway)) return "path"
    return null
  }
  if (tags.natural === "water" || tags.waterway === "riverbank") return "water"
  if (/^(pitch|track|stadium)$/.test(tags.leisure ?? "")) return "pitch"
  if (tags.leisure || tags.landuse || tags.natural) return "green"
  return null
}

// 5 decimals ≈ 1 m — plenty for a guess map, and ~20% smaller.
const r5 = (n: number) => Math.round(n * 1e5) / 1e5
const coords = (g: { lat: number; lon: number }[]) => {
  const out: number[][] = []
  for (const p of g) {
    const c = [r5(p.lon), r5(p.lat)]
    const last = out[out.length - 1]
    if (!last || last[0] !== c[0] || last[1] !== c[1]) out.push(c)
  }
  return out
}
const isClosed = (g: { lat: number; lon: number }[]) =>
  g.length > 3 && g[0].lat === g[g.length - 1].lat && g[0].lon === g[g.length - 1].lon

async function main() {
  const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`
  const res = await fetchJson<{ elements: (OsmWay | OsmRelation)[] }>(url, { label: "overpass basemap" })
  const features: unknown[] = []
  const counts: Record<string, number> = {}
  for (const el of res.elements) {
    const kind = classify(el.tags)
    if (!kind) continue
    // Only geometry + a coarse kind: no names, refs, addresses or any other tag.
    if (el.type === "way" && el.geometry?.length) {
      const area = kind === "building" || kind === "green" || kind === "water" || kind === "pitch" ||
        (kind === "path" && el.tags?.area === "yes")
      if (area && isClosed(el.geometry)) {
        features.push({ type: "Feature", properties: { k: kind }, geometry: { type: "Polygon", coordinates: [coords(el.geometry)] } })
      } else if (!area) {
        features.push({ type: "Feature", properties: { k: kind }, geometry: { type: "LineString", coordinates: coords(el.geometry) } })
      } else continue
      counts[kind] = (counts[kind] ?? 0) + 1
    } else if (el.type === "relation") {
      const outers = (el.members ?? []).filter((m) => m.role === "outer" && m.geometry && isClosed(m.geometry))
      for (const m of outers) {
        features.push({ type: "Feature", properties: { k: kind }, geometry: { type: "Polygon", coordinates: [coords(m.geometry!)] } })
        counts[kind] = (counts[kind] ?? 0) + 1
      }
    }
  }
  // Draw order: green/water first, then roads, paths, rail, buildings on top.
  const order: Kind[] = ["green", "pitch", "water", "major", "minor", "path", "rail", "building"]
  features.sort(
    (a, b) =>
      order.indexOf((a as { properties: { k: Kind } }).properties.k) -
      order.indexOf((b as { properties: { k: Kind } }).properties.k)
  )
  const geojson = {
    type: "FeatureCollection",
    attribution: "© OpenStreetMap contributors (ODbL)",
    bbox: [west, south, east, north],
    features,
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, JSON.stringify(geojson))
  console.log(`wrote ${path.relative(process.cwd(), OUT)}: ${features.length} features, ${Math.round(fs.statSync(OUT).size / 1024)} KB`, counts)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
