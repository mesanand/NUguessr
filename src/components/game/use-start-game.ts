"use client"

import { useCallback, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { startGame } from "@/app/play/actions"
import { ensurePlayer } from "@/lib/player"
import { friendlyError } from "./messages"

/**
 * Starts a server-recorded game and navigates to /play/<gameId>. Guarded by a
 * ref so a double click can't start two games (for players with an account,
 * anonymous included, a new game closes and counts any unfinished one).
 */
export function useStartGame() {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const pendingRef = useRef(false)
  const [error, setError] = useState<string | null>(null)

  const start = useCallback(async () => {
    if (pendingRef.current) return
    pendingRef.current = true
    setPending(true)
    setError(null)
    try {
      // Give this browser an anonymous player account first, so the game
      // is recorded against it and can go on the leaderboard.
      await ensurePlayer()
      const res = await startGame()
      if (res.ok) {
        router.push(`/play/${res.data.gameId}`)
        return // keep the button disabled while navigating
      }
      setError(friendlyError(res.error))
    } catch {
      setError(friendlyError(null))
    }
    pendingRef.current = false
    setPending(false)
  }, [router])

  return { start, pending, error }
}
