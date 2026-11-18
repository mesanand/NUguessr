"use client"

import "@fontsource/titillium-web"
import { SignInButton } from "@/components/signin-button"

// This whole page was commented out in the original repo — meaning the
// file had no default export at all. Anything that routed here (including
// middleware.ts, which redirects unauthenticated visitors to /signin on
// protected pages) would hit a broken page, and it also failed `tsc`/the
// Next.js build outright once type-checked. Re-enabled it here, reusing the
// same SignInButton component used elsewhere instead of duplicating the
// Google OAuth call a second time.
export default function SignInPage() {
  return (
    <div className="flex flex-col items-center justify-center h-screen space-y-4">
      <p
        className="text-5xl font-[1000] text-black text-center px-4"
        style={{ textShadow: "0 2px 4px rgba(0,0,0,0.5)" }}
      >
        Sign in to track your scores
      </p>
      <SignInButton />
    </div>
  )
}
