// Shared data contracts for the places pipeline (scripts/places/**).
// Candidates are written by the fetch scripts to data/candidates.json; curation
// agents write CurationDecision[] to data/curation/batch-*.json; publish.ts
// reads both.

export type CandidateSource = 'mapillary' | 'wikimedia' | 'own'

export interface NearbyFeature {
  name: string
  distance_m: number
}

export interface Candidate {
  source: CandidateSource
  /** Stable id within the source (Commons pageid, Mapillary image id, sha1 for own photos). */
  source_id: string
  /** Human-facing page for attribution (Commons file page, Mapillary viewer, file:// for own). */
  source_url: string
  /** Full-res or >=2000 px URL to publish from (file:// absolute path for own photos). */
  image_remote_url: string
  /** ~1024 px URL used for review thumbnails. */
  thumb_url?: string
  lat: number
  lng: number
  /** Camera heading in degrees clockwise from north, if known. */
  heading: number | null
  author: string
  license: string
  /** Ready-to-display attribution string. */
  attribution: string
  /** ISO timestamp, if known. */
  captured_at: string | null
  width: number
  height: number
  /** Original title (e.g. Commons file name). ADMIN-ONLY: may name the place. */
  title: string | null
  /** Nearest named OSM feature or title-derived name. ADMIN-ONLY. */
  suggested_name: string | null
  nearby_features?: NearbyFeature[]
  /** Grid cell id (see lib/geo.ts cellId). */
  cell?: string
}

export interface CurationDecision {
  source: CandidateSource
  source_id: string
  decision: 'approve' | 'reject'
  is_outdoor_campus_scene: boolean
  /** 1 (bad) .. 5 (great) */
  quality: number
  /** Visible signage/text that gives the answer away. */
  giveaway: boolean
  /** 1 (generic) .. 5 (instantly recognizable) */
  recognizable: number
  difficulty: 1 | 2 | 3
  name: string | null
  notes: string | null
  lat: number
  lng: number
  pin_check: 'ok' | 'corrected' | 'wrong'
  reason: string
}
