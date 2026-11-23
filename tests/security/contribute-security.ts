/**
 * Community photo submissions: privacy and abuse checks using ONLY the public
 * anon key and two throwaway anonymous players (exactly what any visitor can
 * do). Run after migration 20261123000001 is applied:
 *
 *   npx tsx --env-file-if-exists=.env.local tests/security/contribute-security.ts
 *
 * Needs "Allow anonymous sign-ins" on (the game already requires it).
 * Leaves behind one WITHDRAWN submission row per run (its file is deleted);
 * places:submissions:sync marks it cleaned up.
 */
import { randomUUID } from "node:crypto"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import sharp from "sharp"

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
if (!url || !anon) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY")
  process.exit(2)
}

const BUCKET = "submissions"
const CONSENT = "2026-11-v1" // public.contribute_consent_version()
const ON_CAMPUS = { lat: 42.33985, lng: -71.08905 }

let failures = 0
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`)
  if (!ok) failures++
}

async function player(): Promise<{ db: SupabaseClient; uid: string }> {
  const db = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await db.auth.signInAnonymously()
  if (error || !data.user) throw new Error(`anonymous sign-in failed: ${error?.message}`)
  return { db, uid: data.user.id }
}

function submitArgs(path: string, over: Record<string, unknown> = {}) {
  return {
    p_path: path,
    p_lat: ON_CAMPUS.lat,
    p_lng: ON_CAMPUS.lng,
    p_location_source: "pin",
    p_indoor: true,
    p_building: "Security test",
    p_spot: "automated check",
    p_credit_name: null,
    p_contact: "security-test@example.invalid",
    p_original_filename: "security-test.jpg",
    p_consent_version: CONSENT,
    ...over,
  }
}

async function main() {
  console.log(`Target: ${url}`)
  const jpeg = await sharp({ create: { width: 16, height: 16, channels: 3, background: "#777" } }).jpeg().toBuffer()
  const nobody = createClient(url, anon, { auth: { persistSession: false } })
  const A = await player()
  const B = await player()
  const aPath = `${A.uid}/${randomUUID()}.jpg`

  // --- storage
  const noSession = await nobody.storage.from(BUCKET).upload(`${A.uid}/${randomUUID()}.jpg`, jpeg, { contentType: "image/jpeg" })
  check("no session cannot upload", !!noSession.error, noSession.error?.message)

  const up = await A.db.storage.from(BUCKET).upload(aPath, jpeg, { contentType: "image/jpeg" })
  check("player uploads into own folder", !up.error, up.error?.message)

  const foreign = await A.db.storage.from(BUCKET).upload(`${B.uid}/${randomUUID()}.jpg`, jpeg, { contentType: "image/jpeg" })
  check("player cannot upload into another player's folder", !!foreign.error, foreign.error?.message)

  const svg = await A.db.storage
    .from(BUCKET)
    .upload(`${A.uid}/${randomUUID()}.svg`, Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"), { contentType: "image/svg+xml" })
  check("non-photo files are refused", !!svg.error, svg.error?.message)

  const nested = await A.db.storage.from(BUCKET).upload(`${A.uid}/x/${randomUUID()}.jpg`, jpeg, { contentType: "image/jpeg" })
  check("nested folders are refused", !!nested.error, nested.error?.message)

  const bDownload = await B.db.storage.from(BUCKET).download(aPath)
  check("another player cannot download the original", !!bDownload.error || !bDownload.data)

  const bList = await B.db.storage.from(BUCKET).list(A.uid)
  check("another player cannot list the folder", (bList.data ?? []).length === 0)

  const publicUrl = A.db.storage.from(BUCKET).getPublicUrl(aPath).data.publicUrl
  const pub = await fetch(publicUrl)
  check("bucket is not public", !pub.ok, `HTTP ${pub.status}`)

  const anonDownload = await nobody.storage.from(BUCKET).download(aPath)
  check("no session cannot download", !!anonDownload.error || !anonDownload.data)

  // --- submit_photo validation
  const cases: [string, Record<string, unknown>, RegExp][] = [
    ["off-campus pin refused", { p_lat: 42.3601, p_lng: -71.0589 }, /off_campus/],
    ["missing consent refused", { p_consent_version: null }, /consent_required/],
    ["old consent version refused", { p_consent_version: "2020-01-v0" }, /consent_required/],
    ["bad location source refused", { p_location_source: "gps" }, /bad_location/],
  ]
  for (const [name, over, re] of cases) {
    const r = await A.db.rpc("submit_photo", submitArgs(aPath, over))
    check(name, !!r.error && re.test(r.error.message), r.error?.message ?? "no error")
  }
  const stolen = await B.db.rpc("submit_photo", submitArgs(aPath))
  check("cannot submit someone else's file", !!stolen.error && /bad_path/.test(stolen.error.message), stolen.error?.message)
  const ghost = await A.db.rpc("submit_photo", submitArgs(`${A.uid}/${randomUUID()}.jpg`))
  check("cannot submit a file that was never uploaded", !!ghost.error && /file_missing/.test(ghost.error.message), ghost.error?.message)
  const noSessionRpc = await nobody.rpc("submit_photo", submitArgs(aPath))
  check("no session cannot submit", !!noSessionRpc.error, noSessionRpc.error?.message)

  const ok = await A.db.rpc("submit_photo", submitArgs(aPath))
  check("valid submission accepted", !ok.error && typeof ok.data === "string", ok.error?.message)
  const dup = await A.db.rpc("submit_photo", submitArgs(aPath))
  check("same file cannot be submitted twice", !!dup.error && /already_submitted/.test(dup.error.message), dup.error?.message)

  // --- reading submissions
  const bRows = await B.db.from("photo_submissions").select("*")
  check("players cannot read the submissions table", !!bRows.error || (bRows.data ?? []).length === 0)
  const aRows = await A.db.from("photo_submissions").select("contact, lat, lng")
  check("not even their own row directly (contact/coords stay private)", !!aRows.error || (aRows.data ?? []).length === 0)
  const anonRows = await nobody.from("photo_submissions").select("*")
  check("no session cannot read the submissions table", !!anonRows.error || (anonRows.data ?? []).length === 0)

  const mineA = await A.db.rpc("my_submissions")
  const rowA = (mineA.data ?? [])[0] as Record<string, unknown> | undefined
  check("my_submissions returns the player's own submission", (mineA.data ?? []).length === 1 && rowA?.status === "pending", mineA.error?.message)
  check("my_submissions hides contact and coordinates", !!rowA && !("contact" in rowA) && !("lat" in rowA) && !("review_notes" in rowA))
  const mineB = await B.db.rpc("my_submissions")
  check("my_submissions never shows other players' submissions", (mineB.data ?? []).length === 0, mineB.error?.message)

  // --- withdraw (also cleans up)
  const bWithdraw = await B.db.rpc("withdraw_submission", { p_id: ok.data })
  check("another player cannot withdraw it", !!bWithdraw.error, bWithdraw.error?.message)
  const w = await A.db.rpc("withdraw_submission", { p_id: ok.data })
  check("owner can withdraw a pending submission", !w.error && w.data === aPath, w.error?.message)
  const rm = await A.db.storage.from(BUCKET).remove([aPath])
  check("owner can delete their original", !rm.error && (rm.data ?? []).length === 1, rm.error?.message)
  const again = await A.db.rpc("withdraw_submission", { p_id: ok.data })
  check("cannot withdraw twice", !!again.error, again.error?.message)

  // Tidy any stray test uploads (A's foreign/svg/nested should not exist).
  await A.db.storage.from(BUCKET).remove([aPath])

  console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll contribute security checks passed")
  process.exit(failures ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
