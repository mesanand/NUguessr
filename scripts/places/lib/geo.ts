// Small geo helpers (no deps). Coordinates are [lat, lng] unless noted.

export type LatLng = [number, number]

const R = 6371008.8 // mean Earth radius (m)
const toRad = (d: number) => (d * Math.PI) / 180

export function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}

/** Ray-casting point-in-polygon for a single ring of [lat, lng]. */
export function pointInRing(lat: number, lng: number, ring: LatLng[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i]
    const [yj, xj] = ring[j]
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Multipolygon as list of outer rings (holes ignored — campus outlines rarely have meaningful holes). */
export function pointInPolygons(lat: number, lng: number, rings: LatLng[][]): boolean {
  return rings.some((r) => pointInRing(lat, lng, r))
}

/** Local equirectangular projection to metres around a reference latitude. */
function project(lat: number, lng: number, refLat: number): [number, number] {
  return [toRad(lng) * R * Math.cos(toRad(refLat)), toRad(lat) * R]
}

/** Distance in metres from a point to segment a-b (good enough at campus scale). */
export function distToSegmentM(lat: number, lng: number, a: LatLng, b: LatLng): number {
  const [px, py] = project(lat, lng, lat)
  const [ax, ay] = project(a[0], a[1], lat)
  const [bx, by] = project(b[0], b[1], lat)
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  const cx = ax + t * dx
  const cy = ay + t * dy
  return Math.hypot(px - cx, py - cy)
}

/** Distance from point to a polygon/polyline outline (0 if inside a closed ring). */
export function distToRingM(lat: number, lng: number, ring: LatLng[], closed = true): number {
  if (ring.length === 0) return Infinity
  if (ring.length === 1) return haversineM(lat, lng, ring[0][0], ring[0][1])
  if (closed && ring.length >= 3 && pointInRing(lat, lng, ring)) return 0
  let best = Infinity
  for (let i = 0; i < ring.length - 1; i++) best = Math.min(best, distToSegmentM(lat, lng, ring[i], ring[i + 1]))
  return best
}

/** True if inside any ring or within `bufferM` metres of its outline. */
export function inPolygonsBuffered(lat: number, lng: number, rings: LatLng[][], bufferM: number): boolean {
  if (pointInPolygons(lat, lng, rings)) return true
  return rings.some((r) => distToRingM(lat, lng, r) <= bufferM)
}

/**
 * Grid cell id with roughly `sizeM` metre cells (fixed lat/lng step derived at
 * Boston's latitude so ids are stable between runs).
 */
export function cellId(lat: number, lng: number, sizeM = 20): string {
  const dLat = sizeM / 111_320
  const dLng = sizeM / (111_320 * Math.cos(toRad(42.339)))
  return `${Math.floor(lat / dLat)}:${Math.floor(lng / dLng)}`
}

/** Douglas–Peucker simplification on [lat,lng] with tolerance in metres. */
export function simplifyRing(ring: LatLng[], tolM: number): LatLng[] {
  if (ring.length <= 4) return ring
  const keep = new Array<boolean>(ring.length).fill(false)
  keep[0] = keep[ring.length - 1] = true
  const stack: [number, number][] = [[0, ring.length - 1]]
  while (stack.length) {
    const [s, e] = stack.pop()!
    let maxD = 0
    let idx = -1
    for (let i = s + 1; i < e; i++) {
      const d = distToSegmentM(ring[i][0], ring[i][1], ring[s], ring[e])
      if (d > maxD) {
        maxD = d
        idx = i
      }
    }
    if (idx >= 0 && maxD > tolM) {
      keep[idx] = true
      stack.push([s, idx], [idx, e])
    }
  }
  return ring.filter((_, i) => keep[i])
}

export function ringBBox(rings: LatLng[][]): { south: number; west: number; north: number; east: number } {
  let south = 90
  let north = -90
  let west = 180
  let east = -180
  for (const r of rings)
    for (const [la, ln] of r) {
      south = Math.min(south, la)
      north = Math.max(north, la)
      west = Math.min(west, ln)
      east = Math.max(east, ln)
    }
  return { south, west, north, east }
}

export function centroid(ring: LatLng[]): LatLng {
  let la = 0
  let ln = 0
  for (const p of ring) {
    la += p[0]
    ln += p[1]
  }
  return [la / ring.length, ln / ring.length]
}
