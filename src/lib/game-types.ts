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
  /** Guess arrived after the server-side deadline: scored 0. */
  late?: boolean
  credit: PhotoCredit
}

export interface RoundPublic {
  roundIndex: number
  /**
   * Absolute public URL of the (metadata-stripped, UUID-named) photo.
   * null for rounds that haven't started yet: photos are revealed one round
   * at a time (call getGame after a round's result to reveal the next).
   */
  imageUrl: string | null
  /** Present only once this round has been submitted */
  result: RoundResult | null
}

export interface CurrentRound {
  roundIndex: number
  /** Server deadline for this round (epoch ms). Guesses after it (+ small grace) score 0. */
  deadline: number
  /** Server clock when this response was made (epoch ms), to correct client clock skew. */
  serverNow: number
}

export interface GameState {
  gameId: string
  finished: boolean
  totalScore: number | null
  roundSeconds: number
  /** Number of rounds already submitted. */
  roundsSubmitted: number
  /**
   * The round being played now (revealed, clock running), or null when the
   * game is finished, all rounds are submitted, or the next round hasn't been
   * started yet (call getGame(id, { reveal: true }) to start it).
   */
  currentRound: CurrentRound | null
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
