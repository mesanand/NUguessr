"use client"

import { Suspense, useEffect, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Loader2, PlayCircle, RotateCcw } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { SignInButton } from "@/components/signin-button"
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
  const { user } = useUser()

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
        <Card className="w-full max-w-2xl rounded-2xl border-border shadow-sm">
          <CardContent className="space-y-3 p-6 text-center sm:p-10">
            <h1 className="text-2xl font-bold">
              {state.kind === "unfinished" ? "This game isn't finished yet" : "No results to show"}
            </h1>
            <p className="text-base text-muted-foreground">
              {state.kind === "unfinished"
                ? "Finish all the rounds to see your final score."
                : state.message}
            </p>
            {state.kind === "unfinished" && (
              <Button asChild variant="outline" className="h-12 rounded-lg px-6 text-base">
                <Link href={`/play/${encodeURIComponent(state.gameId)}`}>
                  <PlayCircle />
                  Resume game
                </Link>
              </Button>
            )}
          </CardContent>
        </Card>
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
    <Shell>
      <Card className="w-full max-w-2xl rounded-2xl border-border shadow-sm">
        <CardContent className="space-y-6 p-6 text-center sm:p-10">
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Game finished</p>
            <h1 className="text-4xl font-bold tracking-tight">Well done!</h1>
          </div>
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Your total score</p>
            <p className="text-4xl font-bold tracking-tight text-primary tabular-nums">
              {total.toLocaleString()}
              <span className="ml-2 text-base font-medium text-muted-foreground">
                / {maxScore.toLocaleString()} points
              </span>
            </p>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between px-1 text-sm text-muted-foreground">
              <span>Score</span>
              <span className="tabular-nums">{scorePercentage.toFixed(1)}%</span>
            </div>
            <Progress value={scorePercentage} aria-label="Score percentage" className="h-2" />
          </div>

          {/* Per-round recap (safe to show names now: the game is finished) */}
          <ol className="divide-y divide-border overflow-hidden rounded-lg border border-border text-left">
            {game.rounds.map((round) => {
              const r = round.result
              const name = cleanText(r?.name) ?? "Unknown spot"
              return (
                <li
                  key={round.roundIndex}
                  className="flex items-center gap-3 px-4 py-3 even:bg-muted/50"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-semibold text-secondary-foreground">
                    {round.roundIndex + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{name}</p>
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
                  <span className="shrink-0 font-semibold tabular-nums">
                    {(r?.points ?? 0).toLocaleString()} pts
                  </span>
                </li>
              )
            })}
          </ol>

          {!user?.email && (
            <p className="text-base text-muted-foreground">Log in to save your score!</p>
          )}
        </CardContent>
      </Card>

      <PlayAgain label="Play again" withSignIn />
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[100dvh] flex-col bg-background text-foreground">
      <main className="container mx-auto flex flex-1 flex-col items-center justify-center gap-6 px-4 py-8">
        {children}
      </main>
    </div>
  )
}

function LoadingCard() {
  return (
    <Card className="w-full max-w-2xl rounded-2xl border-border shadow-sm">
      <CardContent className="flex items-center justify-center gap-2 p-10 text-base text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Loading your results...
      </CardContent>
    </Card>
  )
}

function PlayAgain({ label, withSignIn = false }: { label: string; withSignIn?: boolean }) {
  const { start, pending, error } = useStartGame()
  return (
    <div className="flex w-full max-w-2xl flex-col gap-3">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <Button
          type="button"
          className="h-12 flex-1 rounded-lg text-base font-semibold"
          onClick={start}
          disabled={pending}
          aria-busy={pending}
        >
          {pending ? <Loader2 className="animate-spin" /> : <RotateCcw />}
          {label}
        </Button>
        {withSignIn && <SignInButton />}
      </div>
      {error && (
        <p role="alert" className="text-center text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
