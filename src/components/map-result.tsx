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
import { cn } from "@/lib/utils"
import { CAMPUS_MAX_ZOOM } from "@/lib/campus"
import { MAX_POINTS_PER_ROUND } from "@/lib/scoring"
import type { RoundResult } from "@/lib/game-types"
import { actualIcon, guessIcon } from "@/components/game/leaflet-icons"
import { PhotoCredit } from "@/components/game/photo-credit"
import { cleanText } from "@/components/game/credit-utils"
import CampusBasemap, { BASEMAP_BACKGROUND } from "@/components/game/campus-basemap"
import { RouteLine } from "@/components/game/route-line"

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

  const distanceLabel = distanceYards === null ? "—" : `${distanceYards.toLocaleString()} yd`

  return (
    <div className="flex min-h-[100dvh] flex-col bg-background text-foreground">
      {/* Station sign: where you are on the line, then the answer */}
      <header className="shrink-0 bg-ink text-ink-foreground">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 pt-4 sm:px-6">
          <RouteLine total={totalRounds} current={round - 1} done={round} onDark />
          <span className="font-mono text-sm tabular-nums text-ink-foreground/80">
            Total: {totalSoFar.toLocaleString()} pts
          </span>
        </div>
        <div className="mx-auto w-full max-w-6xl px-4 pb-5 pt-3 sm:px-6">
          <div className="h-1 w-12 bg-primary" aria-hidden="true" />
          <h1 className="mt-3 text-4xl leading-none sm:text-5xl">
            {name ? (
              <>
                <span className="sign-label block pb-1 text-ink-foreground/70">It was </span>
                {name}
              </>
            ) : (
              "Here's where it was"
            )}
          </h1>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-5 px-4 py-5 sm:px-6">
        {/* Score: two big numbers */}
        <section aria-label="Round score" className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="sign-label">Distance</p>
            <p className="mt-1 font-mono text-2xl font-semibold tabular-nums sm:text-4xl">
              {timedOut ? "—" : distanceLabel}
            </p>
          </div>
          <div
            className={cn(
              "rounded-lg border p-4",
              points > 0 ? "border-primary/30 bg-secondary" : "border-border bg-card"
            )}
          >
            <p className={cn("sign-label", points > 0 && "text-secondary-foreground")}>Points</p>
            <p
              className={cn(
                "mt-1 font-mono text-2xl font-semibold tabular-nums sm:text-4xl",
                points > 0 ? "text-secondary-foreground" : "text-muted-foreground"
              )}
            >
              {points > 0 ? "+" : ""}
              {points.toLocaleString()}
              <span className="sr-only"> points</span>
            </p>
          </div>
          <div className="col-span-2 space-y-2">
            <Progress
              value={(points / MAX_POINTS_PER_ROUND) * 100}
              aria-label={`${points} of ${MAX_POINTS_PER_ROUND} points`}
              className="h-1.5 bg-rail/50"
            />
            <p className="text-sm text-muted-foreground">
              {isPerfect ? (
                <span className="inline-flex items-center gap-2 font-medium text-foreground">
                  <PartyPopper className="size-4 text-primary" aria-hidden="true" />
                  Spot on! Full points.
                </span>
              ) : timedOut ? (
                <span className="inline-flex items-center gap-2">
                  <Clock className="size-4" aria-hidden="true" />
                  Time&apos;s up — 0 points
                </span>
              ) : late ? (
                <span className="inline-flex flex-wrap items-center gap-x-2">
                  <Clock className="size-4" aria-hidden="true" />
                  Too late — guesses after the timer don&apos;t count. 0 points.
                </span>
              ) : distanceYards !== null ? (
                <>
                  Your guess was {distanceYards.toLocaleString()}{" "}
                  {distanceYards === 1 ? "yard" : "yards"} from the correct location, for{" "}
                  {points.toLocaleString()} points.
                </>
              ) : null}
            </p>
          </div>
        </section>

        <div className="flex flex-col gap-4 lg:flex-row">
          {/* Results map */}
          <div className="flex flex-1 flex-col gap-2">
            <div className="h-[42vh] min-h-[260px] overflow-hidden rounded-lg border border-border lg:h-[56vh]">
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
                    pathOptions={{ color: "#c51230", weight: 3, dashArray: "8 8" }}
                  />
                )}
                {guessPos && <Marker position={guessPos} icon={guessIcon} />}
                <Marker position={actualPos} icon={actualIcon} />
              </MapContainer>
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-2">
                <span className="block size-3 rounded-full bg-primary ring-2 ring-primary/30" aria-hidden="true" />
                Actual location
              </span>
              {guessPos && (
                <span className="inline-flex items-center gap-2">
                  <span className="block size-3 rounded-full bg-ink" aria-hidden="true" />
                  Your guess
                </span>
              )}
            </div>
          </div>

          {/* Photo, credit, fun fact */}
          <div className="flex flex-col gap-4 lg:w-80">
            <figure className="overflow-hidden rounded-lg border border-border bg-card">
              <div className="relative aspect-[4/3] w-full bg-ink">
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
              <figcaption className="p-3">
                <PhotoCredit credit={result.credit} />
              </figcaption>
            </figure>
            {notes && (
              <section className="rounded-lg border border-border bg-card p-4">
                <h3 className="sign-label">Fun fact</h3>
                <p className="mt-2 max-h-52 overflow-y-auto whitespace-pre-wrap text-base">{notes}</p>
              </section>
            )}
          </div>
        </div>

        {/* Next stop: pinned to the bottom on phones */}
        <div className="sticky bottom-0 z-[1000] -mx-4 mt-auto border-t border-border bg-background px-4 py-3 sm:static sm:mx-0 sm:flex sm:flex-col sm:items-end sm:border-0 sm:bg-transparent sm:px-0 sm:py-0">
          {error && (
            <p role="alert" className="mb-2 text-sm text-destructive">
              {error}
            </p>
          )}
          <Button
            type="button"
            onClick={onNext}
            disabled={pending}
            aria-busy={pending}
            className="h-12 w-full rounded-md text-base font-semibold sm:w-auto sm:px-8"
          >
            {isLastRound ? "View results" : "Start next round"}
            {pending ? <Loader2 className="animate-spin" /> : <ArrowRight />}
          </Button>
        </div>
      </main>
    </div>
  )
}
