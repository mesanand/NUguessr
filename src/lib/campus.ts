// Northeastern University (Boston) campus geometry, shared by the guess map,
// the results map and the photo-sourcing scripts in scripts/places/.
//
// Bounds cover the main campus from International Village / Ruggles /
// Columbus Ave (south-east) to Huntington Ave / the Museum of Fine Arts and
// the Fenway edge (north-west), plus Christian Science Plaza (north-east). Verified against OpenStreetMap's campus
// outline — see DECISIONS.md.

export type LatLngTuple = [number, number]

export interface Bounds {
  south: number
  west: number
  north: number
  east: number
}

export const CAMPUS_BOUNDS: Bounds = {
  south: 42.334,
  west: -71.096,
  // Widened (Nov 2026) from 42.3445 / -71.083 to take in Christian Science
  // Plaza; public/map/campus-basemap.json already draws this area.
  north: 42.3456,
  east: -71.082,
}

export const CAMPUS_CENTER: LatLngTuple = [
  (CAMPUS_BOUNDS.south + CAMPUS_BOUNDS.north) / 2,
  (CAMPUS_BOUNDS.west + CAMPUS_BOUNDS.east) / 2,
]

/** Default zoom for the guess map; min/max lock players to campus scale. */
export const CAMPUS_ZOOM = 16
export const CAMPUS_MIN_ZOOM = 15
export const CAMPUS_MAX_ZOOM = 19

export function isOnCampus(lat: number, lng: number, bounds: Bounds = CAMPUS_BOUNDS): boolean {
  return lat >= bounds.south && lat <= bounds.north && lng >= bounds.west && lng <= bounds.east
}

/** Bounds grown by `pad` degrees on every side (used for map maxBounds). */
export function paddedBounds(pad = 0.004, bounds: Bounds = CAMPUS_BOUNDS): [LatLngTuple, LatLngTuple] {
  return [
    [bounds.south - pad, bounds.west - pad],
    [bounds.north + pad, bounds.east + pad],
  ]
}
