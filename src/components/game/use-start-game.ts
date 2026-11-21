"use client"

import { useCallback, useState } from "react"
import { useRouter } from "next/navigation"
import { startGame } from "@/app/play/actions"
import { friendlyError } from "./messages"

/** Starts a server-recorded game and navigates to /play/<gameId>. */
export function useStartGame() {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const start = useCallback(async () => {
    if (pending) return
    setPending(true)
    setError(null)
    try {
      const res = await startGame()
      if (res.ok) {
        router.push(`/play/${res.data.gameId}`)
        return // keep the button disabled while navigating
      }
      setError(friendlyError(res.error))
    } catch {
      setError(friendlyError(null))
    }
    setPending(false)
  }, [pending, router])

  return { start, pending, error }
}
