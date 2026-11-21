"use client"

import { useEffect, useRef, useState } from "react"
import { Clock } from "lucide-react"
import { cn } from "@/lib/utils"

interface TimerProps {
  seconds: number
  /** Called exactly once when the countdown reaches zero (unless stopped). */
  onComplete?: () => void
  /** Freeze the display and never fire onComplete (e.g. while a guess is being submitted). */
  stopped?: boolean
  className?: string
}

/**
 * Countdown based on a fixed deadline (not a tick counter), so a throttled
 * background tab still expires on time. Remount with a new `key` per round.
 */
export default function Timer({ seconds, onComplete, stopped = false, className }: TimerProps) {
  const [timeLeft, setTimeLeft] = useState(seconds)
  const deadlineRef = useRef(Date.now() + seconds * 1000)
  const firedRef = useRef(false)
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete

  useEffect(() => {
    if (stopped) return
    const tick = () => {
      const left = Math.max(0, Math.ceil((deadlineRef.current - Date.now()) / 1000))
      setTimeLeft(left)
      if (left <= 0 && !firedRef.current) {
        firedRef.current = true
        onCompleteRef.current?.()
      }
    }
    tick()
    const id = setInterval(tick, 250)
    return () => clearInterval(id)
  }, [stopped])

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
