# NUGuessr

NUGuessr is an interactive web game where players guess the location of landmarks at Northeastern University's Boston campus. Inspired by GeoGuessr, this project aims to assist NUIn and transfer students in becoming familiar with the campus layout while having fun!

> **This is a community fork.** The original NUGuessr was built by **Philip Elbert, Joshua Chan, Oscar Ji, and Alan Tai** for HackBeanpot 2025, where it won "First Pit Stop - Best Beginner." This fork polishes and finishes several things the original Devpost submission called out as still in progress (see [Changes in this fork](#changes-in-this-fork)). All credit for the original concept, design, and build goes to that team.

Maintained by Mehr Anand ([@mesanand](https://github.com/mesanand)). Live at <https://nuguessr.vercel.app>.

## Features
- **Real campus photos**: every round is a real, freely licensed photograph taken on or around the Boston campus, curated so nothing in the frame names the place.
- **Label-free guess map**: a self-drawn campus map (buildings, paths, green space — no names) with a satellite toggle, locked to campus.
- **Server-side scoring**: guesses are scored in the database against curated coordinates; the browser never sees the answer before guessing and can't edit its score.
- **Results with credit**: after each guess you see the place name, both pins, the distance, your points and the photo credit.
- **Leaderboards & profile stats**: high score, games played and average score, updated only from server-recorded games.

## How to Play
1. Start a game: you get five photos of somewhere on campus, 45 seconds each.
2. Open the map and drop a pin where you think the photo was taken (switch to satellite if it helps).
3. Submit: the closer you are, the more points (5,000 within 12 yards, falling to 0 at 500 yards).
4. Sign in to save your stats and climb the leaderboard.

## Architecture

| Piece | Where | Notes |
|---|---|---|
| Game logic & scoring | `supabase/migrations/*real_places_and_server_games.sql` | Security-definer RPCs `start_game`, `get_game`, `submit_guess`, `finish_game`. Rounds must be submitted in order, once each; scoring is `distance_yards` + `round_points` in SQL. |
| Server actions | `src/app/play/actions.ts` | Thin wrappers that call the RPCs with the player's session. |
| Game UI | `src/components/game/`, `src/components/map-result.tsx`, `src/app/play/[gameId]/` | `/play/<gameId>` (uuid). Leaflet is loaded client-only. |
| Guess map basemap | `public/map/campus-basemap.json` | OSM geometry with **no names or tags**, built by `scripts/places/build-basemap.ts`. Satellite: Esri World Imagery. |
| Data model | `places` (curated answer + license metadata), `place_candidates`, `games`, `game_rounds`, `users` | After cutover, clients cannot read `places` at all. |
| Admin | `/admin`, `/admin/curate` | Gated by `is_admin()` (`app_metadata.role` or `users.role` = `admin`) in middleware, pages and every server action. |
| Photo pipeline | `scripts/places/` | Sourcing → AI/admin curation → metadata-stripping publish. |

No service-role key is needed at runtime: players use RPCs, and admins write through RLS policies with their own session.

## Running locally

1. Create a free [Supabase](https://supabase.com) project (or run one locally with `npx supabase start`, which applies `supabase/migrations/` automatically).
2. Apply the migrations in `supabase/migrations/` in order (Supabase CLI: `npx supabase db push`, or paste them into the SQL editor). `supabase/schema.sql` is a reference copy of the full schema.
3. Enable the **Google** provider under Authentication → Providers and point it at your Google Cloud OAuth credentials.
4. Copy `.env.example` to `.env.local` and fill in the URL and anon key (plus `SUPABASE_SERVICE_ROLE_KEY` if you'll run the photo pipeline).
5. Publish some places (see below), then apply `supabase/cutover/20261120000002_cutover_lock_places.sql` once at least 30 have coordinates.
6. `npm install && npm run dev`

Make yourself an admin (SQL editor, after signing in once):
```sql
update public.users set role = 'admin' where email = 'you@example.com';
```

## Photo pipeline

Only sources that grant reuse **and** give real coordinates are used. Never Google Maps/Street View, Northeastern's websites, news sites or social media.

```bash
npm run places:fetch:commons     # Wikimedia Commons geosearch -> data/candidates.json + data/cache thumbnails
npm run places:fetch:mapillary   # Mapillary street-level photos (needs MAPILLARY_TOKEN)
npm run places:fetch:own         # your own phone photos from data/own/ (JPEG/HEIC with GPS)
npm run places:names             # suggest a name from nearby OpenStreetMap features
npm run places:coverage          # candidate counts per campus area
npx tsx scripts/places/select.ts # curation decisions -> data/selected.json
npm run places:publish           # strip metadata, resize, upload <uuid>.webp, insert places rows
npm run places:export            # back up published places to data/places.manifest.json
npx tsx scripts/places/build-basemap.ts   # rebuild the label-free guess-map basemap
```

**Curation.** Candidates are reviewed by looking at each photo: outdoor campus scene, sharp enough, recognizable, pin plausibly where the camera stood, and **no readable text naming the place** (building names, station signs, banners). Decisions are JSON files in `data/curation/` (`batch-*` first pass, `rescue-*` crops that cut a sign out of an otherwise good photo, `review-*` final overrides); `select.ts` keeps one photo per spot and caps each area so no corner of campus dominates. Admins can also review candidates in `/admin/curate` (A approve, R reject, S skip, drag the pin).

**Publishing** (`src/lib/publish-image.ts`): auto-rotate, optional crop, resize to ≤ 2000 px, WebP q82, and **all metadata removed** (EXIF/GPS/XMP/IPTC/ICC); files get random UUID names. The script is idempotent and polite to Wikimedia (standard thumbnail sizes, rate limits, descriptive User-Agent).

### Adding your own photos
1. Take photos outdoors on campus with location services on (the GPS in the photo is used as the answer — stand where you want the pin).
2. Drop them in `data/own/` (JPEG or HEIC) and run `npm run places:fetch:own` (set `OWN_PHOTO_AUTHOR` to credit yourself).
3. Review them (curation JSON or `/admin/curate`), then `npx tsx scripts/places/select.ts` and `npm run places:publish`.

## Attribution & licensing
- Photos come from **Wikimedia Commons** (CC BY, CC BY-SA, CC0 or public domain) and, when configured, **Mapillary** (CC BY-SA 4.0). Each place stores author, license and a source link; the credit is shown under the photo after every guess and all credits are listed at `/credits`. Photos that were cropped to remove a sign say "(cropped)" in their license credit, as CC licenses require indicating changes.
- Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (ODbL); satellite imagery © Esri and its partners.
- Code: MIT (see `LICENSE`).

## Changes in this fork

The original Devpost submission described NUGuessr as a "functional prototype" with leaderboards and user stats still to be finished. This fork closes those gaps and fixes a few bugs found along the way:

- High scores, games played, and average score are now actually computed and saved (the original write path had a bug that updated the wrong column and never computed an average).
- The leaderboard now reads real data from Supabase instead of a hardcoded mock list.
- Profile page now shows your real high score/average instead of hardcoded placeholder numbers, and username edits are actually persisted.
- Removed a couple of orphaned/unused scaffold files left over from the original build (`src/app/components/map-result.tsx`, `src/app/results/page.tsx`) that duplicated or were superseded by other components.
- Added `supabase/schema.sql` and `.env.example` so the project can be stood up on a fresh Supabase project from scratch — the original repo depended on an existing (unshared) backend.
- Added this fork's MIT license — the original repo had none.
- Real, licensed campus photos replace the placeholder cards; answers are curated coordinates stored server-side instead of EXIF in the image.
- Server-recorded games and scoring; players can no longer edit their own stats or role.
- Label-free, campus-locked guess map with a satellite toggle; `/credits` page; `/admin/curate`.

### Known limitations / good next steps
- "% of campus discovered" was mocked in the original profile page and has been removed rather than left faked; tracking which specific landmarks a user has seen would need a small join table (e.g. `user_place_visits`) and is a natural next feature.
- The 45-second round timer is enforced in the browser only.
- Commons coverage is thin in some areas (e.g. Krentzman Quad, Matthews Arena, interior quads without readable-sign-free shots); a Mapillary token or a walk around campus with a phone (`data/own/`) will add more places.
