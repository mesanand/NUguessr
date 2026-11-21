-- =====================================================================
-- Migration 1 (additive, safe to run while the old app is still live)
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
-- The read lock-down on places (and deleting the placeholder rows) is in
-- migration 2, applied at cutover, because the old client reads places
-- directly.
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
  total_score integer
);

create table if not exists public.game_rounds (
  game_id uuid not null references public.games (id) on delete cascade,
  round_index smallint not null,
  place_id bigint not null references public.places (id) on delete cascade,
  guess_lat double precision,
  guess_lng double precision,
  distance_yards integer,
  points integer not null,
  submitted_at timestamptz not null default now(),
  primary key (game_id, round_index)
);

create index if not exists games_user_id_idx on public.games (user_id);

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
drop policy if exists "Users can insert their own row" on public.users;

-- Views/tables the client only reads.
revoke insert, update, delete, truncate, references, trigger on public.leaderboard_public from anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on public.places from anon, authenticated;

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
grant insert, update, delete on public.places to authenticated;

drop policy if exists "Admins manage candidates" on public.place_candidates;
create policy "Admins manage candidates"
  on public.place_candidates for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
revoke all on public.place_candidates from anon;
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
-- Game RPCs. Only image paths are returned before a guess.
-- ---------------------------------------------------------------------
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
begin
  select array_agg(x) into ids from public.random_active_places(5) as x;
  if ids is null or array_length(ids, 1) = 0 then
    raise exception 'no_places' using errcode = 'P0001';
  end if;

  insert into public.games (user_id, place_ids)
  values (auth.uid(), ids)
  returning id into new_id;

  return public.get_game(new_id);
end;
$$;

create or replace function public.get_game(p_game_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  g public.games;
  result jsonb;
begin
  select * into g from public.games where id = p_game_id;
  if not found then
    return null;
  end if;
  if g.user_id is not null and g.user_id is distinct from auth.uid() then
    raise exception 'not_your_game' using errcode = 'P0001';
  end if;

  select jsonb_build_object(
    'gameId', g.id,
    'finished', g.finished_at is not null,
    'totalScore', g.total_score,
    'rounds', coalesce(jsonb_agg(
      jsonb_build_object(
        'roundIndex', r.ord - 1,
        'imageUrl', p.image_url,
        -- results only for rounds already submitted
        'result', case when gr.game_id is null then null else jsonb_build_object(
          'actual', jsonb_build_object('lat', p.lat, 'lng', p.lng),
          'guess', case when gr.guess_lat is null then null
                   else jsonb_build_object('lat', gr.guess_lat, 'lng', gr.guess_lng) end,
          'name', p.name,
          'notes', p.notes,
          'distanceYards', gr.distance_yards,
          'points', gr.points,
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
  if (p_guess_lat is null) <> (p_guess_lng is null)
     or (p_guess_lat is not null and (abs(p_guess_lat) > 90 or abs(p_guess_lng) > 180)) then
    raise exception 'bad_guess' using errcode = 'P0001';
  end if;

  pid := g.place_ids[p_round_index + 1];
  select * into p from public.places where id = pid;

  if p_guess_lat is null then
    d := null;     -- timeout: no guess
    pts := 0;
  else
    d := public.distance_yards(p_guess_lat, p_guess_lng, p.lat, p.lng);
    pts := public.round_points(d);
  end if;

  insert into public.game_rounds (game_id, round_index, place_id, guess_lat, guess_lng, distance_yards, points)
  values (g.id, p_round_index, pid, p_guess_lat, p_guess_lng, d, pts);

  select coalesce(sum(points), 0) into total from public.game_rounds where game_id = g.id;

  return jsonb_build_object(
    'roundIndex', p_round_index,
    'isLastRound', p_round_index = array_length(g.place_ids, 1) - 1,
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
  prev public.users;
begin
  select * into g from public.games where id = p_game_id for update;
  if not found then
    raise exception 'game_not_found' using errcode = 'P0001';
  end if;
  if g.user_id is not null and g.user_id is distinct from auth.uid() then
    raise exception 'not_your_game' using errcode = 'P0001';
  end if;

  -- Idempotent: finishing twice never double-counts stats.
  if g.finished_at is not null then
    return jsonb_build_object('gameId', g.id, 'totalScore', g.total_score,
      'maxScore', 5000 * array_length(g.place_ids, 1), 'rounds', array_length(g.place_ids, 1));
  end if;

  select count(*), coalesce(sum(points), 0) into rounds_done, total
  from public.game_rounds where game_id = g.id;
  if rounds_done < array_length(g.place_ids, 1) then
    raise exception 'game_incomplete' using errcode = 'P0001';
  end if;

  update public.games set finished_at = now(), total_score = total where id = g.id;

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

  return jsonb_build_object('gameId', g.id, 'totalScore', total,
    'maxScore', 5000 * array_length(g.place_ids, 1), 'rounds', array_length(g.place_ids, 1));
end;
$$;

-- Photo credits for /credits: no names or coordinates, random order.
create or replace function public.photo_credits()
returns table (author text, license text, source text, source_url text)
language sql
volatile
security definer
set search_path = ''
as $$
  select p.author, p.license, p.source, p.source_url
  from public.places p
  where p.active and p.lat is not null
  order by random();
$$;

revoke all on function public.start_game() from public;
revoke all on function public.get_game(uuid) from public;
revoke all on function public.submit_guess(uuid, integer, double precision, double precision) from public;
revoke all on function public.finish_game(uuid) from public;
revoke all on function public.photo_credits() from public;
grant execute on function public.start_game() to anon, authenticated;
grant execute on function public.get_game(uuid) to anon, authenticated;
grant execute on function public.submit_guess(uuid, integer, double precision, double precision) to anon, authenticated;
grant execute on function public.finish_game(uuid) to anon, authenticated;
grant execute on function public.photo_credits() to anon, authenticated;
