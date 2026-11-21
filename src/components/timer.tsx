"use client"

import { useEffect, useRef, useState } from "react"
import { Clock } from "lucide-react"
import { cn } from "@/lib/utils"

interface TimerProps {
  /**
   * Absolute deadline in the CLIENT's clock (epoch ms). Preferred: the game
   * passes the server deadline corrected for clock skew, so a refresh never
   * resets the countdown.
   */
  deadline?: number
  /** Fallback when no deadline is given: count down this many seconds from mount. */
  seconds?: number
  /** Called exactly once when the countdown reaches zero (unless stopped). */
  onComplete?: () => void
  /** Freeze the display and never fire onComplete (e.g. while a guess is being submitted). */
  stopped?: boolean
  className?: string
}

function secondsLeft(deadline: number): number {
  return Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
}

/**
 * Countdown based on a fixed deadline (not a tick counter), so a throttled
 * background tab still expires on time. Remount with a new `key` per round.
 */
export default function Timer({ deadline, seconds = 0, onComplete, stopped = false, className }: TimerProps) {
  const fallbackDeadlineRef = useRef<number | null>(null)
  if (deadline === undefined && fallbackDeadlineRef.current === null) {
    fallbackDeadlineRef.current = Date.now() + seconds * 1000
  }
  const target = deadline ?? (fallbackDeadlineRef.current as number)

  const [timeLeft, setTimeLeft] = useState(() => secondsLeft(target))
  const firedRef = useRef(false)
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete

  useEffect(() => {
    if (stopped) return
    const tick = () => {
      const left = secondsLeft(target)
      setTimeLeft(left)
      if (left <= 0 && !firedRef.current) {
        firedRef.current = true
        onCompleteRef.current?.()
      }
    }
    tick()
    const id = setInterval(tick, 250)
    return () => clearInterval(id)
  }, [stopped, target])

  const minutes = Math.floor(timeLeft / 60)
  const remainingSeconds = timeLeft % 60
  const formattedTime = `${minutes.toString().padStart(2, "0")}:${remainingSeconds.toString().padStart(2, "0")}`

  // Last 10 seconds: switch to the primary (tomato) treatment as a warning.
  const isLow = timeLeft <= 10

  return (
    <div
      role="timer"
      aria-label={`${formattedTime} remaining`}
      className={cn(
        "inline-flex h-11 items-center gap-2 rounded-lg border px-3 font-mono text-lg font-semibold tabular-nums transition-colors",
        isLow
          ? "border-primary bg-secondary text-secondary-foreground"
          : "border-border bg-background text-foreground",
        className,
      )}
    >
      <Clock className="size-4" aria-hidden="true" />
      {formattedTime}
    </div>
  )
}
