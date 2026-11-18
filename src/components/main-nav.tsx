"use client"

import Link from "next/link"

import { Icons } from "@/components/icons"
import { NavItem } from "./nav-item"
import { UserAccountNav } from "./user-account-nav"

export function MainNav() {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-card">
      <nav
        aria-label="Main"
        className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between gap-2 px-4"
      >
        <div className="flex min-w-0 items-center gap-1 sm:gap-2">
          <Link
            href="/"
            className="mr-1 inline-flex min-h-11 items-center gap-2 rounded-lg pr-2 text-lg font-bold tracking-tight text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="flex size-8 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
              <Icons.mapPin className="size-4" aria-hidden="true" />
            </span>
            NUGuessr
          </Link>
          <NavItem href="/leaderboards">
            <Icons.trophy className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">Leaderboards</span>
            <span className="sr-only sm:hidden">Leaderboards</span>
          </NavItem>
        </div>
        <UserAccountNav />
      </nav>
    </header>
  )
}
