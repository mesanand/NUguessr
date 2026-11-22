"use client"

// Site-wide keyboard shortcuts (mounted once in the root layout):
//   ?  show/hide the shortcuts overlay      Esc  close it
//   P  play a new game                       L    open the leaderboard
// P and L are off on /play/* so a stray key can't abandon a game.

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { X } from "lucide-react"
import { isTypingOrModified } from "@/lib/shortcuts"
import { useStartGame } from "@/components/game/use-start-game"
import { ShortcutList } from "@/components/shortcut-list"

export function GlobalShortcuts() {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()
  const router = useRouter()
  const { start } = useStartGame()
  const closeRef = useRef<HTMLButtonElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)

  const show = useCallback(() => {
    returnFocusRef.current = document.activeElement as HTMLElement | null
    setOpen(true)
  }, [])
  const hide = useCallback(() => {
    setOpen(false)
    returnFocusRef.current?.focus?.()
  }, [])

  useEffect(() => {
    const onOpen = () => show()
    window.addEventListener("nuguessr:shortcuts", onOpen)
    return () => window.removeEventListener("nuguessr:shortcuts", onOpen)
  }, [show])

  useEffect(() => {
    const inGame = pathname?.startsWith("/play/") ?? false
    function onKey(e: KeyboardEvent) {
      if (open && e.key === "Escape") {
        e.preventDefault()
        hide()
        return
      }
      if (isTypingOrModified(e)) return
      if (e.key === "?") {
        e.preventDefault()
        if (open) hide()
        else show()
        return
      }
      if (open || inGame) return
      const key = e.key.toLowerCase()
      if (key === "p") {
        e.preventDefault()
        start()
      } else if (key === "l" && pathname !== "/leaderboards") {
        e.preventDefault()
        router.push("/leaderboards")
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, pathname, router, start, show, hide])

  useEffect(() => {
    if (open) closeRef.current?.focus()
  }, [open])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-end justify-center bg-ink/60 p-0 sm:items-center sm:p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) hide()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        className="max-h-[85dvh] w-full max-w-2xl overflow-y-auto rounded-t-xl bg-background shadow-xl sm:rounded-xl"
      >
        <div className="sticky top-0 flex items-center justify-between gap-4 bg-ink px-5 py-4 text-ink-foreground">
          <div>
            <p className="sign-label text-ink-foreground/60">Press ? any time</p>
            <h2 id="shortcuts-title" className="text-2xl uppercase">
              Keyboard shortcuts
            </h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={hide}
            aria-label="Close shortcuts"
            className="inline-flex size-11 items-center justify-center rounded-md text-ink-foreground/80 hover:bg-ink-foreground/10 hover:text-ink-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <X className="size-5" />
          </button>
        </div>
        <div className="p-5">
          <ShortcutList compact />
          <p className="mt-6 text-sm text-muted-foreground">
            Also on its own page:{" "}
            <Link href="/shortcuts" onClick={() => setOpen(false)} className="font-medium text-foreground underline underline-offset-4">
              all shortcuts
            </Link>
            .
          </p>
        </div>
      </div>
    </div>
  )
}
