// Shapes returned by the game server actions in src/app/play/actions.ts.
// Nothing about a place (name, coordinates, notes, source link) is present
// on a round until that round has been submitted.

export interface LatLng {
  lat: number
  lng: number
}

export type PhotoSource = "mapillary" | "wikimedia" | "own"

export interface PhotoCredit {
  author: string | null
  license: string | null
  source: PhotoSource | null
  sourceUrl: string | null
}

export interface RoundResult {
  actual: LatLng
  /** null when the round timed out without a guess */
  guess: LatLng | null
  name: string | null
  notes: string | null
  /** null when the round timed out without a guess */
  distanceYards: number | null
  points: number
  credit: PhotoCredit
}

export interface RoundPublic {
  roundIndex: number
  /** Absolute public URL of the (metadata-stripped, UUID-named) photo */
  imageUrl: string
  /** Present only once this round has been submitted */
  result: RoundResult | null
}

export interface GameState {
  gameId: string
  finished: boolean
  totalScore: number | null
  rounds: RoundPublic[]
}

export interface SubmitResult extends RoundResult {
  roundIndex: number
  isLastRound: boolean
  totalSoFar: number
}

export interface FinishResult {
  gameId: string
  totalScore: number
  maxScore: number
  rounds: number
}

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string }
