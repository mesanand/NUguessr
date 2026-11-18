# NUGuessr

NUGuessr is an interactive web game where players guess the location of landmarks at Northeastern University's Boston campus. Inspired by GeoGuessr, this project aims to assist NUIn and transfer students in becoming familiar with the campus layout while having fun!

> **This is a community fork.** The original NUGuessr was built by **Philip Elbert, Joshua Chan, Oscar Ji, and Alan Tai** for HackBeanpot 2025, where it won "First Pit Stop - Best Beginner." This fork polishes and finishes several things the original Devpost submission called out as still in progress (see [Changes in this fork](#changes-in-this-fork)). All credit for the original concept, design, and build goes to that team.

## Features
- **Interactive Gameplay**: Players are presented with a picture of a location on campus and must determine its location through an interactive map.
- **Scoring System**: Players receive a score based on the accuracy and speed of their guesses.
- **Educational Tool**: Helps new students learn the campus layout, making it easier for them to navigate in real life.
- **Leaderboards & profile stats**: real high score, games played, and average score, backed by Supabase.

## How to Play
1. Users are given a picture of somewhere on campus.
2. Users must guess where the location is on campus.
3. Submit your answer to receive feedback and a score based on performance.
4. Challenge yourself to improve your score and become a campus navigation pro!

## Technologies Used
- Next.js (TypeScript)
- Supabase (database, auth, storage)
- Google OAuth 2.0 (via Supabase Auth)
- Leaflet / react-leaflet

## Running it locally

1. Create a free [Supabase](https://supabase.com) project.
2. In the Supabase SQL editor, run [`supabase/schema.sql`](./supabase/schema.sql) — it creates the `places`/`users` tables, the public leaderboard view, and the `images` storage bucket with the policies the app expects.
3. Enable the **Google** provider under Authentication -> Providers in your Supabase project, and point it at your own Google Cloud OAuth credentials.
4. Upload a few campus photos (with GPS EXIF data intact) to the `images` storage bucket, and add a matching row to `places` for each one — `image_url` is the path within that bucket, `notes` is the optional "fun fact" shown after a guess.
5. Copy `.env.example` to `.env.local` and fill in your project's URL/keys.
6. `npm install && npm run dev`

## Changes in this fork

The original Devpost submission described NUGuessr as a "functional prototype" with leaderboards and user stats still to be finished. This fork closes those gaps and fixes a few bugs found along the way:

- High scores, games played, and average score are now actually computed and saved (the original write path had a bug that updated the wrong column and never computed an average).
- The leaderboard now reads real data from Supabase instead of a hardcoded mock list.
- Profile page now shows your real high score/average instead of hardcoded placeholder numbers, and username edits are actually persisted.
- Removed a couple of orphaned/unused scaffold files left over from the original build (`src/app/components/map-result.tsx`, `src/app/results/page.tsx`) that duplicated or were superseded by other components.
- Added `supabase/schema.sql` and `.env.example` so the project can be stood up on a fresh Supabase project from scratch — the original repo depended on an existing (unshared) backend.
- Added this fork's MIT license — the original repo had none.

### Known limitations / good next steps
- "% of campus discovered" was mocked in the original profile page and has been removed rather than left faked; tracking which specific landmarks a user has seen would need a small join table (e.g. `user_place_visits`) and is a natural next feature.
- No admin UI for adding new campus photos/locations yet — it's a manual Supabase insert for now.
