import { cn } from "@/lib/utils"

export interface PodiumPlayer {
  id: string
  username: string
  score: number
}

const BULBS = 22

/**
 * Top three on a lit stage: a marquee of twinkling bulbs, two spotlights
 * sweeping over first place, and the podium blocks in 2-1-3 order.
 * All motion stops for people who prefer reduced motion.
 */
export function LeaderboardPodium({
  players,
  meId,
  scoreLabel,
}: {
  players: PodiumPlayer[]
  meId: string | null
  scoreLabel: string
}) {
  const [first, second, third] = players
  // Display order: 2nd, 1st, 3rd.
  const slots: { player?: PodiumPlayer; place: 1 | 2 | 3 }[] = [
    { player: second, place: 2 },
    { player: first, place: 1 },
    { player: third, place: 3 },
  ]

  return (
    <section
      aria-label="Top three players"
      className="relative isolate mb-6 overflow-hidden rounded-lg bg-ink px-3 pb-0 pt-10 text-ink-foreground sm:px-8"
    >
      {/* Marquee bulbs */}
      <div aria-hidden="true" className="absolute inset-x-0 top-3 flex justify-between px-4">
        {Array.from({ length: BULBS }, (_, i) => (
          <span
            key={i}
            className="block size-2.5 rounded-full bg-amber-200 shadow-[0_0_8px_2px_rgba(253,230,138,0.75)] motion-safe:animate-bulb"
            style={{ animationDelay: `${(i % 6) * 0.25}s` }}
          />
        ))}
      </div>

      {/* Spotlights sweeping over first place */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <span
          className="absolute -top-6 left-[22%] h-[130%] w-40 origin-top bg-gradient-to-b from-amber-100/35 via-amber-100/10 to-transparent [clip-path:polygon(45%_0,55%_0,100%_100%,0_100%)] motion-safe:animate-sweep"
        />
        <span
          className="absolute -top-6 right-[22%] h-[130%] w-40 origin-top bg-gradient-to-b from-amber-100/35 via-amber-100/10 to-transparent [clip-path:polygon(45%_0,55%_0,100%_100%,0_100%)] motion-safe:animate-sweep-reverse"
        />
      </div>

      <ol className="grid grid-cols-3 items-end gap-2 sm:gap-4">
        {slots.map(({ player, place }) => (
          <li
            key={place}
            className={cn("flex flex-col items-center", place === 1 ? "order-2" : place === 2 ? "order-1" : "order-3")}
          >
            {player ? (
              <>
                <div className="mb-2 flex min-w-0 max-w-full flex-col items-center text-center">
                  {place === 1 && (
                    <span aria-hidden="true" className="mb-1 whitespace-nowrap font-display text-xs font-bold uppercase tracking-[0.15em] text-amber-200 sm:text-sm sm:tracking-[0.2em]">
                      ★ Champion ★
                    </span>
                  )}
                  <span
                    className={cn(
                      "flex items-center justify-center rounded-full font-display font-bold uppercase ring-4",
                      place === 1
                        ? "size-16 bg-primary text-2xl text-primary-foreground ring-amber-200 shadow-[0_0_24px_4px_rgba(253,230,138,0.45)] sm:size-20 sm:text-3xl"
                        : "size-12 bg-ink-foreground/10 text-xl ring-ink-foreground/30 sm:size-14"
                    )}
                    aria-hidden="true"
                  >
                    {player.username.trim().charAt(0) || "?"}
                  </span>
                  <span className="mt-2 w-full truncate px-1 text-sm font-medium sm:text-base" title={player.username}>
                    {player.username}
                  </span>
                  {player.id === meId && (
                    <span className="mb-0.5 rounded-sm bg-primary px-1.5 font-mono text-xs font-semibold">You</span>
                  )}
                  <span className="font-mono text-sm font-semibold tabular-nums text-amber-100 sm:text-lg">
                    {player.score.toLocaleString()}
                    <span className="sr-only"> {scoreLabel}</span>
                  </span>
                </div>
                <div
                  className={cn(
                    "flex w-full items-start justify-center rounded-t-md border-t-4 pt-2 font-display font-bold",
                    place === 1
                      ? "h-28 border-amber-200 bg-primary text-5xl sm:h-36"
                      : place === 2
                        ? "h-20 border-ink-foreground/50 bg-ink-foreground/15 text-4xl sm:h-24"
                        : "h-14 border-ink-foreground/40 bg-ink-foreground/10 text-3xl sm:h-16"
                  )}
                >
                  <span className="sr-only">Place </span>
                  {place}
                </div>
              </>
            ) : (
              <div className="flex h-14 w-full items-center justify-center rounded-t-md border-t-4 border-dashed border-ink-foreground/20 text-xs text-ink-foreground/50">
                Open spot
              </div>
            )}
          </li>
        ))}
      </ol>
    </section>
  )
}
