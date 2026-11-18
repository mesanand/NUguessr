"use client"

import React from "react"
import { useEffect, useState } from "react"
import { Clock } from "lucide-react"
import { cn } from "../lib/utils"

interface TimerProps {
  seconds: number
  onComplete?: () => void
  className?: string
}

export default function Timer({ seconds, onComplete, className }: TimerProps) {
  const [timeLeft, setTimeLeft] = useState(seconds)

  useEffect(() => {
    if (timeLeft <= 0) {
      onComplete?.()
      return
    }

    const timer = setInterval(() => {
      setTimeLeft((prev) => prev - 1)
    }, 1000)

    return () => clearInterval(timer)
  }, [timeLeft, onComplete])

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
