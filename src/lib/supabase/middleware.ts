import { NextResponse, type NextRequest } from "next/server"
import { createServerClient } from "@supabase/ssr"

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  // Middleware gets its own client bound to the request/response cookies.
  // (The cookie helpers in ./server.ts use next/headers and must not be
  // called from middleware.)
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // getUser() revalidates the session with Supabase Auth (and refreshes it).
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  // Redirect non-admin users trying to access admin pages to the home page.
  // The admin pages and every admin server action re-check with requireAdmin().
  if (user && pathname.startsWith("/admin")) {
    const { data: isAdmin, error } = await supabase.rpc("is_admin")
    if (error || isAdmin !== true) {
      const url = request.nextUrl.clone()
      url.pathname = "/"
      url.search = ""
      return withCookies(NextResponse.redirect(url), supabaseResponse)
    }
  }

  // Redirect unauthenticated users to sign-in page
  if (
    !user &&
    !pathname.startsWith("/signin") &&
    !pathname.startsWith("/auth")
  ) {
    const url = request.nextUrl.clone()
    url.pathname = "/signin"
    url.search = ""
    url.searchParams.set("next", pathname)
    return withCookies(NextResponse.redirect(url), supabaseResponse)
  }

  // Redirect authenticated users attempting to access the sign-in page to the home page
  if (user && pathname.startsWith("/signin")) {
    const url = request.nextUrl.clone()
    url.pathname = "/"
    url.search = ""
    return withCookies(NextResponse.redirect(url), supabaseResponse)
  }

  return supabaseResponse
}

/** Carry refreshed auth cookies over to a redirect response. */
function withCookies(response: NextResponse, from: NextResponse) {
  from.cookies.getAll().forEach((cookie) => response.cookies.set(cookie))
  return response
}
