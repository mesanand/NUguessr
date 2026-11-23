# NUguessr — notes for Claude

GeoGuessr-style game for Northeastern's Boston campus. Owner/maintainer: Mehr Anand (`mesanand`). Fork of the HackBeanpot 2025 project by Philip Elbert, Joshua Chan, Oscar Ji and Alan Tai — keep their credit lines in README/LICENSE unchanged.

- Repo: https://github.com/mesanand/NUguessr (push only here; never to `elbert-p/NUguessr`). Default branch `main`.
- **Where it runs:** https://www.mehr-anand.com/nuguessr, served by the `portfolio` Vercel project from mesanand/portfolio (`src/nuguessr/`, a second Vite page). This repo is no longer deployed on its own; it holds the original Next.js app, the Supabase migrations, the security tests and the photo pipeline. Game changes go in the portfolio repo.
- Supabase project ref `phodqswvqmfwgwfltukj`, public storage bucket `images`.
- Commit as `Mehr Anand <89043467+mesanand@users.noreply.github.com>`.

## Stack
Next.js 15.1 App Router + TypeScript, Supabase (Postgres, Auth with Google, Storage), react-leaflet 5, Tailwind 3 + shadcn/ui (Radix sand/tomato/mint tokens in `globals.css` — use semantic classes, no hex in components except Leaflet canvas colors).

## Architecture (the important invariants)
- **The answer never reaches the client before a guess.** Rounds expose only a UUID-named image path. `lat/lng/name/notes/source_url` come back only from `submit_guess` (or `get_game` for already-submitted rounds). After the cutover migration, `anon` cannot select `places` at all and `authenticated` only sees rows if admin (RLS).
- **Scoring lives in SQL** (`public.distance_yards`, `public.round_points`; yards, 5000 < 12 yd, linear to 0 at 500 yd). `src/lib/scoring.ts` is display constants only — keep them in sync.
- **Games are server-recorded** (`games`, `game_rounds`): rounds in order, once each; `finish_game`/`finalize_game` are the only writers of `users` stats. Clients may update only `users.username` (1-32 chars).
- **Rounds are revealed one at a time with a server clock.** `get_game(id, p_reveal)` is read-only unless `p_reveal = true` — only the "Start next round" action (and `start_game` for round 0) may reveal, because revealing starts the 45 s deadline (`round_seconds()` + 10 s grace in `submit_guess`). Signed-in `start_game` locks per user, closes/counts any unfinished game and caps 30/hour.
- **New tables/functions in `public`:** Supabase's default privileges grant `anon`/`authenticated` everything — always `revoke all` and grant only what's needed, enable RLS, and give definer functions `set search_path = ''`.
- **No service-role key at runtime.** Players: security-definer RPCs. Admins: RLS policies using `public.is_admin()` with their own session. The service key is for local scripts only.
- **Admin gate**: middleware (`src/lib/supabase/middleware.ts`) + `checkAdmin()` in pages + `requireAdmin()` in every admin server action (`src/lib/require-admin.ts`). Never rely on middleware alone for server actions.
- **Leaflet can't render on the server**: `/play/[gameId]/page.tsx` loads the game with `next/dynamic({ ssr: false })`; the admin map is also dynamic. Keep it that way.
- **Guess map basemap** is self-drawn from `public/map/campus-basemap.json` (OSM geometry, no names/tags). Hosted "no labels" tiles either need a key (CARTO) or still print street names (Esri gray base). Satellite = Esri World Imagery.
- Mobile UX to preserve: collapsed "Open map" bar → bottom sheet, tap-to-expand overlay (never hover-only), outside-tap collapse (mousedown + touchstart), 44 px targets.

## Database
- `supabase/migrations/` — applied in order (`20261118183259_initial_schema` is the baseline already live; `20261120000001_real_places_and_server_games` adds everything new).
- `supabase/cutover/20261120000002_cutover_lock_places.sql` — run once ≥ 30 real places exist (it aborts otherwise): deletes placeholder rows, sets NOT NULL, revokes client reads of `places`. Then move it into `migrations/`.
- Local stack: `npx supabase start` (Docker), keys via `npx supabase status -o env`. Apply the cutover locally with `Get-Content -Raw supabase\cutover\*.sql | docker exec -i supabase_db_NUguessr psql -U postgres -d postgres`.

## Photo pipeline (`scripts/places/`, working data in git-ignored `data/`)
fetch (`fetch-commons`, `fetch-mapillary`, `fetch-own`) → `osm-names` → curation JSON in `data/curation/` (`batch-*`, `rescue-*` with crops, `review-*` overrides) → `select.ts` → `publish.ts` (sharp: rotate, crop, ≤2000 px, WebP, strip ALL metadata, `<uuid>.webp`) → `export.ts` (`data/places.manifest.json`, git-ignored: it's the answer key).
- Only licensed sources with coordinates (Commons CC BY/BY-SA/CC0/PD, Mapillary CC BY-SA, own photos). Never Google Street View, Northeastern sites, news or social media.
- Cropped photos must keep "(cropped)" in the license string (CC change notice).
- Curate at full resolution: a sign unreadable in a 960 px thumbnail can be readable at 1920 px.
- Be polite to Wikimedia: standard thumbnail widths (960/1280/1920), rate limits, the shared `politeFetch` User-Agent.

## Community submissions ("Add your photo", Nov 2026)
- Migration `20261123000001_community_photo_submissions`: private bucket `submissions` (originals, full EXIF), table `photo_submissions` (RLS: admins only; players never read it), RPCs `submit_photo`, `my_submissions` (status only, no contact/coords/notes), `withdraw_submission`. Source `community`, license `contributed`, credited by name only like `own`.
- Storage RLS: players upload only to `submissions/<auth.uid()>/<file>`, image extensions only, quota 30 uploads/day (`can_upload_submission()`); read/delete own objects only; no update policy. `submit_photo` re-checks path ownership, that the object exists, campus bbox (`on_campus()`), consent version (`contribute_consent_version()`, keep in sync with `CONSENT_VERSION` in the portfolio's `src/nuguessr/lib/contribute.ts`), 20/day per player, 500/day global.
- The answer is the contributor's **pin**, not the photo's EXIF (iOS often strips GPS; indoor GPS drifts). EXIF coords are stored only to flag disagreements.
- Pipeline: `places:fetch:submissions` → names → curate (rules in `docs/community-photos.md`; indoor allowed for `community`) → `select.ts` → `publish` → `places:submissions:sync` (approve/reject, delete originals from the bucket, sweep orphan uploads). Never keep originals in the cloud after a decision; `data/submissions/` is git-ignored.
- Tests: `npm run test:sql` (PGlite, offline), `tests/security/contribute-security.ts` (live, anon key only). The UI lives in the portfolio repo (`src/nuguessr/pages/Contribute.tsx`, `components/contribute/*`, e2e `src/test/e2e/nuguessr-contribute.spec.ts`).

## Commands
```
npm run dev | build | lint | typecheck
npm run test:e2e                      # Playwright, desktop + mobile (Edge channel); set E2E_BASE_URL to test a deployment
npx tsx tests/security/game-security.ts [--expect-locked] [--check-images N]   # anon-key leak/integrity checks
npx tsx tests/security/signed-in.ts   # LOCAL only: signed-in stats/role checks
npm run places:*                      # see README "Photo pipeline"
```

## Gotchas
- Windows + PowerShell 5.1: `npm run x -- --flag` drops the flag — call `npx tsx scripts/...` directly. Write files as UTF-8 without BOM (`[IO.File]::WriteAllText`).
- `next.config.ts` keeps `eslint.ignoreDuringBuilds: true`; `next` must stay ≥ 15.1.11.
- `src/components/signin-button.tsx` needs its `<Suspense>` wrapper (useSearchParams).
- Decisions and their reasons: `DECISIONS.md`.
