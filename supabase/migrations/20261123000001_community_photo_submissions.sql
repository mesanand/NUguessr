-- =====================================================================
-- Community photo submissions ("Add your photo" at /nuguessr/contribute).
--
-- Flow: a player (anonymous Supabase session is fine) uploads an ORIGINAL
-- photo straight to the PRIVATE `submissions` bucket under their own folder
-- (<auth.uid()>/<uuid>.<ext>), then calls submit_photo() with the pin, the
-- optional EXIF location, credit and consent. Nothing is public until an
-- admin runs the local pipeline (scripts/places/fetch-submissions.ts ->
-- curation -> publish.ts), which re-encodes the photo with ALL metadata
-- stripped into the public `images` bucket and then deletes the original.
--
-- Invariants kept from earlier migrations:
-- * no service-role key at runtime: players use RLS + security-definer RPCs
-- * revoke all on anything new, grant the minimum, RLS on,
--   definer functions use search_path = ''
-- * players can never read anyone's submission rows or files
-- =====================================================================

-- ---------------------------------------------------------------------
-- New photo source: 'community'
-- ---------------------------------------------------------------------
alter table public.places drop constraint if exists places_source_check;
alter table public.places
  add constraint places_source_check check (source in ('mapillary', 'wikimedia', 'own', 'community'));

alter table public.place_candidates drop constraint if exists place_candidates_source_check;
alter table public.place_candidates
  add constraint place_candidates_source_check check (source in ('mapillary', 'wikimedia', 'own', 'community'));

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------

-- Campus bounds; keep in sync with CAMPUS_BOUNDS in src/lib/campus.ts (both
-- repos). The pipeline applies the exact OSM campus polygon later; this is
-- the coarse server-side gate.
create or replace function public.on_campus(p_lat double precision, p_lng double precision)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_lat is not null and p_lng is not null
     and p_lat between 42.334 and 42.3456
     and p_lng between -71.096 and -71.082;
$$;

-- The consent text the client shows; bump both together when the wording
-- changes (src/nuguessr/lib/contribute.ts in the portfolio repo).
create or replace function public.contribute_consent_version()
returns text
language sql
immutable
set search_path = ''
as $$ select '2026-11-v1'::text $$;

-- Trim, collapse whitespace, drop control characters; null when empty.
create or replace function public.clean_short_text(p_value text, p_max integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(
    left(btrim(regexp_replace(regexp_replace(coalesce(p_value, ''), '[[:cntrl:]]', ' ', 'g'), '\s+', ' ', 'g')), p_max),
    ''
  );
$$;

revoke all on function public.on_campus(double precision, double precision) from public, anon, authenticated;
revoke all on function public.contribute_consent_version() from public, anon, authenticated;
revoke all on function public.clean_short_text(text, integer) from public, anon, authenticated;
grant execute on function public.contribute_consent_version() to anon, authenticated;

-- ---------------------------------------------------------------------
-- Private bucket for original uploads
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'submissions', 'submissions', false, 31457280,  -- 30 MB
  array['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Upload quota, checked by the storage insert policy (security definer so the
-- policy doesn't depend on storage.objects RLS). Counts every object the
-- caller uploaded in the last day, plus a global ceiling.
create or replace function public.can_upload_submission()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
     and (select count(*) from storage.objects o
          where o.bucket_id = 'submissions'
            and (storage.foldername(o.name))[1] = auth.uid()::text
            and o.created_at > now() - interval '1 day') < 30
     and (select count(*) from storage.objects o
          where o.bucket_id = 'submissions'
            and o.created_at > now() - interval '1 day') < 1500;
$$;

revoke all on function public.can_upload_submission() from public, anon;
grant execute on function public.can_upload_submission() to authenticated;

-- Players (anonymous sessions are `authenticated` too) may upload only into
-- their own folder, only image extensions, only within quota. They may see
-- and delete only their own objects (needed to withdraw). No public read.
drop policy if exists "Players upload own submissions" on storage.objects;
create policy "Players upload own submissions"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'submissions'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and array_length(storage.foldername(name), 1) = 1
    and lower(storage.extension(name)) in ('jpg', 'jpeg', 'png', 'heic', 'heif', 'webp')
    and (select public.can_upload_submission())
  );

drop policy if exists "Players read own submissions" on storage.objects;
create policy "Players read own submissions"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'submissions'
    and ((storage.foldername(name))[1] = (select auth.uid())::text or (select public.is_admin()))
  );

drop policy if exists "Players delete own submissions" on storage.objects;
create policy "Players delete own submissions"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'submissions'
    and ((storage.foldername(name))[1] = (select auth.uid())::text or (select public.is_admin()))
  );
-- No update policy: an uploaded original can't be swapped after submission.

-- ---------------------------------------------------------------------
-- photo_submissions
-- ---------------------------------------------------------------------
create table if not exists public.photo_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  storage_path text not null unique,
  original_filename text,
  lat double precision not null,
  lng double precision not null,
  location_source text not null check (location_source in ('exif', 'exif_adjusted', 'pin')),
  exif_lat double precision,
  exif_lng double precision,
  captured_at timestamptz,
  indoor boolean not null default false,
  building text,
  spot_description text,
  credit_name text,            -- null = credit the anonymous fallback
  contact text,                -- admin-only, for takedown requests; never shown
  consent_version text not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  review_notes text,           -- admin-only
  place_id bigint references public.places (id) on delete set null,
  original_deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists photo_submissions_user_created_idx
  on public.photo_submissions (user_id, created_at desc);
create index if not exists photo_submissions_status_idx
  on public.photo_submissions (status, created_at);

alter table public.photo_submissions enable row level security;
revoke all on public.photo_submissions from anon, authenticated;

-- Admins read and review with their own session; players go through RPCs.
drop policy if exists "Admins manage submissions" on public.photo_submissions;
create policy "Admins manage submissions"
  on public.photo_submissions for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
grant select, update on public.photo_submissions to authenticated;  -- RLS: admins only

-- ---------------------------------------------------------------------
-- submit_photo: record a submission for a file the caller already uploaded
-- ---------------------------------------------------------------------
create or replace function public.submit_photo(
  p_path text,
  p_lat double precision,
  p_lng double precision,
  p_location_source text,
  p_exif_lat double precision default null,
  p_exif_lng double precision default null,
  p_captured_at timestamptz default null,
  p_indoor boolean default false,
  p_building text default null,
  p_spot text default null,
  p_credit_name text default null,
  p_contact text default null,
  p_original_filename text default null,
  p_consent_version text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  new_id uuid;
begin
  if uid is null then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;
  if p_consent_version is distinct from public.contribute_consent_version() then
    raise exception 'consent_required' using errcode = 'P0001';
  end if;

  -- The file must be the caller's own, in their own folder, already uploaded.
  if p_path is null
     or p_path !~ ('^' || uid::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpe?g|png|heic|heif|webp)$') then
    raise exception 'bad_path' using errcode = 'P0001';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'submissions' and o.name = p_path) then
    raise exception 'file_missing' using errcode = 'P0001';
  end if;

  if p_location_source is null or p_location_source not in ('exif', 'exif_adjusted', 'pin') then
    raise exception 'bad_location' using errcode = 'P0001';
  end if;
  -- (Postgres sorts NaN above every number, so NaN fails the bounds check.)
  if not public.on_campus(p_lat, p_lng) then
    raise exception 'off_campus' using errcode = 'P0001';
  end if;

  -- Serialize one player's submissions so parallel calls can't skip limits.
  perform pg_advisory_xact_lock(hashtext('submit_photo:' || uid::text));
  if (select count(*) from public.photo_submissions
      where user_id = uid and created_at > now() - interval '1 day') >= 20 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  if (select count(*) from public.photo_submissions
      where created_at > now() - interval '1 day') >= 500 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.photo_submissions where storage_path = p_path) then
    raise exception 'already_submitted' using errcode = 'P0001';
  end if;

  insert into public.photo_submissions (
    user_id, storage_path, original_filename, lat, lng, location_source,
    exif_lat, exif_lng, captured_at, indoor, building, spot_description,
    credit_name, contact, consent_version
  )
  values (
    uid, p_path, public.clean_short_text(p_original_filename, 120),
    p_lat, p_lng, p_location_source,
    case when p_exif_lat between -90 and 90 and p_exif_lng between -180 and 180 then p_exif_lat end,
    case when p_exif_lat between -90 and 90 and p_exif_lng between -180 and 180 then p_exif_lng end,
    case when p_captured_at between timestamptz '2000-01-01' and now() + interval '1 day' then p_captured_at end,
    coalesce(p_indoor, false),
    public.clean_short_text(p_building, 80),
    public.clean_short_text(p_spot, 200),
    public.clean_short_text(p_credit_name, 40),
    public.clean_short_text(p_contact, 120),
    p_consent_version
  )
  returning id into new_id;

  return new_id;
end;
$$;

-- ---------------------------------------------------------------------
-- my_submissions: the caller's own submissions, status only (no admin notes,
-- no contact, no coordinates).
-- ---------------------------------------------------------------------
create or replace function public.my_submissions()
returns table (
  id uuid,
  created_at timestamptz,
  status text,
  in_game boolean,
  indoor boolean,
  building text,
  credit_name text,
  original_filename text
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.created_at, s.status,
         (s.status = 'approved' and coalesce(p.active, false)) as in_game,
         s.indoor, s.building, s.credit_name, s.original_filename
  from public.photo_submissions s
  left join public.places p on p.id = s.place_id
  where s.user_id = auth.uid()
  order by s.created_at desc
  limit 100;
$$;

-- ---------------------------------------------------------------------
-- withdraw_submission: owner withdraws a PENDING submission. Returns the
-- storage path so the client can delete its own original (storage objects
-- must be deleted through the Storage API, not SQL). The pipeline's cleanup
-- step deletes anything the client didn't.
-- ---------------------------------------------------------------------
create or replace function public.withdraw_submission(p_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  path text;
begin
  if auth.uid() is null then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;
  update public.photo_submissions
    set status = 'withdrawn', updated_at = now()
    where id = p_id and user_id = auth.uid() and status = 'pending'
    returning storage_path into path;
  if path is null then
    raise exception 'not_withdrawable' using errcode = 'P0001';
  end if;
  return path;
end;
$$;

revoke all on function public.submit_photo(text, double precision, double precision, text, double precision, double precision, timestamptz, boolean, text, text, text, text, text, text) from public, anon;
revoke all on function public.my_submissions() from public, anon;
revoke all on function public.withdraw_submission(uuid) from public, anon;
grant execute on function public.submit_photo(text, double precision, double precision, text, double precision, double precision, timestamptz, boolean, text, text, text, text, text, text) to authenticated;
grant execute on function public.my_submissions() to authenticated;
grant execute on function public.withdraw_submission(uuid) to authenticated;
