# Decisions

One line each: decision — why.

- Commons is the primary photo source; Mapillary script is built but unused — `MAPILLARY_TOKEN` is not set in `.env.local` or Vercel, and Commons has 500+ geotagged files inside the campus box.
- No `SUPABASE_SERVICE_ROLE_KEY` exists (local or Vercel), so runtime code never needs it: game logic is in security-definer RPCs called with the player's session, and admin writes use RLS gated by `is_admin()` — fewer secrets to leak, and nothing to set on Vercel.
- Scoring is authoritative in SQL (`distance_yards`, `round_points`), not a TS util — a server-side TS util would still need the answer coordinates sent to it, and SQL keeps scoring next to the data; `src/lib/scoring.ts` holds display constants only.
- Same scoring curve as before (yards, 5000 under 12 yd, linear to 0 at 500 yd) — brief asked to keep it.
- `users` is now client-writable only for `username`; stats come from `finish_game` — previously any signed-in user could update their own `role`/`high_score` (privilege escalation + forgeable leaderboard).
- `is_admin()` accepts `app_metadata.role = 'admin'` OR `users.role = 'admin'` — brief asked for both; `users.role` is safe now that it isn't client-writable. `SUPABASE_JWT_SECRET` is no longer needed.
- Migration split in two: #1 additive (safe while old app is live), #2 cutover (delete placeholders, NOT NULL, revoke client reads of `places`) — the old client reads `places` directly, so locking reads early would break production.
- Supabase MCP `apply_migration` on the live project was **declined** in this session — treated as "no permission to write to the production database": did not retry or route the SQL through `execute_sql`; all DB work is tested on a local Supabase stack (Docker) and the production steps are listed in FINAL_REPORT.md.
- Baseline migration `20261118183259_initial_schema.sql` added with the live version number — lets `supabase start`/`db push` rebuild the schema from the repo without re-applying it in production.
- Game URL is `/play/<gameId>` (uuid) — the game id carries the round list server-side, so the URL reveals nothing and refresh resumes the game.
- Anonymous games are allowed and recorded (user_id null); only signed-in games update `users` stats.
- `/credits` lists author/license/source link in random order without names, coordinates or thumbnails — required attribution without being a usable answer key (a determined player could still open every source link; accepted).
- Server-side round timer is not enforced (45 s is client-side) — enforcing it needs per-round start timestamps; low value for a hobby game, noted as a follow-up.
