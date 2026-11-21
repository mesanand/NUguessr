-- =====================================================================
-- Migration 1: real places, server-recorded games, security fixes.
--
-- NOT safe while the old app is live: it revokes client reads of `places`
-- (the old client reads it directly). Apply it together with publishing the
-- real places, the cutover and the new deploy — see FINAL_REPORT.md.
--
-- * places gains curated answer coordinates + photo licensing metadata
-- * place_candidates holds sourced photos waiting for (AI or admin) review
-- * games / game_rounds record every game server-side
-- * start_game / get_game / submit_guess / finish_game RPCs do all scoring
--   in the database (security definer), so the browser never sees an answer
--   before guessing and can't write its own score
-- * is_admin() + admin-only write policies (no service-role key needed at
--   runtime: an admin's own session can curate/upload)
-- * closes a privilege-escalation hole: signed-in users could previously
--   update any column of their own users row, including `role`
--
-- Deleting the placeholder rows and making the answer columns NOT NULL is in
-- supabase/cutover/ (it needs >= 30 real places to exist first).
-- =====================================================================

-- ---------------------------------------------------------------------
-- places: curated answer + licensing metadata
-- ---------------------------------------------------------------------
alter table public.places
  add column if not exists lat double precision,
  add column if not exists lng double precision,
  add column if not exists name text,
  add column if not exists source text,
  add column if not exists source_id text,
  add column if not exists source_url text,
  add column if not exists author text,
  add column if not exists license text,
  add column if not exists attribution text,
  add column if not exists heading double precision,
  add column if not exists difficulty smallint,
  add column if not exists active boolean not null default true;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'places_source_check') then
    alter table public.places
      add constraint places_source_check check (source in ('mapillary', 'wikimedia', 'own'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'places_difficulty_check') then
    alter table public.places
      add constraint places_difficulty_check check (difficulty between 1 and 3);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'places_source_unique') then
    alter table public.places
      add constraint places_source_unique unique (source, source_id);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- place_candidates: sourced photos awaiting review
-- ---------------------------------------------------------------------
create table if not exists public.place_candidates (
  id bigint generated always as identity primary key,
  source text not null check (source in ('mapillary', 'wikimedia', 'own')),
  source_id text not null,
  source_url text,
  image_remote_url text not null,
  lat double precision not null,
  lng double precision not null,
  heading double precision,
  author text,
  license text,
  attribution text,
  captured_at timestamptz,
  width integer,
  height integer,
  title text,                       -- original title (e.g. Commons file name); admin-only
  suggested_name text,              -- nearest named OSM feature / title-derived
  name text,                        -- final display name chosen in review
  notes text,                       -- fun fact chosen in review
  difficulty smallint check (difficulty between 1 and 3),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  review_notes text,
  ai_scores jsonb,
  place_id bigint references public.places (id) on delete set null,  -- set once published
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, source_id)
);

alter table public.place_candidates enable row level security;

-- ---------------------------------------------------------------------
-- games / game_rounds: server-recorded games (no direct client access)
-- ---------------------------------------------------------------------
create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  place_ids bigint[] not null,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  total_score integer,
  -- Rounds are revealed one at a time: only rounds <= revealed_round have
  -- their photo returned, and the current round has a server-side deadline
  -- counted from round_started_at.
  revealed_round smallint,
  round_started_at timestamptz,
  -- true when the game was closed because the player abandoned it
  abandoned boolean not null default false
);

alter table public.games add column if not exists revealed_round smallint;
alter table public.games add column if not exists round_started_at timestamptz;
alter table public.games add column if not exists abandoned boolean not null default false;

create table if not exists public.game_rounds (
  game_id uuid not null references public.games (id) on delete cascade,
  round_index smallint not null,
  place_id bigint not null references public.places (id) on delete cascade,
  guess_lat double precision,
  guess_lng double precision,
  distance_yards integer,
  points integer not null,
  submitted_at timestamptz not null default now(),
  -- guessed after the server-side deadline (scored 0)
  late boolean not null default false,
  primary key (game_id, round_index)
);

alter table public.game_rounds add column if not exists late boolean not null default false;

create index if not exists games_user_id_idx on public.games (user_id, created_at);

alter table public.games enable row level security;
alter table public.game_rounds enable row level security;
revoke all on public.games from anon, authenticated;
revoke all on public.game_rounds from anon, authenticated;

-- ---------------------------------------------------------------------
-- Users: only the username is client-writable. Stats are written by
-- finish_game(); rows are created by the handle_new_user trigger.
-- ---------------------------------------------------------------------
revoke insert, update, delete, truncate on public.users from anon, authenticated;
grant update (username) on public.users to authenticated;
-- Usernames appear on the public leaderboard.
alter table public.users drop constraint if exists users_username_length;
alter table public.users add constraint users_username_length
  check (username is null or char_length(btrim(username)) between 1 and 32);
drop policy if exists "Users can insert their own row" on public.users;

-- Views the client only reads.
revoke insert, update, delete, truncate, references, trigger on public.leaderboard_public from anon, authenticated;

-- places now holds the answers (lat/lng/name), so clients must not read it
-- at all: the game gets photos via start_game/get_game and answers via
-- submit_guess. Locked here (not at cutover) so answers are never readable,
-- even while real places are being published. Admins read/write through
-- the "Admins manage places" RLS policy below.
drop policy if exists "Places are publicly readable" on public.places;
revoke all on public.places from anon, authenticated;
grant select on public.places to authenticated;  -- RLS: admins only

-- The public bucket serves objects by URL without any policy; a SELECT
-- policy on storage.objects would only let anyone LIST every photo.
drop policy if exists "Campus images are publicly readable" on storage.objects;

-- Pre-existing trigger function: pin search_path like every other definer.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.users (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- is_admin(): app_metadata.role (set by a project owner) OR users.role.
-- users.role is no longer client-writable (see above), so both are safe.
-- ---------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false)
      or exists (
        select 1 from public.users u
        where u.id = auth.uid() and u.role = 'admin'
      );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

-- Admins can list all players on /admin (is_admin is security definer, so
-- this policy doesn't recurse through users RLS).
drop policy if exists "Admins can read all users" on public.users;
create policy "Admins can read all users"
  on public.users for select to authenticated
  using ((select public.is_admin()));

-- Admin-only writes (curation UI uses the admin's own session).
drop policy if exists "Admins manage places" on public.places;
create policy "Admins manage places"
  on public.places for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
grant insert, update, delete on public.places to authenticated;  -- RLS: admins only

drop policy if exists "Admins manage candidates" on public.place_candidates;
create policy "Admins manage candidates"
  on public.place_candidates for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
revoke all on public.place_candidates from anon, authenticated;
grant select, insert, update, delete on public.place_candidates to authenticated;

drop policy if exists "Admins can upload campus images" on storage.objects;
create policy "Admins can upload campus images"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'images' and (select public.is_admin()));

drop policy if exists "Admins can update campus images" on storage.objects;
create policy "Admins can update campus images"
  on storage.objects for update to authenticated
  using (bucket_id = 'images' and (select public.is_admin()));

drop policy if exists "Admins can delete campus images" on storage.objects;
create policy "Admins can delete campus images"
  on storage.objects for delete to authenticated
  using (bucket_id = 'images' and (select public.is_admin()));

-- ---------------------------------------------------------------------
-- Scoring (the single source of truth; keep in sync with src/lib/scoring.ts
-- constants). Same curve as the original client code:
--   distance in yards (haversine, Earth radius 3959 mi * 1760)
--   < 12 yd -> 5000 pts, else max(0, round(5000 * (1 - d / 500)))
-- ---------------------------------------------------------------------
create or replace function public.distance_yards(
  lat1 double precision, lng1 double precision,
  lat2 double precision, lng2 double precision
)
returns integer
language sql
immutable
set search_path = ''
as $$
  select round((
    3959 * 1760 * 2 * atan2(
      sqrt(
        sin(radians(lat2 - lat1) / 2) ^ 2
        + cos(radians(lat1)) * cos(radians(lat2)) * sin(radians(lng2 - lng1) / 2) ^ 2
      ),
      sqrt(1 - (
        sin(radians(lat2 - lat1) / 2) ^ 2
        + cos(radians(lat1)) * cos(radians(lat2)) * sin(radians(lng2 - lng1) / 2) ^ 2
      ))
    )
  )::numeric)::integer;
$$;

create or replace function public.round_points(distance integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when distance is null then 0
    when distance < 12 then 5000
    else greatest(0, round((5000 * (1 - distance / 500.0))::numeric)::integer)
  end;
$$;

-- ---------------------------------------------------------------------
-- random_active_places(n): ids of playable places in random order
-- ---------------------------------------------------------------------
create or replace function public.random_active_places(n integer)
returns setof bigint
language sql
volatile
security definer
set search_path = ''
as $$
  select p.id
  from public.places p
  where p.active and p.lat is not null and p.lng is not null
  order by random()
  limit greatest(0, least(n, 20));
$$;

revoke all on function public.random_active_places(integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Game RPCs.
--  * Rounds are revealed one at a time: a round's photo is returned only
--    once it is the current round, so photos can't be pre-fetched, and the
--    current round's 45 s deadline is enforced here (plus a grace period
--    for latency). A late guess scores 0, like a timeout.
--  * Nothing about a place (coordinates, name, notes, source link) is
--    returned before that round is submitted.
--  * Signed-in players: starting a new game closes any unfinished one and
--    counts it (missing rounds = 0) so restarting until you get easy photos
--    doesn't pay off, and at most 30 games per hour.
-- ---------------------------------------------------------------------
create or replace function public.round_seconds()
returns integer language sql immutable set search_path = '' as $$ select 45 $$;

-- Internal: close a game, sum its rounds and update the owner's stats once.
create or replace function public.finalize_game(p_game_id uuid, p_abandoned boolean)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  g public.games;
  total integer;
  prev public.users;
begin
  select * into g from public.games where id = p_game_id for update;
  if not found then
    raise exception 'game_not_found' using errcode = 'P0001';
  end if;
  if g.finished_at is not null then
    return g.total_score;
  end if;

  select coalesce(sum(points), 0) into total from public.game_rounds where game_id = g.id;
  update public.games
    set finished_at = now(), total_score = total, abandoned = p_abandoned
    where id = g.id;

  if g.user_id is not null then
    insert into public.users (id, total_games, high_score, avg_score)
    values (g.user_id, 0, 0, 0)
    on conflict (id) do nothing;

    select * into prev from public.users where id = g.user_id for update;
    update public.users set
      total_games = prev.total_games + 1,
      high_score = greatest(prev.high_score, total),
      avg_score = round(((prev.avg_score::numeric * prev.total_games) + total) / (prev.total_games + 1))::integer
    where id = g.user_id;
  end if;
  return total;
end;
$$;

revoke all on function public.finalize_game(uuid, boolean) from public, anon, authenticated;

-- get_game(id, reveal): read a game. With p_reveal = true it also starts the
-- next round (returns its photo and starts its clock) if it hasn't started
-- yet; with false it has no side effects, so reloading a results screen
-- doesn't silently start the next round's clock.
drop function if exists public.get_game(uuid);
create or replace function public.get_game(p_game_id uuid, p_reveal boolean default false)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  g public.games;
  n integer;
  cur integer;
  is_live boolean;
  result jsonb;
begin
  select * into g from public.games where id = p_game_id for update;
  if not found then
    return null;
  end if;
  if g.user_id is not null and g.user_id is distinct from auth.uid() then
    raise exception 'not_your_game' using errcode = 'P0001';
  end if;

  n := array_length(g.place_ids, 1);
  select count(*) into cur from public.game_rounds where game_id = g.id;

  -- Reveal the current round (starts its clock) only when asked to.
  if p_reveal and g.finished_at is null and cur < n
     and (g.revealed_round is null or g.revealed_round < cur) then
    update public.games set revealed_round = cur, round_started_at = now()
      where id = g.id
      returning * into g;
  end if;
  -- The current round is "live" once it has been revealed.
  is_live := g.finished_at is null and cur < n and g.revealed_round is not distinct from cur;

  select jsonb_build_object(
    'gameId', g.id,
    'finished', g.finished_at is not null,
    'totalScore', g.total_score,
    'roundSeconds', public.round_seconds(),
    'roundsSubmitted', cur,
    'currentRound', case when is_live then jsonb_build_object(
        'roundIndex', cur,
        'deadline', (extract(epoch from g.round_started_at + make_interval(secs => public.round_seconds())) * 1000)::bigint,
        'serverNow', (extract(epoch from clock_timestamp()) * 1000)::bigint
      ) else null end,
    'rounds', coalesce(jsonb_agg(
      jsonb_build_object(
        'roundIndex', r.ord - 1,
        -- photo only for submitted rounds and the live (revealed) round
        'imageUrl', case when r.ord - 1 < cur or (is_live and r.ord - 1 = cur) or g.finished_at is not null
                         then p.image_url else null end,
        'result', case when gr.game_id is null then null else jsonb_build_object(
          'actual', jsonb_build_object('lat', p.lat, 'lng', p.lng),
          'guess', case when gr.guess_lat is null then null
                   else jsonb_build_object('lat', gr.guess_lat, 'lng', gr.guess_lng) end,
          'name', p.name,
          'notes', p.notes,
          'distanceYards', gr.distance_yards,
          'points', gr.points,
          'late', gr.late,
          'credit', jsonb_build_object(
            'author', p.author, 'license', p.license,
            'source', p.source, 'sourceUrl', p.source_url)
        ) end
      ) order by r.ord
    ), '[]'::jsonb)
  ) into result
  from unnest(g.place_ids) with ordinality as r(place_id, ord)
  join public.places p on p.id = r.place_id
  left join public.game_rounds gr
    on gr.game_id = g.id and gr.round_index = r.ord - 1;

  return result;
end;
$$;

create or replace function public.start_game()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  ids bigint[];
  new_id uuid;
  open_game uuid;
begin
  if auth.uid() is not null then
    -- Serialize a player's start_game calls so parallel starts can't leave
    -- several open games or slip past the hourly limit.
    perform pg_advisory_xact_lock(hashtext('start_game:' || auth.uid()::text));
    if (select count(*) from public.games
        where user_id = auth.uid() and created_at > now() - interval '1 hour') >= 30 then
      raise exception 'rate_limited' using errcode = 'P0001';
    end if;
    -- Close (and count) any unfinished game: no free restarts.
    for open_game in
      select id from public.games where user_id = auth.uid() and finished_at is null
    loop
      perform public.finalize_game(open_game, true);
    end loop;
  else
    -- Anonymous games: global ceiling against table-filling abuse, and
    -- housekeeping of abandoned anonymous games (they never count anywhere).
    if (select count(*) from public.games
        where user_id is null and created_at > now() - interval '10 minutes') >= 2000 then
      raise exception 'rate_limited' using errcode = 'P0001';
    end if;
    delete from public.games
      where id in (
        select id from public.games
        where user_id is null and finished_at is null and created_at < now() - interval '1 day'
        limit 500
      );
  end if;

  select array_agg(x) into ids from public.random_active_places(5) as x;
  if ids is null or array_length(ids, 1) = 0 then
    raise exception 'no_places' using errcode = 'P0001';
  end if;

  insert into public.games (user_id, place_ids)
  values (auth.uid(), ids)
  returning id into new_id;

  return public.get_game(new_id, true);
end;
$$;

create or replace function public.submit_guess(
  p_game_id uuid,
  p_round_index integer,
  p_guess_lat double precision default null,
  p_guess_lng double precision default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  g public.games;
  submitted integer;
  pid bigint;
  p public.places;
  d integer;
  pts integer;
  total integer;
  late boolean := false;
begin
  select * into g from public.games where id = p_game_id for update;
  if not found then
    raise exception 'game_not_found' using errcode = 'P0001';
  end if;
  if g.user_id is not null and g.user_id is distinct from auth.uid() then
    raise exception 'not_your_game' using errcode = 'P0001';
  end if;
  if g.finished_at is not null then
    raise exception 'game_finished' using errcode = 'P0001';
  end if;

  select count(*) into submitted from public.game_rounds where game_id = g.id;
  if p_round_index is distinct from submitted then
    raise exception 'round_out_of_order' using errcode = 'P0001';
  end if;
  if p_round_index < 0 or p_round_index >= array_length(g.place_ids, 1) then
    raise exception 'round_out_of_range' using errcode = 'P0001';
  end if;
  if g.revealed_round is distinct from p_round_index or g.round_started_at is null then
    raise exception 'round_not_started' using errcode = 'P0001';
  end if;
  if (p_guess_lat is null) <> (p_guess_lng is null)
     or (p_guess_lat is not null and (abs(p_guess_lat) > 90 or abs(p_guess_lng) > 180)) then
    raise exception 'bad_guess' using errcode = 'P0001';
  end if;

  -- Server-side clock: 45 s + 10 s grace for latency.
  late := clock_timestamp() > g.round_started_at + make_interval(secs => public.round_seconds() + 10);

  pid := g.place_ids[p_round_index + 1];
  select * into p from public.places where id = pid;

  if p_guess_lat is null then
    d := null;     -- timeout: no guess
    pts := 0;
  else
    d := public.distance_yards(p_guess_lat, p_guess_lng, p.lat, p.lng);
    pts := case when late then 0 else public.round_points(d) end;
  end if;

  insert into public.game_rounds (game_id, round_index, place_id, guess_lat, guess_lng, distance_yards, points, late)
  values (g.id, p_round_index, pid, p_guess_lat, p_guess_lng, d, pts, late and p_guess_lat is not null);

  select coalesce(sum(points), 0) into total from public.game_rounds where game_id = g.id;

  return jsonb_build_object(
    'roundIndex', p_round_index,
    'isLastRound', p_round_index = array_length(g.place_ids, 1) - 1,
    'late', late and p_guess_lat is not null,
    'actual', jsonb_build_object('lat', p.lat, 'lng', p.lng),
    'guess', case when p_guess_lat is null then null
             else jsonb_build_object('lat', p_guess_lat, 'lng', p_guess_lng) end,
    'name', p.name,
    'notes', p.notes,
    'distanceYards', d,
    'points', pts,
    'totalSoFar', total,
    'credit', jsonb_build_object(
      'author', p.author, 'license', p.license,
      'source', p.source, 'sourceUrl', p.source_url)
  );
end;
$$;

create or replace function public.finish_game(p_game_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  g public.games;
  rounds_done integer;
  total integer;
begin
  select * into g from public.games where id = p_game_id;
  if not found then
    raise exception 'game_not_found' using errcode = 'P0001';
  end if;
  if g.user_id is not null and g.user_id is distinct from auth.uid() then
    raise exception 'not_your_game' using errcode = 'P0001';
  end if;
  if g.finished_at is null then
    select count(*) into rounds_done from public.game_rounds where game_id = g.id;
    if rounds_done < array_length(g.place_ids, 1) then
      raise exception 'game_incomplete' using errcode = 'P0001';
    end if;
  end if;

  -- Idempotent: finishing twice never double-counts stats.
  total := public.finalize_game(g.id, false);
  return jsonb_build_object('gameId', g.id, 'totalScore', total,
    'maxScore', 5000 * array_length(g.place_ids, 1), 'rounds', array_length(g.place_ids, 1));
end;
$$;

-- Photo credits for /credits: author, license and source site only, in
-- random order. No names, coordinates or per-file links — Commons file
-- names often name the building; each photo's file link is shown on the
-- results screen right after that photo is guessed.
drop function if exists public.photo_credits();
create function public.photo_credits()
returns table (author text, license text, source text)
language sql
volatile
security definer
set search_path = ''
as $$
  select p.author, p.license, p.source
  from public.places p
  where p.active and p.lat is not null
  order by random();
$$;

revoke all on function public.round_seconds() from public;
revoke all on function public.start_game() from public;
revoke all on function public.get_game(uuid, boolean) from public;
revoke all on function public.submit_guess(uuid, integer, double precision, double precision) from public;
revoke all on function public.finish_game(uuid) from public;
revoke all on function public.photo_credits() from public;
grant execute on function public.round_seconds() to anon, authenticated;
grant execute on function public.start_game() to anon, authenticated;
grant execute on function public.get_game(uuid, boolean) to anon, authenticated;
grant execute on function public.submit_guess(uuid, integer, double precision, double precision) to anon, authenticated;
grant execute on function public.finish_game(uuid) to anon, authenticated;
grant execute on function public.photo_credits() to anon, authenticated;
