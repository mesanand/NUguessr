"use client"

import { SignInButton } from "@/components/signin-button"
import { MainNav } from "@/components/main-nav"
import { Icons } from "@/components/icons"

// This whole page was commented out in the original repo — meaning the
// file had no default export at all. Anything that routed here (including
// middleware.ts, which redirects unauthenticated visitors to /signin on
// protected pages) would hit a broken page, and it also failed `tsc`/the
// Next.js build outright once type-checked. Re-enabled it here, reusing the
// same SignInButton component used elsewhere instead of duplicating the
// Google OAuth call a second time.
export default function SignInPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <MainNav />
      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm rounded-lg border border-border bg-card p-8 text-center shadow-sm">
          <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
            <Icons.mapPin className="size-6" aria-hidden="true" />
          </span>
          <h1 className="mt-6 text-3xl uppercase">
            Admin sign-in
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            For curating photos. Players don&apos;t need an account: just play
            and add your name to the leaderboard.
          </p>
          <div className="mt-8 flex justify-center">
            <SignInButton />
          </div>
        </div>
      </main>
    </div>
  )
}
