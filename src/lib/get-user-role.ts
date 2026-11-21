import "server-only"

import { createClient } from "@/lib/supabase/server"

export type UserRole = "admin" | "player"

/**
 * Role of the signed-in user: "admin" when the database's `is_admin()` says so,
 * "player" for any other signed-in user, undefined when signed out.
 *
 * Uses `auth.getUser()` (revalidated with Supabase Auth) rather than trusting
 * the session cookie, and asks Postgres instead of verifying the JWT locally,
 * so no SUPABASE_JWT_SECRET is needed.
 */
export async function getUserRole(): Promise<UserRole | undefined> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return undefined

  const { data, error } = await supabase.rpc("is_admin")
  if (error) {
    console.error("is_admin check failed:", error.message)
    return "player"
  }
  return data === true ? "admin" : "player"
}
