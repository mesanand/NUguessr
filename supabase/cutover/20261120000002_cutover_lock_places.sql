-- =====================================================================
-- Migration 2 (cutover). Apply only once real places are published
-- (>= 30 rows with coordinates) AND the new app is deploying, because the
-- old client reads `places` directly.
--
-- * removes the placeholder rows (no coordinates)
-- * makes the answer columns mandatory
-- * clients can no longer read `places` at all: the game gets photos only
--   through start_game/get_game, and answers only through submit_guess.
--   Admins still read/write via the "Admins manage places" policy.
-- =====================================================================

do $$
begin
  if (select count(*) from public.places where lat is not null and lng is not null) < 30 then
    raise exception 'cutover aborted: fewer than 30 places have coordinates';
  end if;
end $$;

-- Placeholder rows (and any game rounds that referenced them, via cascade).
delete from public.places where lat is null or lng is null;

alter table public.places
  alter column lat set not null,
  alter column lng set not null,
  alter column source set not null;

-- Lock down reads: no public select policy, no anon select grant.
drop policy if exists "Places are publicly readable" on public.places;
revoke select on public.places from anon;
-- authenticated keeps the table grant, but RLS only lets admins see rows.
grant select on public.places to authenticated;
