"use client"

// Players don't sign in. The first time someone plays, the browser gets an
// anonymous Supabase account (auth.signInAnonymously), so their games are
// server-recorded against a user id exactly like a signed-in player's, and
// finish_game() keeps their stats. They pick any name for the leaderboard.
// Google sign-in still exists only on /signin, for admins.
//
// Requires "Allow anonymous sign-ins" in the Supabase dashboard
// (Authentication -> Sign In / Providers). If it's off or rate-limited, the
// game still starts as a guest game; it just can't go on the leaderboard.

import { createClient } from "@/lib/supabase/client"

export const NAME_MAX = 32

/** Make sure this browser has a player session. Returns false if it couldn't get one. */
export async function ensurePlayer(): Promise<boolean> {
  const supabase = createClient()
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (session) return true
    const { error } = await supabase.auth.signInAnonymously()
    if (error) {
      console.warn("anonymous sign-in failed; playing as a guest:", error.message)
      return false
    }
    return true
  } catch {
    return false
  }
}

/** Trim and validate a leaderboard name. Returns an error message, or null if it's fine. */
export function nameProblem(raw: string): string | null {
  const name = raw.trim()
  if (name.length === 0) return "Enter a name"
  if (name.length > NAME_MAX) return `Keep it to ${NAME_MAX} characters`
  return null
}

/** The current player's leaderboard name, or null if they haven't set one. */
export async function loadMyName(userId: string): Promise<string | null> {
  const supabase = createClient()
  const { data } = await supabase.from("users").select("username").eq("id", userId).maybeSingle()
  return (data?.username as string | null | undefined)?.trim() || null
}

/** Save the current player's leaderboard name. Resolves to an error message, or null on success. */
export async function saveMyName(userId: string, raw: string): Promise<string | null> {
  const problem = nameProblem(raw)
  if (problem) return problem
  const name = raw.trim()
  const supabase = createClient()
  const { error } = await supabase.from("users").update({ username: name }).eq("id", userId)
  if (error) {
    console.error("saving leaderboard name failed:", error.message)
    return "Couldn't save your name. Try again."
  }
  // Keep the auth profile in step (used for the nav initial); not critical.
  await supabase.auth.updateUser({ data: { name } }).catch(() => undefined)
  return null
}
