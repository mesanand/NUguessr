"use client"

import Link from "next/link"

import { Keyboard } from "lucide-react"
import { Icons } from "@/components/icons"
import { openShortcuts } from "@/lib/shortcuts"
import { NavItem } from "./nav-item"
import { UserAccountNav } from "./user-account-nav"

export function MainNav() {
  return (
    <header className="sticky top-0 z-40 w-full border-b-[3px] border-ink bg-card">
      <nav
        aria-label="Main"
        className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between gap-2 px-4"
      >
        <div className="flex min-w-0 items-center gap-1 sm:gap-2">
          <Link
            href="/"
            className="mr-1 inline-flex min-h-11 items-center gap-2 rounded-md pr-2 font-display text-2xl font-bold uppercase tracking-wide text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span
              aria-hidden="true"
              className="block size-4 rounded-full border-[4px] border-primary bg-card"
            />
            <span>
              NU<span className="text-primary">Guessr</span>
            </span>
          </Link>
          <NavItem href="/leaderboards">
            <Icons.trophy className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">Leaderboards</span>
            <span className="sr-only sm:hidden">Leaderboards</span>
          </NavItem>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={openShortcuts}
            aria-label="Keyboard shortcuts"
            title="Keyboard shortcuts (?)"
            className="hidden min-h-11 items-center gap-2 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:inline-flex"
          >
            <Keyboard className="size-4" aria-hidden="true" />
            <kbd className="rounded border border-border px-1.5 font-mono text-xs">?</kbd>
          </button>
          <UserAccountNav />
        </div>
      </nav>
    </header>
  )
}
