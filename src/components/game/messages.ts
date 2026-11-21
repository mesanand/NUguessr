// Friendly copy for the short error codes returned by src/app/play/actions.ts.

const MESSAGES: Record<string, string> = {
  no_places: "No campus photos are live yet. Check back soon!",
  game_not_found: "We couldn't find that game.",
  not_your_game: "This game belongs to another player.",
  game_finished: "This game is already finished.",
  game_incomplete: "This game isn't finished yet.",
  round_out_of_order: "That round was already submitted.",
  round_out_of_range: "That round doesn't exist.",
  bad_guess: "That guess wasn't a valid map location.",
  round_not_started: "That round hasn't started yet. Please try again.",
  rate_limited: "You've played a lot — take a short break and try again later.",
  unknown_error: "Something went wrong. Please try again.",
}

export function friendlyError(code: string | null | undefined): string {
  return (code && MESSAGES[code]) || "Something went wrong. Please try again."
}
