"use client"

// The game screen. Client-only: src/app/play/[gameId]/page.tsx loads this
// with next/dynamic { ssr: false } because Leaflet touches `window` at import.
//
// All state lives on the server (src/app/play/actions.ts). This component only
// ever holds what the server has revealed: the photo URL before a guess, and
// the round result after it. Refreshing resumes at the first unsubmitted round.

import { useCallback, useEffect, useRef, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { AlertCircle, Loader2, RotateCcw } from "lucide-react"
import { finishGame, getGame, submitGuess } from "@/app/play/actions"
import type { GameState, LatLng, RoundResult } from "@/lib/game-types"
import { ROUND_TIME_SECONDS } from "@/lib/scoring"
import { Button } from "@/components/ui/button"
import Timer from "@/components/timer"
import MapResult from "@/components/map-result"
import GuessMap from "./guess-map"
import { friendlyError } from "./messages"
import { useStartGame } from "./use-start-game"

interface ShownResult {
  result: RoundResult
  totalSoFar: number
  isLastRound: boolean
}

type Phase =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "guessing" }
  | { kind: "result"; shown: ShownResult }

function sumPoints(game: GameState): number {
  return game.rounds.reduce((acc, r) => acc + (r.result?.points ?? 0), 0)
}

export default function PlayGame({ gameId }: { gameId: string }) {
  const router = useRouter()
  const [game, setGame] = useState<GameState | null>(null)
  const [roundIndex, setRoundIndex] = useState(0)
  const [phase, setPhase] = useState<Phase>({ kind: "loading" })

  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const lastAttemptRef = useRef<LatLng | null>(null)
  // Once the timer has run out, the round can only be submitted as a timeout.
  const timedOutRef = useRef(false)

  const [finishing, setFinishing] = useState(false)
  const [finishError, setFinishError] = useState<string | null>(null)

  const finishUrl = `/play-finish?game=${encodeURIComponent(gameId)}`

  /**
   * Load (or reload) the game from the server. If `showRound` has already
   * been submitted, its result is shown; otherwise play resumes at the first
   * round without a result.
   */
  const load = useCallback(
    async (showRound?: number) => {
      const res = await getGame(gameId)
      if (!res.ok) {
        setPhase({ kind: "error", message: friendlyError(res.error) })
        return
      }
      const g = res.data
      if (g.finished) {
        router.replace(finishUrl)
        return
      }
      if (g.rounds.length === 0) {
        setPhase({ kind: "error", message: friendlyError("game_not_found") })
        return
      }
      setGame(g)

      const lastIndex = g.rounds.length - 1
      const firstOpen = g.rounds.findIndex((r) => r.result === null)
      const revealIndex =
        showRound !== undefined && g.rounds[showRound]?.result
          ? showRound
          : firstOpen === -1
            ? lastIndex // everything submitted but not finished: show last result
            : null

      if (revealIndex !== null) {
        const result = g.rounds[revealIndex].result as RoundResult
        const totalSoFar = g.rounds
          .slice(0, revealIndex + 1)
          .reduce((acc, r) => acc + (r.result?.points ?? 0), 0)
        setRoundIndex(revealIndex)
        setPhase({
          kind: "result",
          shown: { result, totalSoFar, isLastRound: revealIndex === lastIndex },
        })
      } else {
        timedOutRef.current = false
        setRoundIndex(firstOpen)
        setPhase({ kind: "guessing" })
      }
    },
    [gameId, router, finishUrl]
  )

  useEffect(() => {
    load()
  }, [load])

  const submit = useCallback(
    async (guess: LatLng | null) => {
      if (submittingRef.current || !game) return
      submittingRef.current = true
      setSubmitting(true)
      setSubmitError(null)
      lastAttemptRef.current = guess
      const index = roundIndex
      try {
        const res = await submitGuess(gameId, index, guess)
        if (res.ok) {
          const { roundIndex: _ri, isLastRound, totalSoFar, ...result } = res.data
          void _ri
          setGame((g) =>
            g
              ? {
                  ...g,
                  rounds: g.rounds.map((r) => (r.roundIndex === index ? { ...r, result } : r)),
                }
              : g
          )
          setPhase({ kind: "result", shown: { result, totalSoFar, isLastRound } })
        } else if (res.error === "round_out_of_order") {
          // Another tab (or a double submit) got there first: resync.
          await load(index)
        } else if (res.error === "game_finished") {
          router.replace(finishUrl)
        } else {
          setSubmitError(friendlyError(res.error))
        }
      } catch {
        setSubmitError(friendlyError(null))
      } finally {
        submittingRef.current = false
        setSubmitting(false)
      }
    },
    [game, gameId, roundIndex, load, router, finishUrl]
  )

  const handleTimeout = useCallback(() => {
    timedOutRef.current = true
    submit(null)
  }, [submit])

  const handleNext = useCallback(async () => {
    if (phase.kind !== "result" || !game) return
    if (!phase.shown.isLastRound) {
      setSubmitError(null)
      timedOutRef.current = false
      setRoundIndex((i) => i + 1)
      setPhase({ kind: "guessing" })
      return
    }
    if (finishing) return
    setFinishing(true)
    setFinishError(null)
    try {
      const res = await finishGame(gameId)
      if (res.ok) {
        router.push(finishUrl)
        return // stay disabled while navigating
      }
      setFinishError(friendlyError(res.error))
    } catch {
      setFinishError(friendlyError(null))
    }
    setFinishing(false)
  }, [phase, game, finishing, gameId, router, finishUrl])

  if (phase.kind === "loading") {
    return (
      <div className="flex h-[100dvh] flex-col bg-background text-foreground">
        <header className="flex h-16 shrink-0 items-center border-b border-border bg-card px-4 sm:px-6">
          <span className="text-sm text-muted-foreground">Round</span>
        </header>
        <main className="flex flex-1 items-center justify-center bg-muted">
          <p className="inline-flex items-center gap-2 text-base text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Loading game...
          </p>
        </main>
      </div>
    )
  }

  if (phase.kind === "error" || !game) {
    return (
      <GameError message={phase.kind === "error" ? phase.message : friendlyError(null)} />
    )
  }

  const round = game.rounds[roundIndex]
  const totalRounds = game.rounds.length

  if (phase.kind === "result") {
    return (
      <MapResult
        result={phase.shown.result}
        imageUrl={round.imageUrl}
        round={roundIndex + 1}
        totalRounds={totalRounds}
        totalSoFar={phase.shown.totalSoFar}
        isLastRound={phase.shown.isLastRound}
        onNext={handleNext}
        pending={finishing}
        error={finishError}
      />
    )
  }

  return (
    <div className="flex h-[100dvh] flex-col bg-background text-foreground">
      {/* Header bar: round indicator + timer on one row */}
      <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-border bg-card px-4 sm:px-6">
        <div className="flex items-baseline gap-2">
          <span className="text-sm text-muted-foreground">Round</span>
          <span className="text-xl font-semibold tabular-nums">
            {roundIndex + 1} / {totalRounds}
          </span>
          <span className="sr-only">Score so far: {sumPoints(game)} points</span>
        </div>
        <Timer
          key={roundIndex}
          seconds={ROUND_TIME_SECONDS}
          onComplete={handleTimeout}
          stopped={submitting}
        />
      </header>

      {/* Photo fills the rest of the viewport (bottom padding on mobile
          leaves room for the collapsed "Open map" bar). */}
      <main className="relative min-h-0 flex-1 bg-muted pb-20 sm:pb-0">
        <div className="relative h-full w-full">
          <Image
            key={round.imageUrl}
            src={round.imageUrl}
            alt="Mystery campus location"
            fill
            unoptimized
            priority
            className="object-contain"
          />
        </div>

        {submitError && (
          <div
            role="alert"
            className="absolute inset-x-4 top-4 z-[1100] mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-border bg-card p-3 text-sm shadow-md"
          >
            <AlertCircle className="size-5 shrink-0 text-destructive" aria-hidden="true" />
            <span className="flex-1">{submitError}</span>
            <Button
              type="button"
              variant="outline"
              onClick={() => submit(timedOutRef.current ? null : lastAttemptRef.current)}
              disabled={submitting}
              className="h-11 rounded-lg"
            >
              <RotateCcw />
              Retry
            </Button>
          </div>
        )}
      </main>

      <GuessMap key={roundIndex} onSubmit={(g) => submit(timedOutRef.current ? null : g)} submitting={submitting} />
    </div>
  )
}

function GameError({ message }: { message: string }) {
  const { start, pending, error } = useStartGame()
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-background px-6 text-center text-foreground">
      <h1 className="text-2xl font-bold">We couldn&apos;t load this game</h1>
      <p className="max-w-md text-base text-muted-foreground">{error ?? message}</p>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button
          type="button"
          onClick={start}
          disabled={pending}
          className="h-12 rounded-lg px-8 text-base font-semibold"
        >
          {pending && <Loader2 className="animate-spin" />}
          Start a new game
        </Button>
        <Button asChild variant="outline" className="h-12 rounded-lg px-6 text-base">
          <Link href="/">Home</Link>
        </Button>
      </div>
    </div>
  )
}
