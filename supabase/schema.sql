-- NUGuessr database schema
--
-- Run this in the Supabase SQL editor on a fresh project. It covers every
-- table/column the app actually queries (several of these were previously
-- undocumented and had to be reverse-engineered from the client code).

-- ---------------------------------------------------------------------
-- places: one row per campus photo used as a round. Location comes from
-- the EXIF GPS data embedded in the uploaded image itself, not a column
-- here — that's how the original game was built, so this fork keeps it.
-- ---------------------------------------------------------------------
create table if not exists public.places (
  id bigint generated always as identity primary key,
  image_url text not null,     -- path within the "images" storage bucket
  notes text,                  -- optional "fun fact" shown on the results screen
  created_at timestamptz not null default now()
);

alter table public.places enable row level security;

create policy "Places are publicly readable"
  on public.places for select
  using (true);

-- ---------------------------------------------------------------------
-- users: one row per authenticated player, keyed to auth.users.id.
-- ---------------------------------------------------------------------
create table if not exists public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  username text,
  role text not null default 'player',
  total_games integer not null default 0,
  high_score integer not null default 0,
  avg_score integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.users enable row level security;

create policy "Users can read their own row"
  on public.users for select
  using (auth.uid() = id);

create policy "Users can update their own row"
  on public.users for update
  using (auth.uid() = id);

create policy "Users can insert their own row"
  on public.users for insert
  with check (auth.uid() = id);

-- Seed a public.users row automatically whenever someone signs up, so the
-- admin page and leaderboard aren't empty until a user happens to finish a
-- game (the only path that wrote rows in the original build).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.users (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- leaderboard_public: the only thing the public leaderboard page reads.
-- Keeps email/role out of any client-facing query even if a `users`
-- select policy is ever loosened by mistake.
-- ---------------------------------------------------------------------
create or replace view public.leaderboard_public as
  select id, username, high_score, total_games, avg_score
  from public.users
  where total_games > 0;

grant select on public.leaderboard_public to anon, authenticated;

-- ---------------------------------------------------------------------
-- Storage: a public "images" bucket holding the campus photos (with GPS
-- EXIF data intact — don't let an image-optimizer strip it on upload).
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('images', 'images', true)
on conflict (id) do nothing;

create policy "Campus images are publicly readable"
  on storage.objects for select
  using (bucket_id = 'images');
