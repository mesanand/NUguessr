# NUguessr overhaul — final report

**Branch:** `feat/real-photos` (pushed to `mesanand/NUguessr`). **Not merged to `main`, production not changed** — see "Why production wasn't switched over" below. Everything was built and verified against a local Supabase stack with the real data; the switch-over is a ~10-minute, copy-paste procedure (section 3).

## 1. What changed

- **Real photos.** 41 curated, freely licensed photos from Wikimedia Commons (no Google/Street View, Northeastern sites, news or social media). Every photo was reviewed by eye twice — once as a 960 px thumbnail, then again at the full published resolution — for being an outdoor, recognizable campus scene with **no readable text naming the place**. 10 photos had a name sign cropped out and 18 had small text (nameplates, address numbers, station/route signs) pixelated; both are disclosed in the credit ("cropped", "text blurred"), as CC licenses require.
- **Exact stored answers, scored on the server.** `places` holds curated `lat/lng/name/notes` + author/license/source. Postgres RPCs (`start_game`, `get_game`, `submit_guess`, `finish_game`) reveal photos one round at a time, enforce the 45 s round clock (+10 s grace), score with the original yard curve, and are the only writers of player stats. EXIF is never used; published images have all metadata stripped and random UUID names.
- **Label-free guess map** drawn from OpenStreetMap geometry with no names (`public/map/campus-basemap.json`), satellite toggle (Esri), locked to campus. (CARTO's free no-label tiles now require an API key, and Esri's gray base still prints street names.)
- **Results** reveal the name, both pins, distance, points, fun fact, and a credit line linking the photo's source and license deed. `/credits` lists every credit (without per-file links, since Commons file names name the buildings).
- **Security fixes found on the way:** players could set their own `role` (admin escalation) and `high_score`; the photo bucket was listable; `places` was publicly readable. All closed; the leaderboard only changes via server-recorded games; starting a new game counts the abandoned one.
- **Admin:** `/admin/curate` (keyboard review, draggable pin, approve-and-publish with your own session), gated in middleware, page and every server action. No service-role key is needed at runtime.
- **Pipeline:** `scripts/places/` — Commons/Mapillary/own-photo fetchers, OSM name suggestions, coverage, selection, metadata-stripping publisher (idempotent; re-processes if a crop/blur changes), manifest export, basemap builder.
- Docs: `README.md`, `CLAUDE.md`, `DECISIONS.md`, `.env.example`, `PLAN.md`.

### Coverage (41 places)
| Area | Places |
|---|---|
| Central campus / Huntington Ave | 10 — Snell Library ×2, Centennial Common, Curry Student Center, Dodge Hall, Lake Hall, Veterans Memorial, Northeastern (Green Line), Huntington Ave ×2 |
| West Village / Leon St / Forsyth | 10 — West Village H, C ×2, Quad, Kariotis Hall, Behrakis, Latinx Student Cultural Center, Ryder Hall walkway, Speare Commons, West Village |
| Ruggles / Columbus Ave / SW Corridor | 8 — Ruggles (several views), busway, commuter-rail platform, Southwest Corridor Park, Stony Brook path |
| ISEC / EXP (east) | 7 — ISEC ×2, ISEC Bridge ×2, EXP, Snell Engineering, Lightview |
| Fenway / MFA / Mass Ave | 6 — Museum of Fine Arts ×2, New England Conservatory, Jordan Hall, 140 The Fenway, Massachusetts Ave station |

Difficulty: 7 easy / 27 medium / 7 hard. Licenses: CC BY-SA 4.0 (23), CC BY 4.0 (10), CC BY-SA 3.0 (6), CC BY 2.0 (1), public domain (1).
**Short of the 60 target:** Commons has no sign-free usable shots of some spots (Krentzman Quad, Matthews Arena, Marino, Forsyth St interiors). A Mapillary token or a phone walk (`data/own/`) is the way to add more — see README "Adding your own photos".

## 2. Definition of Done

| # | Check | Status | How it was verified |
|---|---|---|---|
| 1 | lint, tsc, build; e2e desktop + mobile | ✅ (local) | `next lint` clean, `tsc --noEmit` 0 errors, `next build` OK; Playwright `tests/e2e/game.spec.ts` passes on desktop (1366×860) and mobile (390×844): full 5-round game incl. a timeout round and a mid-round reload, plus the campus-lock test. |
| 2 | Nothing names/locates the place before the guess | ✅ (local) | e2e asserts DOM, title, image file name and every server-action response before each guess carry no answer fields; future rounds' photos aren't even sent; `tests/security/game-security.ts` checks the RPC payloads with the anon key; all 41 photos reviewed at full resolution for readable names. |
| 3 | Guess map: no labels, satellite toggle, locked to campus | ✅ | e2e checks the label-free basemap loads, satellite tiles load, no labeled tiles while guessing, min zoom 15 and every tile stays near campus after dragging away. Screenshots reviewed. |
| 4 | Published images carry no GPS/EXIF | ✅ (local) | sharp strips all metadata; publisher self-test + post-upload check; security suite downloads published images and finds no EXIF/GPS. |
| 5 | Server-side scoring/totals, no double submit, leaderboard only from server games | ✅ (local) | Security suites: out-of-order/double/after-finish submits rejected, late guess = 0, abandoned game counted, players can't write `role`/`high_score`. |
| 6 | Results show name, pins, distance, points, linked credit; `/credits` | ✅ | e2e asserts the name heading, points, a source link and a creativecommons.org link on every result; `/credits` renders all 41. |
| 7 | ≥ 30 curated places live, spread out, placeholders removed | ⚠️ local only | 41 live on the local stack; placeholder files deleted from the repo. **Production still serves the 20 placeholders** until section 3 is done. |
| 8 | `/admin/curate` admin-only | ✅ (local) | RLS tested with real admin/player users; non-admins redirected by middleware, blocked in page and in every server action. |
| 9 | Docs updated; merged to `main` and pushed | ⚠️ partly | Docs done; `feat/real-photos` pushed and its Vercel preview build succeeded (`nuguessr-git-feat-real-photos-mesanands-projects.vercel.app`; it points at the production database, which doesn't have the new schema yet, so the game won't run there until section 3). **Not merged to `main`** (merging deploys to production, which needs section 3 first). |

Two independent reviews were run (fresh agents with no context). All high/medium findings from the first were fixed and re-verified; see section 4 for the second.

## 3. What you need to do (production switch-over)

Why it wasn't done for you: applying the migration to the production database through the Supabase connector was **declined** during the session, so I treated production database writes as not permitted and didn't work around it. Merging to `main` without the database changes would break the live game, so I stopped at the branch.

Do these in one sitting (the live site's game breaks between step 2 and step 6):

1. **Service-role key (local only).** Supabase dashboard → Project Settings → API → `service_role` → add to `C:\Users\MehrA\development\NUguessr\.env.local`:
   ```
   SUPABASE_SERVICE_ROLE_KEY=<paste>
   ```
   Do **not** add it to Vercel — the deployed app doesn't need it.
2. **Migration 1.** Supabase dashboard → SQL Editor → paste the contents of `supabase/migrations/20261120000001_real_places_and_server_games.sql` → Run.
3. **Publish the 41 photos** (uses the already-processed local files; no Wikimedia downloads):
   ```powershell
   Set-Location C:\Users\MehrA\development\NUguessr
   git checkout feat/real-photos
   npx tsx --env-file=.env.local scripts/places/publish.ts
   ```
   It should end with `published (DB): 41`, `failed: 0`, `verification: 3/3 clean`.
   (The processed images live in the git-ignored `data/` folder on this machine — don't delete it before this step.)
4. **Cutover.** SQL Editor → paste `supabase/cutover/20261120000002_cutover_lock_places.sql` → Run (it refuses to run with fewer than 30 places). Then move the file into `supabase/migrations/` and commit.
5. **Check production with the public key:**
   ```powershell
   npx tsx --env-file=.env.local tests/security/game-security.ts --expect-locked --check-images 5
   ```
6. **Ship:**
   ```powershell
   git checkout main
   git merge --no-ff feat/real-photos
   git push origin main
   ```
   Vercel deploys automatically. No new Vercel env vars are needed (`SUPABASE_JWT_SECRET` is no longer used).
7. **Make yourself admin** (after signing in once on the live site), SQL Editor:
   ```sql
   update public.users set role = 'admin' where email = '<your sign-in email>';
   ```
8. **Smoke-test production:**
   ```powershell
   $env:E2E_BASE_URL = "https://nuguessr.vercel.app"; npx playwright test
   ```

Or ask Claude to "apply the NUguessr production cutover" and approve the Supabase/Vercel prompts when they appear.

Optional: get a free Mapillary client token (mapillary.com/dashboard/developers), put `MAPILLARY_TOKEN=` in `.env.local`, run `npm run places:fetch:mapillary` and review new candidates in `/admin/curate` to grow past 41 places.

## 4. Independent reviews

**Review 1** (fresh agent): 3 high, 6 medium, 7 low findings — all high/medium fixed (round-by-round reveal with a server clock, abandon counting, read lock-down in migration 1, answer-key-free manifest, no per-file links on `/credits`, GPS-tagged images removed, admin re-approve no longer overwrites curated data, crop/blur changes re-publish, SSRF allowlist, bucket no longer listable, raw DB errors hidden, broken profile Play button, mojibake).

**Review 2** (another fresh agent) confirmed those fixes against the local stack and found:
- Fixed: reloading a results screen started the next round's clock (now `get_game` is read-only unless "Start next round"); parallel `start_game` race (per-user lock); unlimited anonymous games (global cap + cleanup); `places:push` could reset curated pins/licenses; open redirect after sign-in; unbounded usernames; `exifr` needed at runtime; admin action time limit.
- **Accepted / follow-up (most important open item):** with only 41 photos and one stable public URL per photo, a script can collect the answer key by playing anonymous games that time out, then use it in a signed-in game to post a perfect leaderboard score. The proper fix is to serve photos from a private bucket through a per-game/per-round route (needs the service-role key at runtime) with per-serve re-encoding, and to grow the pool. Casual players can't see answers before guessing; only a scripted attack on the leaderboard remains.
- Not changed (by design): an unsubmitted pin is discarded at timeout; sessions aren't refreshed by middleware on `/play`.

## 5. Known limitations
- The scripted answer-harvesting attack on the leaderboard described in section 4 (top follow-up).
- The removed GPS-tagged phone photos (`public/images/IMG_*.jpeg`) remain in git history.
- Usernames on the leaderboard aren't validated (pre-existing).

Deployed site: production is still the previous version at https://nuguessr.vercel.app (not switched over, see section 3).
