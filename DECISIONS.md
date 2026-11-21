# Decisions

One line each: decision — why.

- Commons is the primary photo source; Mapillary script is built but unused — `MAPILLARY_TOKEN` is not set in `.env.local` or Vercel, and Commons has 500+ geotagged files inside the campus box.
- No `SUPABASE_SERVICE_ROLE_KEY` exists (local or Vercel), so runtime code never needs it: game logic is in security-definer RPCs called with the player's session, and admin writes use RLS gated by `is_admin()` — fewer secrets to leak, and nothing to set on Vercel.
- Scoring is authoritative in SQL (`distance_yards`, `round_points`), not a TS util — a server-side TS util would still need the answer coordinates sent to it, and SQL keeps scoring next to the data; `src/lib/scoring.ts` holds display constants only.
- Same scoring curve as before (yards, 5000 under 12 yd, linear to 0 at 500 yd) — brief asked to keep it.
- `users` is now client-writable only for `username`; stats come from `finish_game` — previously any signed-in user could update their own `role`/`high_score` (privilege escalation + forgeable leaderboard).
- `is_admin()` accepts `app_metadata.role = 'admin'` OR `users.role = 'admin'` — brief asked for both; `users.role` is safe now that it isn't client-writable. `SUPABASE_JWT_SECRET` is no longer needed.
- Migration split in two: #1 schema + RPCs + read lock-down, #2 cutover (delete placeholder rows, NOT NULL; parked in `supabase/cutover/` and aborts with < 30 real places) — the cutover can only run once real places exist.
- Supabase MCP `apply_migration` on the live project was **declined** in this session — treated as "no permission to write to the production database": did not retry or route the SQL through `execute_sql`; all DB work is tested on a local Supabase stack (Docker) and the production steps are listed in FINAL_REPORT.md.
- Baseline migration `20261118183259_initial_schema.sql` added with the live version number — lets `supabase start`/`db push` rebuild the schema from the repo without re-applying it in production.
- Game URL is `/play/<gameId>` (uuid) — the game id carries the round list server-side, so the URL reveals nothing and refresh resumes the game.
- Anonymous games are allowed and recorded (user_id null); only signed-in games update `users` stats.
- `/credits` lists credits in random order without names, coordinates or thumbnails (superseded below: per-file links removed too).
- (Superseded below) The round timer was first client-only; the independent review made the case for enforcing it server-side, which is now done.

- Photos are revealed one round at a time with a 45 s server deadline (+10 s grace); late guesses score 0 — the independent review showed the client-only timer and up-front photo URLs let a script pre-fetch photos and look answers up.
- Signed-in players: starting a new game closes and counts any unfinished one, and at most 30 games/hour — stops "restart until easy photos" and bulk answer-harvesting on accounts that reach the leaderboard. Anonymous games can't affect the leaderboard, so they're not rate-limited (accepted: anyone can still learn the photo pool by playing a lot, as in any fixed-pool photo game).
- Client reads of `places` are revoked in migration 1 itself, not at cutover — once real coordinates exist the table must never be readable. Production's old client reads `places` directly, so migration 1, publishing, cutover and the deploy must happen together (FINAL_REPORT.md lists the order).
- Dropped the `storage.objects` SELECT policy for `images` — the public bucket serves files by URL without it; the policy only let anyone list every photo.
- `/credits` shows author, license (linked to its deed) and source site, but no per-file links — Commons file names name the buildings; each photo's file link is shown on the results screen after it's guessed.
- `data/places.manifest.json` (committed backup) omits image file names, so the public repo is not a UUID-image → answer key; everything left in it is public on Commons anyway.
- CARTO's free `light_nolabels` tiles now return "API KEY REQUIRED" and Esri's gray "base" still prints street names, so both maps draw `public/map/campus-basemap.json` (OSM geometry, no names) — no tile-provider key or rate limits.
- Curation was re-done at full resolution: 960 px review thumbnails hid small but readable names at the published 1920 px. 18 photos had small text (nameplates, address numbers, station/route signs, a café umbrella) pixelated+blurred; 10 had a name sign cropped out; both are noted in the license credit ("cropped", "text blurred") per CC's change-indication requirement. One (Dockser Hall) was dropped because the blur band would cover the subject.
- MFA exhibition banners ("Ansel Adams in Our Time", etc.) were left in — they don't name the venue and the MFA facade is the recognizable subject anyway.
- Ruggles capped at 6, ISEC area 6, West Village 5, max 2 photos per place name, one photo per ~10 m (25 m for the same name) — Commons is dominated by Ruggles transit photos.
- 41 places instead of 60 — Commons alone has no usable sign-free shots of several spots (Krentzman Quad, Matthews Arena, Marino, etc.); a Mapillary token or own photos are the way to grow the pool.
- Removed `public/images/IMG_*.jpeg` (GPS-tagged phone photos) and `public/places/*` (placeholder cards with GPS) — unused. They remain in git history; rewriting public history wasn't worth the risk.
- Production Supabase/Vercel were left untouched: the migration apply was declined in-session, so no prod DB writes, no prod uploads, no merge to `main` (which auto-deploys and would break the live game without the DB changes).