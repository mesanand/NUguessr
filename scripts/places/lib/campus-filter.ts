// Campus membership test used by every fetch script.
//
// RULE: a candidate is "on campus" iff it is inside CAMPUS_BOUNDS (src/lib/campus.ts,
// the box the guess map is locked to) AND inside — or within BUFFER_M metres of —
// the OSM campus outline in scripts/places/campus-polygon.json
// (amenity=university "Northeastern University", way/301210399 + relation/3905196).
// The AND keeps photos playable on the locked map while dropping the
// non-campus parts of the box (Back Bay Fens, Mission Hill, Symphony, MFA interior).
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { CAMPUS_BOUNDS, isOnCampus } from '../../../src/lib/campus'
import { inPolygonsBuffered, type LatLng } from './geo'

export const BUFFER_M = 40

interface PolygonFile {
  rings: { id: string; name: string; ring: LatLng[] }[]
}

let rings: LatLng[][] | null = null
export function campusRings(): LatLng[][] {
  if (!rings) {
    const file = path.join(__dirname, '..', 'campus-polygon.json')
    const json = JSON.parse(readFileSync(file, 'utf8')) as PolygonFile
    rings = json.rings.map((r) => r.ring)
  }
  return rings
}

export function inCampusBounds(lat: number, lng: number): boolean {
  return isOnCampus(lat, lng, CAMPUS_BOUNDS)
}

export function onCampus(lat: number, lng: number): boolean {
  return inCampusBounds(lat, lng) && inPolygonsBuffered(lat, lng, campusRings(), BUFFER_M)
}

export { CAMPUS_BOUNDS }
