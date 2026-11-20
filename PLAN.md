# Real-photos overhaul — plan

Branch: `feat/real-photos`. Owner/maintainer: Mehr Anand (`mesanand`).

## Architecture (target)

- **Answers live in Postgres, never in the browser before a guess.** `places`
  stores curated `lat/lng/name/notes` + photo licensing metadata. After cutover,
  `anon`/`authenticated` cannot select from `places` at all.
- **Games are server-recorded.** Security-definer RPCs `start_game`, `get_game`,
  `submit_guess`, `finish_game` (migration `20261120000001`) pick rounds, score
  guesses (same yard-based curve as before) and update `users` stats. The Next.js
  server actions in `src/app/play/actions.ts` just call them with the player's session.
- **No service-role key at runtime.** Admin writes (curation UI, storage uploads)
  go through RLS policies gated by `public.is_admin()` using the admin's own session.
  Scripts use `SUPABASE_SERVICE_ROLE_KEY` when available.
- **Photos**: Wikimedia Commons (+ Mapillary when `MAPILLARY_TOKEN` is set, + own
  photos) → `data/candidates.json` → AI curation (vision) → `data/selected.json`
  → `places:publish` (sharp: rotate, strip ALL metadata, ≤2000 px, WebP q82,
  `<uuid>.webp`) → `images` bucket + `places` rows.
- **Guess map**: CARTO `light_nolabels` + Esri World Imagery toggle, locked to
  `src/lib/campus.ts` bounds.

## Contracts

### Server actions (`src/app/play/actions.ts`, types in `src/lib/game-types.ts`)
- `startGame(): ActionResult<GameState>` — rounds carry `imageUrl` only.
- `getGame(gameId): ActionResult<GameState>` — submitted rounds include `result`.
- `submitGuess(gameId, roundIndex, {lat,lng} | null): ActionResult<SubmitResult>` — in order, once each; `null` = timeout (0 pts).
- `finishGame(gameId): ActionResult<FinishResult>` — idempotent; updates stats for signed-in players.

### Data files (`data/`, git-ignored except `places.manifest.json`)
- `data/candidates.json` — `Candidate[]` (see `scripts/places/lib/types.ts`).
- `data/cache/<source>-<source_id>.jpg` — ~1024 px review thumbnails.
- `data/curation/batch-*.json` — `CurationDecision[]` from AI reviewers.
- `data/selected.json` — final picks (candidate + curation fields).
- `data/publish/` — processed `<uuid>.webp`, `published.json` (idempotency map), `places.sql`.
- `data/places.manifest.json` — committed backup of published places.

## Workstreams & file ownership

| WS | Owner | Files |
|----|-------|-------|
| A | orchestrator | `supabase/**`, `src/lib/{campus,scoring,game-types}.ts`, `src/app/play/actions.ts`, `src/lib/user-stats.ts`, `package.json`, `.gitignore`, `PLAN.md`, `DECISIONS.md` |
| B | pipeline agent | `scripts/places/**` except `publish.ts`; may tune numbers in `src/lib/campus.ts` |
| C | game UI agent | `src/app/play/[hash]/**`, `src/components/map-result.tsx`, `src/components/timer.tsx`, `src/components/game/**`, `src/app/page.tsx`, `src/app/play-finish/**`, `src/app/credits/**`, `src/lib/places.ts` (delete) |
| D | admin/publish agent | `src/lib/require-admin.ts`, `src/lib/get-user-role.ts`, `middleware.ts`, `src/lib/supabase/middleware.ts`, `src/app/admin/**`, `src/lib/publish-image.ts`, `scripts/places/publish.ts` |
| D' | curation agents | `data/curation/batch-*.json` (one batch file each) |
| E | orchestrator + reviewer | integration, `tests/e2e/**`, `playwright.config.ts`, docs |

## Order
1. A writes migrations + contracts (done first), local Supabase stack for testing.
2. B, C, D in parallel.
3. D' curation agents on B's candidates → selection → publish (local stack, then prod when allowed).
4. E: lint/tsc/build, e2e desktop+mobile, leak checks, independent review ×2, docs, push.
