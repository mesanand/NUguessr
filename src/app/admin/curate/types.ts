export type CandidateStatus = "pending" | "approved" | "rejected"
export type CurateFilter = CandidateStatus | "published"

export const CURATE_FILTERS: CurateFilter[] = ["pending", "approved", "rejected", "published"]
export const PAGE_SIZE = 20

/** Loose view of place_candidates.ai_scores (written by AI curation, see CurationDecision). */
export type AiScores = {
  quality?: number
  giveaway?: boolean
  recognizable?: number
  difficulty?: number
  is_outdoor_campus_scene?: boolean
  pin_check?: string
  reason?: string
  /** Set by an admin in the curation UI. */
  has_sign?: boolean
  [key: string]: unknown
}

export type CandidateRow = {
  id: number
  source: "mapillary" | "wikimedia" | "own"
  source_id: string
  source_url: string | null
  image_remote_url: string
  lat: number
  lng: number
  heading: number | null
  author: string | null
  license: string | null
  attribution: string | null
  captured_at: string | null
  width: number | null
  height: number | null
  title: string | null
  suggested_name: string | null
  name: string | null
  notes: string | null
  difficulty: number | null
  status: CandidateStatus
  review_notes: string | null
  ai_scores: AiScores | null
  place_id: number | null
  created_at: string
  updated_at: string
}
