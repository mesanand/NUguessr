// Offline check of the community-submission migration (no Docker, no network).
//
//   npm run test:sql
//
// Replays every migration on PGlite (Postgres compiled to WASM) with minimal
// stand-ins for Supabase's auth + storage schemas (auth.uid/jwt,
// storage.objects/foldername/extension, anon/authenticated roles), then
// exercises the storage policies, submit_photo, my_submissions,
// withdraw_submission, the rate limits and the new 'community' source.
// The stand-ins mimic Supabase closely but not exactly: also run
// tests/security/contribute-security.ts against a real project.
import { PGlite } from "@electric-sql/pglite"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const dir = process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "supabase", "migrations")
const db = new PGlite()

const stubs = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth; create schema storage;
create table auth.users (id uuid primary key, email text, raw_app_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text, owner uuid, created_at timestamptz default now(), unique(bucket_id, name));
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'),1)-1] $$;
create function storage.extension(name text) returns text language sql immutable as $$ select reverse(split_part(reverse(name), '.', 1)) $$;
grant usage on schema auth, storage, public to anon, authenticated;
grant select, insert, delete on storage.objects to anon, authenticated;
grant execute on all functions in schema auth to anon, authenticated;
`
await db.exec(stubs)
for (const f of [
  "20261118183259_initial_schema.sql",
  "20261120000001_real_places_and_server_games.sql",
]) {
  await db.exec(readFileSync(`${dir}/${f}`, "utf8"))
  console.log("applied", f)
}
// Seed 30 real places so the cutover runs, then apply it and the new one.
await db.exec(`insert into public.places (image_url, lat, lng, name, source, source_id, active)
  select 'x'||g||'.webp', 42.34, -71.09, 'P'||g, 'own', 's'||g, true from generate_series(1,30) g;`)
for (const f of ["20261120000002_cutover_lock_places.sql", "20261123000001_community_photo_submissions.sql"]) {
  await db.exec(readFileSync(`${dir}/${f}`, "utf8"))
  console.log("applied", f)
}
// Apply the new migration a second time: it must be re-runnable.
await db.exec(readFileSync(`${dir}/20261123000001_community_photo_submissions.sql`, "utf8"))
console.log("re-applied new migration OK")

const A = "11111111-1111-1111-1111-111111111111"
const B = "22222222-2222-2222-2222-222222222222"
await db.exec(`insert into auth.users (id) values ('${A}'), ('${B}');`)

let pass = 0, fail = 0
async function as(uid, sql, params = []) {
  await db.exec("reset role")
  await db.query(`select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claims', $2, false)`, [uid ?? "", uid ? JSON.stringify({ sub: uid, role: "authenticated" }) : ""])
  await db.exec(uid ? "set role authenticated" : "set role anon")
  try { return await db.query(sql, params) } finally { await db.exec("reset role") }
}
async function expectOk(label, fn) { try { const r = await fn(); pass++; console.log("  ok  ", label); return r } catch (e) { fail++; console.log("  FAIL", label, "->", e.message) } }
async function expectErr(label, re, fn) { try { await fn(); fail++; console.log("  FAIL", label, "-> no error") } catch (e) { if (re.test(e.message)) { pass++; console.log("  ok  ", label, `(${e.message})`) } else { fail++; console.log("  FAIL", label, "->", e.message) } } }

const u1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const pathA = `${A}/${u1}.jpg`
const V = "2026-11-v1"
const submit = (uid, path, lat = 42.339, lng = -71.089, consent = V, src = "exif") =>
  as(uid, `select public.submit_photo($1, $2, $3, $4, 42.3391, -71.0891, now() - interval '1 day', true, 'Richards Hall', 'room 310', 'Shourya', 'me@x.com', 'IMG_1.HEIC', $5) as id`, [path, lat, lng, src, consent])

console.log("storage policies")
await expectOk("A uploads into own folder", () => as(A, `insert into storage.objects (bucket_id, name) values ('submissions', $1)`, [pathA]))
await expectErr("A cannot upload into B's folder", /row-level security/, () => as(A, `insert into storage.objects (bucket_id, name) values ('submissions', $1)`, [`${B}/${u1}.jpg`]))
await expectErr("A cannot upload a non-image extension", /row-level security/, () => as(A, `insert into storage.objects (bucket_id, name) values ('submissions', $1)`, [`${A}/x.svg`]))
await expectErr("A cannot upload in a nested folder", /row-level security/, () => as(A, `insert into storage.objects (bucket_id, name) values ('submissions', $1)`, [`${A}/deep/x.jpg`]))
await expectErr("anon (no session) cannot upload", /row-level security|permission/, () => as(null, `insert into storage.objects (bucket_id, name) values ('submissions', $1)`, [`x/${u1}.jpg`]))
const bSees = await as(B, `select count(*)::int n from storage.objects where bucket_id = 'submissions'`)
bSees.rows[0].n === 0 ? (pass++, console.log("  ok   B can't see A's files")) : (fail++, console.log("  FAIL B sees A's files"))
const aSees = await as(A, `select count(*)::int n from storage.objects where bucket_id = 'submissions'`)
aSees.rows[0].n === 1 ? (pass++, console.log("  ok   A sees own file")) : (fail++, console.log("  FAIL A can't see own file"))
const bDel = await as(B, `delete from storage.objects where name = $1 returning 1`, [pathA])
bDel.rows.length === 0 ? (pass++, console.log("  ok   B can't delete A's file")) : (fail++, console.log("  FAIL B deleted A's file"))

console.log("submit_photo")
await expectErr("no session", /not_signed_in|permission denied/, () => submit(null, pathA))
await expectErr("wrong consent", /consent_required/, () => submit(A, pathA, 42.339, -71.089, "old"))
await expectErr("B submits A's file", /bad_path/, () => submit(B, pathA))
await expectErr("missing file", /file_missing/, () => submit(A, `${A}/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jpg`))
await expectErr("off campus", /off_campus/, () => submit(A, pathA, 42.36, -71.06))
await expectErr("NaN coords", /off_campus/, () => submit(A, pathA, NaN, -71.09))
await expectErr("bad location source", /bad_location/, () => submit(A, pathA, 42.339, -71.089, V, "gps"))
const ok = await expectOk("valid submission", () => submit(A, pathA))
await expectErr("duplicate", /already_submitted/, () => submit(A, pathA))

console.log("table access")
const sel = await as(A, `select * from public.photo_submissions`)
sel.rows.length === 0 ? (pass++, console.log("  ok   player selecting photo_submissions gets no rows (RLS: admins only)")) : (fail++, console.log("  FAIL player sees rows"))
await expectErr("player cannot insert photo_submissions", /permission denied/, () => as(A, `insert into public.photo_submissions (user_id, storage_path, lat, lng, location_source, consent_version) values ('${A}', 'x', 1, 1, 'pin', 'v')`))
await expectErr("anon cannot call my_submissions", /permission denied/, () => as(null, `select * from public.my_submissions()`))
const mine = await as(A, `select * from public.my_submissions()`)
mine.rows.length === 1 && !("contact" in mine.rows[0]) && !("lat" in mine.rows[0]) ? (pass++, console.log("  ok   my_submissions returns own row without contact/coords")) : (fail++, console.log("  FAIL my_submissions", mine.rows))
const theirs = await as(B, `select * from public.my_submissions()`)
theirs.rows.length === 0 ? (pass++, console.log("  ok   B sees none of A's submissions")) : (fail++, console.log("  FAIL B sees A's submissions"))
const stored = await db.query(`select credit_name, building, contact, exif_lat from public.photo_submissions`)
console.log("  stored row:", stored.rows[0])

console.log("withdraw")
const sid = ok?.rows?.[0]?.id
await expectErr("B cannot withdraw A's", /not_withdrawable/, () => as(B, `select public.withdraw_submission($1)`, [sid]))
const w = await expectOk("A withdraws own pending", () => as(A, `select public.withdraw_submission($1) p`, [sid]))
w?.rows?.[0]?.p === pathA ? (pass++, console.log("  ok   returns storage path")) : (fail++, console.log("  FAIL path", w?.rows))
await expectErr("cannot withdraw twice", /not_withdrawable/, () => as(A, `select public.withdraw_submission($1)`, [sid]))
await expectOk("A deletes own original", () => as(A, `delete from storage.objects where name = $1`, [pathA]))

console.log("rate limits")
let blocked = false
for (let i = 0; i < 25; i++) {
  const id = `cccccccc-cccc-4ccc-8ccc-${String(i).padStart(12, "0")}`
  try {
    await as(B, `insert into storage.objects (bucket_id, name) values ('submissions', $1)`, [`${B}/${id}.jpg`])
    await submit(B, `${B}/${id}.jpg`)
  } catch (e) { if (/rate_limited/.test(e.message)) { blocked = i; break } else { console.log("   (", i, e.message, ")"); blocked = i; break } }
}
blocked === 20 ? (pass++, console.log("  ok   21st submission in a day is rate limited")) : (fail++, console.log("  FAIL rate limit at", blocked))
let upBlocked = false
for (let i = 25; i < 40; i++) {
  try { await as(B, `insert into storage.objects (bucket_id, name) values ('submissions', $1)`, [`${B}/dddddddd-dddd-4ddd-8ddd-${String(i).padStart(12, "0")}.jpg`]) } catch { upBlocked = i; break }
}
upBlocked === 34 ? (pass++, console.log("  ok   31st upload in a day is blocked (21 earlier + 9)")) : (fail++, console.log("  FAIL upload quota at", upBlocked))

console.log("source constraint")
await expectOk("places accepts community", () => db.query(`insert into public.places (image_url, lat, lng, source, source_id) values ('c.webp', 42.34, -71.09, 'community', 'sub-1')`))
await expectErr("places rejects unknown source", /check constraint/, () => db.query(`insert into public.places (image_url, lat, lng, source, source_id) values ('d.webp', 42.34, -71.09, 'instagram', 'z')`))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
