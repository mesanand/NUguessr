"use client"

import { Suspense, useEffect, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Check, Loader2, PlayCircle, RotateCcw, Share2 } from "lucide-react"
import { MainNav } from "@/components/main-nav"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { NameOnBoard } from "@/components/name-on-board"
import { useUser } from "../../../hooks/use-user"
import { getGame } from "@/app/play/actions"
import type { GameState } from "@/lib/game-types"
import { MAX_GAME_SCORE, MAX_POINTS_PER_ROUND } from "@/lib/scoring"
import { friendlyError } from "@/components/game/messages"
import { cleanText } from "@/components/game/credit-utils"
import { useStartGame } from "@/components/game/use-start-game"

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "unfinished"; gameId: string }
  | { kind: "done"; game: GameState }

export default function PlayFinishPage() {
  return (
    <Suspense fallback={<Shell><LoadingCard /></Shell>}>
      <PlayFinish />
    </Suspense>
  )
}

function PlayFinish() {
  const searchParams = useSearchParams()
  const gameId = searchParams.get("game") ?? ""
  const [state, setState] = useState<LoadState>({ kind: "loading" })
  const { user, loading: userLoading } = useUser()

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!gameId) {
        setState({ kind: "error", message: "There's no finished game to show here." })
        return
      }
      try {
        const res = await getGame(gameId)
        if (cancelled) return
        if (!res.ok) setState({ kind: "error", message: friendlyError(res.error) })
        else if (!res.data.finished) setState({ kind: "unfinished", gameId })
        else setState({ kind: "done", game: res.data })
      } catch {
        if (!cancelled) setState({ kind: "error", message: friendlyError(null) })
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [gameId])

  if (state.kind === "loading") {
    return (
      <Shell>
        <LoadingCard />
      </Shell>
    )
  }

  if (state.kind !== "done") {
    return (
      <Shell>
        <div className="space-y-3 rounded-md border border-border bg-card p-6 text-center sm:p-10">
            <h1 className="text-3xl uppercase">
              {state.kind === "unfinished" ? "This game isn't finished yet" : "No results to show"}
            </h1>
            <p className="text-base text-muted-foreground">
              {state.kind === "unfinished"
                ? "Finish all the rounds to see your final score."
                : state.message}
            </p>
            {state.kind === "unfinished" && (
              <Button asChild variant="outline" className="h-12 rounded-md px-6 text-base">
                <Link href={`/play/${encodeURIComponent(state.gameId)}`}>
                  <PlayCircle />
                  Resume game
                </Link>
              </Button>
            )}
        </div>
        <PlayAgain label="Play" />
      </Shell>
    )
  }

  const { game } = state
  const roundsSum = game.rounds.reduce((acc, r) => acc + (r.result?.points ?? 0), 0)
  const total = game.totalScore ?? roundsSum
  const maxScore = game.rounds.length > 0 ? game.rounds.length * MAX_POINTS_PER_ROUND : MAX_GAME_SCORE
  const scorePercentage = Math.min(100, (total / maxScore) * 100)

  return (
    <div className="flex min-h-[100dvh] flex-col bg-background text-foreground">
      <MainNav />

      {/* Arrival board: the final score */}
      <header className="bg-ink text-ink-foreground">
        <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:py-10">
          <div className="h-1 w-12 bg-primary" aria-hidden="true" />
          <p className="sign-label mt-3 text-ink-foreground/70">Trip complete</p>
          <h1 className="mt-1 text-4xl uppercase sm:text-5xl">{verdict(scorePercentage)}</h1>
          <p className="mt-4 font-mono text-4xl font-semibold tabular-nums sm:text-5xl">
            {total.toLocaleString()}
            <span className="ml-2 text-lg font-normal text-ink-foreground/70">
              / {maxScore.toLocaleString()} points
            </span>
          </p>
          <Progress
            value={scorePercentage}
            aria-label={`Score ${scorePercentage.toFixed(1)}%`}
            className="mt-4 h-1.5 bg-ink-foreground/20"
          />
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-8">
        {/* The route you took: one stop per round (safe to show names now:
            the game is finished) */}
        <section aria-labelledby="your-route">
          <h2 id="your-route" className="text-2xl uppercase">
            Your route
          </h2>
          <ol className="mt-4">
            {game.rounds.map((round, i) => {
              const r = round.result
              const name = cleanText(r?.name) ?? "Unknown spot"
              const scored = (r?.points ?? 0) > 0
              const isLast = i === game.rounds.length - 1
              return (
                <li key={round.roundIndex} className="relative flex gap-4 pb-5 last:pb-0">
                  {!isLast && (
                    <span
                      aria-hidden="true"
                      className="absolute left-[10px] top-6 h-[calc(100%-1rem)] w-[3px] bg-primary"
                    />
                  )}
                  <span
                    aria-hidden="true"
                    className={cn(
                      "relative z-10 mt-1 block size-6 shrink-0 rounded-full border-[4px]",
                      scored ? "border-primary bg-primary" : "border-primary bg-background"
                    )}
                  />
                  <div className="flex min-w-0 flex-1 items-baseline justify-between gap-3 border-b border-border pb-4">
                    <div className="min-w-0">
                      <p className="font-mono text-xs text-muted-foreground">Stop {round.roundIndex + 1}</p>
                      <p className="truncate text-lg font-medium">{name}</p>
                      <p className="text-sm text-muted-foreground">
                        {!r
                          ? "Not played"
                          : r.guess === null || r.distanceYards === null
                            ? "Time's up"
                            : r.late
                              ? "Too late"
                              : `${r.distanceYards.toLocaleString()} ${r.distanceYards === 1 ? "yard" : "yards"} away`}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "shrink-0 font-mono text-lg font-semibold tabular-nums",
                        scored ? "text-primary" : "text-muted-foreground"
                      )}
                    >
                      {(r?.points ?? 0).toLocaleString()} pts
                    </span>
                  </div>
                </li>
              )
            })}
          </ol>
        </section>

        <ShareScore total={total} maxScore={maxScore} rounds={game.rounds.map((r) => r.result?.points ?? 0)} />

        {!userLoading && <NameOnBoard userId={user?.id ?? null} key={user?.id ?? "guest"} />}

        <PlayAgain label="Play again" />
      </main>
    </div>
  )
}

function verdict(pct: number): string {
  if (pct >= 90) return "Campus legend"
  if (pct >= 70) return "Knows the way"
  if (pct >= 45) return "Getting there"
  if (pct >= 20) return "Took the scenic route"
  return "Lost on the Green Line"
}

/**
 * Copies (or shares, on phones) a spoiler-free summary: the score and one
 * mark per round, never the place names.
 */
function ShareScore({ total, maxScore, rounds }: { total: number; maxScore: number; rounds: number[] }) {
  const [copied, setCopied] = useState(false)
  const marks = rounds
    .map((p) => (p >= 4000 ? "●" : p > 0 ? "◐" : "○"))
    .join("—")
  const text = `NUGuessr: ${total.toLocaleString()} / ${maxScore.toLocaleString()}\n${marks}\nhttps://nuguessr.vercel.app`

  async function share() {
    try {
      if (typeof navigator.share === "function" && window.matchMedia("(pointer: coarse)").matches) {
        await navigator.share({ text })
        return
      }
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // Share sheet dismissed or clipboard blocked: nothing to do.
    }
  }

  return (
    <div className="flex items-center justify-between gap-4 rounded-md border border-border bg-card p-4">
      <div className="min-w-0">
        <p className="sign-label">Share</p>
        <p className="mt-1 truncate font-mono text-base tracking-wider" aria-hidden="true">
          {marks}
        </p>
      </div>
      <Button type="button" variant="outline" onClick={share} className="h-11 shrink-0 rounded-md">
        {copied ? <Check /> : <Share2 />}
        {copied ? "Copied" : "Share score"}
      </Button>
    </div>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[100dvh] flex-col bg-background text-foreground">
      <MainNav />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-stretch justify-center gap-6 px-4 py-8">
        {children}
      </main>
    </div>
  )
}

function LoadingCard() {
  return (
    <div className="flex items-center justify-center gap-2 rounded-md border border-border bg-card p-10 text-base text-muted-foreground">
      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      Loading your results...
    </div>
  )
}

function PlayAgain({ label }: { label: string }) {
  const { start, pending, error } = useStartGame()
  return (
    <div className="flex w-full flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Button
          type="button"
          className="h-12 flex-1 rounded-md text-base font-semibold uppercase tracking-wide"
          onClick={start}
          disabled={pending}
          aria-busy={pending}
        >
          {pending ? <Loader2 className="animate-spin" /> : <RotateCcw />}
          {label}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-center text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
