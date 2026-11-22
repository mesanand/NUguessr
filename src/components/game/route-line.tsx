import { cn } from "@/lib/utils"

interface RouteLineProps {
  /** Number of rounds (stops) in the game. */
  total: number
  /** 0-based index of the round being played or shown. */
  current: number
  /** How many rounds are already finished (filled stops). */
  done: number
  /** Light variant for dark (ink) backgrounds. */
  onDark?: boolean
  className?: string
}

/**
 * The round tracker: rounds drawn as stops on a transit line. Finished stops
 * are filled red, the current stop is a ring, the rest of the line is grey.
 * Also renders the plain "2 / 5" text that screen readers and tests use.
 */
export function RouteLine({ total, current, done, onDark = false, className }: RouteLineProps) {
  const stops = Array.from({ length: total }, (_, i) => i)
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <ol className="flex items-center" aria-hidden="true">
        {stops.map((i) => {
          const isDone = i < done
          const isCurrent = !isDone && i === current
          const segmentTravelled = i < current
          return (
            <li key={i} className="flex items-center">
              <span
                className={cn(
                  "block rounded-full transition-colors",
                  isCurrent
                    ? cn("size-4 border-[3px] border-primary", onDark ? "bg-ink" : "bg-card")
                    : isDone
                      ? "size-3 bg-primary"
                      : "size-3 bg-rail"
                )}
              />
              {i < total - 1 && (
                <span
                  className={cn(
                    "block h-[3px] w-4 sm:w-6",
                    segmentTravelled ? "bg-primary" : "bg-rail"
                  )}
                />
              )}
            </li>
          )
        })}
      </ol>
      <span
        className={cn(
          "font-mono text-sm tabular-nums",
          onDark ? "text-ink-foreground/80" : "text-muted-foreground"
        )}
      >
        <span className="sr-only">Round </span>
        <span>
          {current + 1} / {total}
        </span>
      </span>
    </div>
  )
}
