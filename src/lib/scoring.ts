// Scoring constants. The authoritative scoring runs in Postgres
// (public.distance_yards / public.round_points, called by submit_guess) so
// the browser can't change a score. These constants mirror that SQL for
// display only — keep them in sync with
// supabase/migrations/20261120000001_real_places_and_server_games.sql.
//
// Curve (unchanged from the original game):
//   distance in yards (haversine, Earth radius 3959 mi * 1760)
//   < 12 yd  -> 5000 points
//   else     -> max(0, round(5000 * (1 - distance / 500)))
//   timeout  -> 0 points

export const ROUNDS_PER_GAME = 5
export const MAX_POINTS_PER_ROUND = 5000
export const MAX_GAME_SCORE = ROUNDS_PER_GAME * MAX_POINTS_PER_ROUND
export const FULL_POINTS_RADIUS_YARDS = 12
export const ZERO_POINTS_DISTANCE_YARDS = 500
export const ROUND_TIME_SECONDS = 45
