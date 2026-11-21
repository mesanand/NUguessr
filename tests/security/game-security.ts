/**
 * Answer-leak and game-integrity checks using ONLY the public anon key —
 * i.e. exactly what any visitor can do. Run against local or production:
 *
 *   npx tsx --env-file-if-exists=.env.local tests/security/game-security.ts
 *   (override NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY to target another project)
 *
 * Pass --expect-locked after the cutover migration: then direct reads of
 * `places` must return no coordinates at all.
 * Pass --check-images N to download N published photos and assert no EXIF/GPS.
 */
import { createClient } from "@supabase/supabase-js"
import exifr from "exifr"

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const expectLocked = process.argv.includes("--expect-locked")
const imgIdx = process.argv.indexOf("--check-images")
const imageChecks = imgIdx > -1 ? Number(process.argv[imgIdx + 1] ?? 5) : 0

if (!url || !anon) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY")
  process.exit(2)
}

const supabase = createClient(url, anon, { auth: { persistSession: false } })
let failures = 0
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`)
  if (!ok) failures++
}

const FORBIDDEN_KEYS = ["lat", "lng", "name", "notes", "source_url", "sourceUrl", "actual", "credit", "author", "title"]
function findForbidden(value: unknown, path = "$"): string[] {
  if (value === null || typeof value !== "object") return []
  const hits: string[] = []
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEYS.includes(k) && v !== null) hits.push(`${path}.${k}`)
    hits.push(...findForbidden(v, `${path}.${k}`))
  }
  return hits
}

async function main() {
  console.log(`Target: ${url}`)

  // 1. Direct table reads
  const direct = await supabase.from("places").select("lat, lng, name").limit(5)
  const leakedRows = (direct.data ?? []).filter((r) => r.lat !== null || r.name !== null)
  if (expectLocked) {
    check("anon cannot read places coordinates/names", leakedRows.length === 0,
      direct.error ? `error: ${direct.error.message}` : `${direct.data?.length ?? 0} rows, ${leakedRows.length} with answers`)
  } else {
    console.log(`INFO  direct places read (pre-cutover): ${direct.error ? direct.error.message : `${leakedRows.length} rows with answers`}`)
  }
  for (const table of ["place_candidates", "games", "game_rounds"]) {
    const r = await supabase.from(table).select("*").limit(1)
    check(`anon cannot read ${table}`, !!r.error || (r.data ?? []).length === 0, r.error?.message ?? `${r.data?.length} rows`)
  }
  const ins = await supabase.from("places").insert({ image_url: "x.webp", lat: 1, lng: 1 })
  check("anon cannot insert places", !!ins.error, ins.error?.message)
  const usr = await supabase.from("users").update({ role: "admin" }).neq("id", "00000000-0000-0000-0000-000000000000").select()
  check("anon cannot update users.role", !!usr.error || (usr.data ?? []).length === 0, usr.error?.message ?? "0 rows")
  const rnd = await supabase.rpc("random_active_places", { n: 5 })
  check("anon cannot call random_active_places", !!rnd.error, rnd.error?.message)
  const adm = await supabase.rpc("is_admin")
  check("anon is not admin", adm.data === false, String(adm.data ?? adm.error?.message))

  // 2. start_game payload
  const start = await supabase.rpc("start_game")
  if (start.error) {
    check("start_game works", false, start.error.message)
    return
  }
  const game = start.data as { gameId: string; rounds: { imageUrl: string | null; result: unknown }[] }
  check("start_game returns 5 rounds", game.rounds.length === 5, `${game.rounds.length}`)
  const leaks = findForbidden(game)
  check("start_game payload has no answer fields", leaks.length === 0, leaks.join(", "))
  check("round 0 photo path is UUID-named", /^([\w-]+\/)?[0-9a-f-]{36}\.webp$/i.test(game.rounds[0].imageUrl ?? ""), String(game.rounds[0].imageUrl))
  check("future rounds' photos are hidden", game.rounds.slice(1).every((r) => r.imageUrl === null))
  const again = await supabase.rpc("get_game", { p_game_id: game.gameId })
  check("get_game before guessing has no answer fields", findForbidden(again.data).length === 0)

  // 3. Round integrity
  const outOfOrder = await supabase.rpc("submit_guess", { p_game_id: game.gameId, p_round_index: 1, p_guess_lat: 42.34, p_guess_lng: -71.09 })
  check("out-of-order round rejected", !!outOfOrder.error, outOfOrder.error?.message)
  const early = await supabase.rpc("finish_game", { p_game_id: game.gameId })
  check("finish before all rounds rejected", !!early.error, early.error?.message)
  const first = await supabase.rpc("submit_guess", { p_game_id: game.gameId, p_round_index: 0, p_guess_lat: 42.3398, p_guess_lng: -71.0892 })
  check("submit_guess round 0 works", !first.error && typeof first.data?.points === "number", first.error?.message ?? `${first.data?.points} pts, ${first.data?.distanceYards} yd`)
  check("result reveals name + credit", !!first.data?.actual && "name" in (first.data ?? {}) && !!first.data?.credit)
  const dup = await supabase.rpc("submit_guess", { p_game_id: game.gameId, p_round_index: 0, p_guess_lat: 42.3398, p_guess_lng: -71.0892 })
  check("same round cannot be submitted twice", !!dup.error, dup.error?.message)
  const early1 = await supabase.rpc("submit_guess", { p_game_id: game.gameId, p_round_index: 1, p_guess_lat: 42.34, p_guess_lng: -71.09 })
  check("next round cannot be guessed before it is revealed", early1.error?.message?.includes("round_not_started") ?? false, early1.error?.message)
  const rev1 = await supabase.rpc("get_game", { p_game_id: game.gameId })
  check("get_game reveals only the next round", rev1.data?.rounds?.[1]?.imageUrl && rev1.data?.rounds?.[2]?.imageUrl === null && rev1.data?.currentRound?.roundIndex === 1, JSON.stringify(rev1.data?.currentRound))
  check("revealed round still has no answer fields", findForbidden(rev1.data?.rounds?.[1]).length === 0)
  const timeout = await supabase.rpc("submit_guess", { p_game_id: game.gameId, p_round_index: 1 })
  check("timeout scores 0", !timeout.error && timeout.data?.points === 0, timeout.error?.message)
  await supabase.rpc("get_game", { p_game_id: game.gameId })
  const bad = await supabase.rpc("submit_guess", { p_game_id: game.gameId, p_round_index: 2, p_guess_lat: 999, p_guess_lng: 0 })
  check("invalid coordinates rejected", !!bad.error, bad.error?.message)
  for (let i = 2; i < 5; i++) {
    await supabase.rpc("get_game", { p_game_id: game.gameId })
    await supabase.rpc("submit_guess", { p_game_id: game.gameId, p_round_index: i, p_guess_lat: 42.339, p_guess_lng: -71.089 })
  }
  const fin = await supabase.rpc("finish_game", { p_game_id: game.gameId })
  const fin2 = await supabase.rpc("finish_game", { p_game_id: game.gameId })
  check("finish_game works and is idempotent", !fin.error && fin.data?.totalScore === fin2.data?.totalScore,
    fin.error?.message ?? `total ${fin.data?.totalScore}`)
  const late = await supabase.rpc("submit_guess", { p_game_id: game.gameId, p_round_index: 4, p_guess_lat: 42.34, p_guess_lng: -71.09 })
  check("no submissions after finish", !!late.error, late.error?.message)

  // 4. Credits and storage listing
  const credits = await supabase.rpc("photo_credits")
  check("photo_credits has no per-file links, names or coordinates", !credits.error && (credits.data ?? []).every((c: Record<string, unknown>) => !("source_url" in c) && !("name" in c) && !("lat" in c)), credits.error?.message ?? `${credits.data?.length} credits`)
  const list = await supabase.storage.from("images").list("", { limit: 5 })
  check("anon cannot list the photo bucket", !!list.error || (list.data ?? []).length === 0, list.error?.message ?? `${list.data?.length} objects listed`)

  // 5. Published images carry no metadata
  if (imageChecks > 0) {
    const games = await Promise.all(Array.from({ length: imageChecks * 2 }, () => supabase.rpc("start_game")))
    const urls = [...new Set(games.map((g) => g.data?.rounds?.[0]?.imageUrl as string).filter(Boolean))].slice(0, imageChecks)
    for (const path of urls) {
      const full = /^https?:/.test(path) ? path : `${url}/storage/v1/object/public/images/${path}`
      const res = await fetch(full)
      const buf = Buffer.from(await res.arrayBuffer())
      let meta: unknown = null
      try { meta = await exifr.parse(buf, { gps: true, xmp: true, iptc: true, tiff: true }) } catch { meta = null }
      const gps = await exifr.gps(buf).catch(() => null)
      check(`image has no EXIF/GPS: ${path}`, res.ok && !gps && !meta, res.ok ? JSON.stringify(meta)?.slice(0, 120) : `HTTP ${res.status}`)
    }
  }
}

main()
  .catch((e) => { console.error(e); failures++ })
  .finally(() => {
    console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll checks passed")
    process.exit(failures ? 1 : 0)
  })
