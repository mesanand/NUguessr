"use server"

// Game server actions. All game state and scoring lives in Postgres
// (security-definer RPCs from the real_places_and_server_games migration);
// these actions only call those RPCs with the player's own session, so
// auth.uid() ties signed-in games to the player and the browser never
// computes or writes a score.

import { createClient } from "@/lib/supabase/server"
import type {
  ActionResult,
  FinishResult,
  GameState,
  LatLng,
  RoundPublic,
  SubmitResult,
} from "@/lib/game-types"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function publicImageUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "")
  return `${base}/storage/v1/object/public/images/${path.replace(/^\//, "")}`
}

function normalizeGame(raw: unknown): GameState {
  const game = raw as GameState
  return {
    ...game,
    rounds: (game.rounds ?? []).map((r: RoundPublic) => ({
      ...r,
      imageUrl: r.imageUrl ? publicImageUrl(r.imageUrl) : null,
    })),
  }
}

function errorMessage(error: { message?: string } | null | undefined): string {
  const msg = error?.message ?? "unknown_error"
  // Postgres exceptions raised by the RPCs use short codes as messages.
  const known = msg.match(
    /no_places|game_not_found|not_your_game|game_finished|round_out_of_order|round_out_of_range|round_not_started|bad_guess|game_incomplete|rate_limited/
  )
  if (known) return known[0]
  // Never pass raw database errors to the browser.
  console.error("game action failed:", msg)
  return "unknown_error"
}

/** Start a new 5-round game. Returns the game id and the rounds' photo URLs only. */
export async function startGame(): Promise<ActionResult<GameState>> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("start_game")
  if (error || !data) return { ok: false, error: errorMessage(error) }
  return { ok: true, data: normalizeGame(data) }
}

/** Load an existing game (for refresh/resume). Submitted rounds include their results. */
export async function getGame(gameId: string): Promise<ActionResult<GameState>> {
  if (!UUID_RE.test(gameId)) return { ok: false, error: "game_not_found" }
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("get_game", { p_game_id: gameId })
  if (error) return { ok: false, error: errorMessage(error) }
  if (!data) return { ok: false, error: "game_not_found" }
  return { ok: true, data: normalizeGame(data) }
}

/**
 * Submit the guess for `roundIndex` (rounds must be submitted in order, once
 * each). `guess = null` means the timer ran out: 0 points, answer revealed.
 */
export async function submitGuess(
  gameId: string,
  roundIndex: number,
  guess: LatLng | null
): Promise<ActionResult<SubmitResult>> {
  if (!UUID_RE.test(gameId)) return { ok: false, error: "game_not_found" }
  if (!Number.isInteger(roundIndex)) return { ok: false, error: "round_out_of_range" }
  if (guess && (!Number.isFinite(guess.lat) || !Number.isFinite(guess.lng))) {
    return { ok: false, error: "bad_guess" }
  }
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("submit_guess", {
    p_game_id: gameId,
    p_round_index: roundIndex,
    p_guess_lat: guess?.lat ?? null,
    p_guess_lng: guess?.lng ?? null,
  })
  if (error || !data) return { ok: false, error: errorMessage(error) }
  return { ok: true, data: data as SubmitResult }
}

/** Finalize the game: the server sums the recorded rounds and updates the player's stats. */
export async function finishGame(gameId: string): Promise<ActionResult<FinishResult>> {
  if (!UUID_RE.test(gameId)) return { ok: false, error: "game_not_found" }
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("finish_game", { p_game_id: gameId })
  if (error || !data) return { ok: false, error: errorMessage(error) }
  return { ok: true, data: data as FinishResult }
}
