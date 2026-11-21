/**
 * Signed-in player checks (LOCAL stack only — creates a throwaway user with
 * the local service key, then deletes it):
 *   - a signed-in game updates users stats only via finish_game
 *   - the player can change their username but not role/high_score
 *   - another player can't read or submit to someone else's game
 *
 *   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=<local> ANON_KEY=<local> npx tsx tests/security/signed-in.ts
 */
import { createClient } from "@supabase/supabase-js"

const url = process.env.SUPABASE_URL!
const service = process.env.SUPABASE_SERVICE_ROLE_KEY!
const anonKey = process.env.ANON_KEY!
if (!url?.includes("127.0.0.1") && !url?.includes("localhost")) {
  console.error("Refusing to run against a non-local Supabase")
  process.exit(2)
}

let failures = 0
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`)
  if (!ok) failures++
}

async function main() {
  const admin = createClient(url, service, { auth: { persistSession: false } })
  const mk = async (email: string) => {
    const { data, error } = await admin.auth.admin.createUser({ email, password: "test-password-123", email_confirm: true })
    if (error) throw error
    const c = createClient(url, anonKey, { auth: { persistSession: false } })
    const s = await c.auth.signInWithPassword({ email, password: "test-password-123" })
    if (s.error) throw s.error
    return { client: c, id: data.user.id }
  }
  const a = await mk(`player-a-${Date.now()}@example.test`)
  const b = await mk(`player-b-${Date.now()}@example.test`)
  try {
    const row = await a.client.from("users").select("*").eq("id", a.id).single()
    check("signup trigger created users row", !!row.data, row.error?.message)

    const role = await a.client.from("users").update({ role: "admin" }).eq("id", a.id).select()
    check("player cannot set own role", !!role.error, role.error?.message)
    const hs = await a.client.from("users").update({ high_score: 99999 }).eq("id", a.id).select()
    check("player cannot set own high_score", !!hs.error, hs.error?.message)
    const un = await a.client.from("users").update({ username: "husky" }).eq("id", a.id).select()
    check("player can set own username", !un.error && un.data?.[0]?.username === "husky", un.error?.message)
    const adm = await a.client.rpc("is_admin")
    check("player is not admin", adm.data === false)

    const g = await a.client.rpc("start_game")
    const gameId = g.data.gameId as string
    const peek = await b.client.rpc("get_game", { p_game_id: gameId })
    check("other player cannot load my game", !!peek.error, peek.error?.message)
    const steal = await b.client.rpc("submit_guess", { p_game_id: gameId, p_round_index: 0, p_guess_lat: 42.34, p_guess_lng: -71.09 })
    check("other player cannot submit to my game", !!steal.error, steal.error?.message)
    const anonC = createClient(url, anonKey, { auth: { persistSession: false } })
    const anonPeek = await anonC.rpc("get_game", { p_game_id: gameId })
    check("anon cannot load a signed-in game", !!anonPeek.error, anonPeek.error?.message)

    // Round 0 on time; round 1 after the server deadline (clock moved back via service role).
    const r0 = await a.client.rpc("submit_guess", { p_game_id: gameId, p_round_index: 0, p_guess_lat: 42.339, p_guess_lng: -71.089 })
    await a.client.rpc("get_game", { p_game_id: gameId })
    await admin.from("games").update({ round_started_at: new Date(Date.now() - 120_000).toISOString() }).eq("id", gameId)
    const r1 = await a.client.rpc("submit_guess", { p_game_id: gameId, p_round_index: 1, p_guess_lat: 42.339, p_guess_lng: -71.089 })
    check("on-time guess scores", (r0.data?.points ?? 0) > 0 && r0.data?.late === false, JSON.stringify({ pts: r0.data?.points, late: r0.data?.late }))
    check("guess after the server deadline scores 0 (late)", r1.data?.points === 0 && r1.data?.late === true, r1.error?.message ?? JSON.stringify({ pts: r1.data?.points, late: r1.data?.late }))
    for (let i = 2; i < 5; i++) {
      await a.client.rpc("get_game", { p_game_id: gameId })
      await a.client.rpc("submit_guess", { p_game_id: gameId, p_round_index: i, p_guess_lat: 42.339, p_guess_lng: -71.089 })
    }
    const fin = await a.client.rpc("finish_game", { p_game_id: gameId })
    await a.client.rpc("finish_game", { p_game_id: gameId })
    const after = await a.client.from("users").select("total_games, high_score, avg_score").eq("id", a.id).single()
    check("finish_game updated stats once", after.data?.total_games === 1 && after.data?.high_score === fin.data?.totalScore,
      JSON.stringify(after.data))

    // Abandoning: starting a new game closes and counts the unfinished one.
    const g2 = await a.client.rpc("start_game")
    await a.client.rpc("submit_guess", { p_game_id: g2.data.gameId, p_round_index: 0, p_guess_lat: 42.339, p_guess_lng: -71.089 })
    await a.client.rpc("start_game")
    const after2 = await a.client.from("users").select("total_games").eq("id", a.id).single()
    const abandoned = await admin.from("games").select("finished_at, abandoned").eq("id", g2.data.gameId).single()
    check("abandoned game is closed and counted", after2.data?.total_games === 2 && abandoned.data?.abandoned === true && !!abandoned.data?.finished_at, JSON.stringify({ games: after2.data?.total_games, ...abandoned.data }))
    const late2 = await a.client.rpc("submit_guess", { p_game_id: g2.data.gameId, p_round_index: 1, p_guess_lat: 42.34, p_guess_lng: -71.09 })
    check("no submissions to an abandoned game", !!late2.error, late2.error?.message)

    // Promote via service role (what the admin SQL does) and re-check is_admin.
    await admin.from("users").update({ role: "admin" }).eq("id", b.id)
    const adm2 = await b.client.rpc("is_admin")
    check("users.role = admin makes is_admin() true", adm2.data === true)
  } finally {
    await admin.auth.admin.deleteUser(a.id)
    await admin.auth.admin.deleteUser(b.id)
  }
}

main()
  .catch((e) => { console.error(e); failures++ })
  .finally(() => {
    console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll checks passed")
    process.exit(failures ? 1 : 0)
  })
