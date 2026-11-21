"use client"

// Round results view. Client-only (Leaflet): only imported from the game
// component, which is loaded with next/dynamic { ssr: false }.
// Every number shown here comes from the server (SubmitResult / RoundResult);
// nothing is recomputed in the browser.

import Image from "next/image"
import { MapContainer, Marker, Polyline } from "react-leaflet"
import "leaflet/dist/leaflet.css"
import { ArrowRight, Clock, Loader2, PartyPopper } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { CAMPUS_MAX_ZOOM } from "@/lib/campus"
import { MAX_POINTS_PER_ROUND } from "@/lib/scoring"
import type { RoundResult } from "@/lib/game-types"
import { actualIcon, guessIcon } from "@/components/game/leaflet-icons"
import { PhotoCredit } from "@/components/game/photo-credit"
import { cleanText } from "@/components/game/credit-utils"
import CampusBasemap, { BASEMAP_BACKGROUND } from "@/components/game/campus-basemap"

interface MapResultProps {
  result: RoundResult
  /** null if the server didn't return the photo (shouldn't happen for submitted rounds) */
  imageUrl: string | null
  /** 1-based round number */
  round: number
  totalRounds: number
  /** Server running total after this round */
  totalSoFar: number
  isLastRound: boolean
  onNext: () => void
  /** "View results" is finishing the game on the server */
  pending?: boolean
  error?: string | null
}

export default function MapResult({
  result,
  imageUrl,
  round,
  totalRounds,
  totalSoFar,
  isLastRound,
  onNext,
  pending = false,
  error = null,
}: MapResultProps) {
  const { actual, guess, points, distanceYards } = result
  const timedOut = guess === null
  const late = !timedOut && result.late === true
  const isPerfect = !timedOut && !late && points >= MAX_POINTS_PER_ROUND
  const name = cleanText(result.name)
  const notes = result.notes?.trim() || null

  const actualPos: [number, number] = [actual.lat, actual.lng]
  const guessPos: [number, number] | null = guess ? [guess.lat, guess.lng] : null

  const mapView = guessPos
    ? {
        bounds: [
          [Math.min(actualPos[0], guessPos[0]), Math.min(actualPos[1], guessPos[1])],
          [Math.max(actualPos[0], guessPos[0]), Math.max(actualPos[1], guessPos[1])],
        ] as [[number, number], [number, number]],
        boundsOptions: { padding: [50, 50] as [number, number], maxZoom: 18 },
      }
    : { center: actualPos, zoom: 17 }

  return (
    <div className="flex min-h-[100dvh] flex-col bg-background text-foreground">
      {/* Header bar, matching the gameplay screen */}
      <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-border bg-card px-4 sm:px-6">
        <h1 className="text-xl font-semibold">
          Round {round} <span className="text-muted-foreground">/ {totalRounds}</span>
        </h1>
        <span className="text-sm text-muted-foreground tabular-nums">
          Total: {totalSoFar.toLocaleString()} pts
        </span>
      </header>

      <main className="container mx-auto flex flex-1 flex-col gap-6 px-4 py-6">
        <h2 className="text-2xl font-bold tracking-tight sm:text-4xl">
          {name ? `It was ${name}` : "Here's where it was"}
        </h2>

        <div className="flex flex-col gap-4 lg:flex-row">
          {/* Results map */}
          <div className="flex flex-1 flex-col gap-2">
            <div className="h-[45vh] min-h-[280px] overflow-hidden rounded-2xl border border-border shadow-sm lg:h-[60vh]">
              <MapContainer
                {...mapView}
                maxZoom={CAMPUS_MAX_ZOOM}
                preferCanvas
                className="h-full w-full"
                style={{ background: BASEMAP_BACKGROUND }}
              >
                {/* Same self-hosted campus drawing as the guess map (no tile
                    server dependency); the place name is shown above the map. */}
                <CampusBasemap />
                {guessPos && (
                  <Polyline
                    positions={[guessPos, actualPos]}
                    pathOptions={{ color: "#1f1e1b", weight: 4, dashArray: "10 10" }}
                  />
                )}
                {guessPos && <Marker position={guessPos} icon={guessIcon} />}
                <Marker position={actualPos} icon={actualIcon} />
              </MapContainer>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-2">
                <span className="block size-3 rounded-full bg-primary ring-2 ring-primary/30" aria-hidden="true" />
                Actual location
              </span>
              {guessPos && (
                <span className="inline-flex items-center gap-2">
                  <Image src="/marker-icon.png" alt="" aria-hidden="true" width={10} height={16} unoptimized />
                  Your guess
                </span>
              )}
            </div>
          </div>

          {/* Photo, credit, fun fact */}
          <div className="flex flex-col gap-4 lg:w-80">
            <Card className="overflow-hidden rounded-2xl border-border shadow-sm">
              <div className="relative aspect-[4/3] w-full bg-muted">
                {imageUrl && (
                  <Image
                    src={imageUrl}
                    alt={name ? `Photo of ${name}` : "Round photo"}
                    fill
                    unoptimized
                    sizes="(min-width: 1024px) 320px, 100vw"
                    className="object-cover"
                  />
                )}
              </div>
              <CardContent className="p-3">
                <PhotoCredit credit={result.credit} />
              </CardContent>
            </Card>
            {notes && (
              <Card className="rounded-2xl border-border shadow-sm">
                <CardContent className="max-h-60 space-y-2 overflow-y-auto p-4">
                  <h3 className="text-xl font-semibold">Fun fact</h3>
                  <p className="whitespace-pre-wrap text-base text-muted-foreground">{notes}</p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        {/* Score feedback */}
        <Card className="mx-auto w-full max-w-2xl rounded-2xl border-border shadow-sm">
          <CardContent className="flex flex-col items-center gap-4 p-6 text-center">
            {isPerfect && (
              <span className="inline-flex items-center gap-2 rounded-lg bg-mint-9 px-3 py-1 text-sm font-semibold text-mint-12">
                <PartyPopper className="size-4" aria-hidden="true" />
                Spot on! Full points.
              </span>
            )}
            <div
              className={cn(
                "text-4xl font-bold tracking-tight tabular-nums",
                isPerfect ? "text-accent-foreground" : "text-primary"
              )}
            >
              {points.toLocaleString()} points
            </div>
            <div className="w-full">
              <Progress
                value={(points / MAX_POINTS_PER_ROUND) * 100}
                aria-label={`${points} of ${MAX_POINTS_PER_ROUND} points`}
                className={cn("h-2", isPerfect ? "bg-accent" : "bg-secondary")}
              />
            </div>
            <p className="text-base text-muted-foreground">
              {timedOut ? (
                <span className="inline-flex items-center gap-2">
                  <Clock className="size-4" aria-hidden="true" />
                  Time&apos;s up — 0 points
                </span>
              ) : late ? (
                <span className="inline-flex flex-wrap items-center justify-center gap-x-2">
                  <Clock className="size-4" aria-hidden="true" />
                  Too late — guesses after the timer don&apos;t count. 0 points.
                  {distanceYards !== null && (
                    <span>
                      (Your guess was {distanceYards.toLocaleString()}{" "}
                      {distanceYards === 1 ? "yard" : "yards"} away.)
                    </span>
                  )}
                </span>
              ) : distanceYards !== null ? (
                <>
                  Your guess was{" "}
                  <span className="font-semibold text-primary">
                    {distanceYards.toLocaleString()} {distanceYards === 1 ? "yard" : "yards"}
                  </span>{" "}
                  from the correct location.
                </>
              ) : null}
            </p>
            <p className="text-sm text-muted-foreground tabular-nums">
              Total score: {totalSoFar.toLocaleString()} points
            </p>

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}

            <Button
              type="button"
              onClick={onNext}
              disabled={pending}
              aria-busy={pending}
              className="h-12 w-full rounded-lg text-base font-semibold sm:w-auto sm:px-8"
            >
              {isLastRound ? "View results" : "Start next round"}
              {pending ? <Loader2 className="animate-spin" /> : <ArrowRight />}
            </Button>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
