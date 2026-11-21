import "server-only"

import type { SupabaseClient, User } from "@supabase/supabase-js"

import { createClient } from "@/lib/supabase/server"

/**
 * Admin gate for server components, server actions and route handlers.
 *
 * - `auth.getUser()` revalidates the session with Supabase Auth (unlike
 *   `getSession()`, which trusts the cookie as-is).
 * - `rpc('is_admin')` asks Postgres, which checks `app_metadata.role` OR
 *   `users.role` (see migration 20261120000001). No JWT secret needed.
 *
 * Middleware also guards /admin, but server actions are plain POST endpoints
 * reachable from any page, so every admin action must call this itself.
 */

export type AdminFailureReason = "unauthenticated" | "forbidden"

export class AdminAuthError extends Error {
  readonly reason: AdminFailureReason
  constructor(reason: AdminFailureReason) {
    super(reason === "unauthenticated" ? "Sign in required" : "Admins only")
    this.name = "AdminAuthError"
    this.reason = reason
  }
}

export type AdminContext = {
  supabase: SupabaseClient
  user: User
}

export type AdminCheck =
  | ({ ok: true } & AdminContext)
  | { ok: false; reason: AdminFailureReason }

/** Non-throwing variant: tells you whether the current request is an admin. */
export async function checkAdmin(): Promise<AdminCheck> {
  const supabase = await createClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()
  if (userError || !user) return { ok: false, reason: "unauthenticated" }

  const { data, error } = await supabase.rpc("is_admin")
  if (error || data !== true) return { ok: false, reason: "forbidden" }

  return { ok: true, supabase, user }
}

/** Throws AdminAuthError unless the signed-in user is an admin. */
export async function requireAdmin(): Promise<AdminContext> {
  const result = await checkAdmin()
  if (!result.ok) throw new AdminAuthError(result.reason)
  return { supabase: result.supabase, user: result.user }
}

export async function isAdmin(): Promise<boolean> {
  return (await checkAdmin()).ok
}
