"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"

import { useUser } from "../../hooks/use-user"
import { createClient } from "@/lib/supabase/client"
import { Icons } from "@/components/icons"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

// Client component: the nav is rendered from client pages (e.g. the home
// page), so it reads the session via the shared useUser() hook instead of
// the server Supabase client.
export function UserAccountNav() {
  const { user, loading } = useUser()
  const router = useRouter()
  const pathname = usePathname()

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push("/")
    router.refresh()
  }

  if (loading) {
    return (
      <div
        aria-hidden="true"
        className="size-11 animate-pulse rounded-full bg-muted"
      />
    )
  }

  // Nobody signs in to play: visitors who haven't played yet see nothing
  // here, and anonymous players get a link to their stats and name.
  if (!user) return null
  if (user.is_anonymous) {
    if (pathname === "/profile") return null
    return (
      <Link
        href="/profile"
        className="inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Icons.user className="size-4" aria-hidden="true" />
        <span className="hidden sm:inline">Your stats</span>
        <span className="sr-only sm:hidden">Your stats</span>
      </Link>
    )
  }

  const name: string | undefined =
    user.user_metadata?.full_name ?? user.user_metadata?.name
  const initial = (name ?? user.email ?? "?").charAt(0).toUpperCase()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="size-11 rounded-full p-0"
          aria-label="Open account menu"
        >
          <Avatar className="size-9 border border-border">
            <AvatarImage src={user.user_metadata?.avatar_url} alt="" />
            <AvatarFallback className="bg-accent text-sm font-medium text-accent-foreground">
              {initial}
            </AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60 rounded-lg">
        <DropdownMenuLabel className="flex flex-col gap-0.5 font-normal">
          {name && (
            <span className="truncate text-sm font-medium text-foreground">
              {name}
            </span>
          )}
          {user.email && (
            <span className="truncate text-sm text-muted-foreground">
              {user.email}
            </span>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="min-h-11 cursor-pointer">
          <Link href="/profile">
            <Icons.user className="size-4" />
            Profile
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="min-h-11 cursor-pointer">
          <Link href="/leaderboards">
            <Icons.trophy className="size-4" />
            Leaderboards
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="min-h-11 cursor-pointer"
          onSelect={() => {
            void handleLogout()
          }}
        >
          <Icons.logOut className="size-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
