"use client"

import { MapContainer, TileLayer, Marker, Polyline } from "react-leaflet"
import "leaflet/dist/leaflet.css"
import { Icon } from "leaflet"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { ArrowRight, PartyPopper } from "lucide-react"
import { useEffect, useState } from "react"

interface MapResultProps {
  guessCoords: [number, number]
  actualCoords: [number, number]
  onNextRound: () => void
  round: number
  timeout: boolean
  notes: string
}

// Calculate distance between two points using the Haversine formula
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 3959 // Earth's radius in miles
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return Math.round(R * c * 1760)
}

// Calculate points based on distance (max 5000 points at 0 distance)
function calculatePoints(distance: number, timeout: boolean) {
  if (timeout) {
    return 0
  }
  if (distance < 12) {
    return 5000
  } else {
    return Math.max(0, Math.round(5000 * (1 - distance / 500)))
  }
}

export default function MapResult({ guessCoords, actualCoords, onNextRound, round, timeout, notes }: MapResultProps) {
  const distance = calculateDistance(guessCoords[0], guessCoords[1], actualCoords[0], actualCoords[1])
  const points = calculatePoints(distance, timeout)
  
  // Initialize score from local storage if available; otherwise start at 0.
  const [score, setScore] = useState(() => Number(localStorage.getItem("score")) || 0)

  // When this component mounts (or when round/points change), update the score only if
  // we have not already processed this round. We use a "processedRound" key in localStorage
  // to keep track.
  useEffect(() => {
    const processedRound = Number(localStorage.getItem("processedRound") || 0)
    if (processedRound < round) {
      const previousScore = Number(localStorage.getItem("score")) || 0
      const newScore = previousScore + points
      setScore(newScore)
      localStorage.setItem("score", newScore.toString())
      localStorage.setItem("processedRound", round.toString())
      
      // If this is the final round, also store the final score.
      if (round === 5) {
        localStorage.setItem("finalScore", newScore.toString())
      }
    }
  }, [round, points])

  const customIcon = new Icon({
    iconUrl: "https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png",
    iconRetinaUrl: "https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon-2x.png",
    shadowUrl: "https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png",
    iconSize: [25, 41],
    iconAnchor: [12, 41],
  })

  const flagIcon = new Icon({
    iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png",
    iconRetinaUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png",
    shadowUrl: "https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png",
    iconSize: [25, 41],
    iconAnchor: [12, 41],
  });

  // Compute bounds so both markers are visible
  const latMin = Math.min(guessCoords[0], actualCoords[0])
  const lngMin = Math.min(guessCoords[1], actualCoords[1])
  const latMax = Math.max(guessCoords[0], actualCoords[0])
  const lngMax = Math.max(guessCoords[1], actualCoords[1])
  const bounds: [[number, number], [number, number]] = [
    [latMin, lngMin],
    [latMax, lngMax],
  ]

  // A guess inside the 5000-point radius counts as "correct".
  const isPerfect = !timeout && points === 5000

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background text-foreground">
      {/* Header bar, matching the gameplay screen */}
      <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-border bg-card px-4 sm:px-6">
        <h1 className="text-xl font-semibold">Round {round} results</h1>
        <span className="text-sm text-muted-foreground tabular-nums">
          Total: {score.toLocaleString()} pts
        </span>
      </header>

      <main className="flex-1 container mx-auto flex flex-col gap-6 px-4 py-6">
        {/* Map and Fun Fact */}
        <div className="flex flex-col gap-4 lg:flex-row">
          <div className="h-[45vh] min-h-[280px] flex-1 overflow-hidden rounded-2xl border border-border shadow-sm lg:h-[60vh]">
            <MapContainer
              bounds={bounds}
              boundsOptions={{ padding: [50, 50] }}
              className="w-full h-full"
            >
              <TileLayer
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              />
              <Marker position={guessCoords} icon={customIcon} />
              <Marker position={actualCoords} icon={flagIcon} />
              <Polyline positions={[guessCoords, actualCoords]} dashArray={[10, 10]} color="#1f1e1b" weight={4} />
            </MapContainer>
          </div>
          {notes && (
            <Card className="rounded-2xl border-border shadow-sm lg:w-72 lg:self-start">
              <CardContent className="max-h-60 space-y-2 overflow-y-auto p-4">
                <h3 className="text-xl font-semibold">Fun fact</h3>
                <p className="whitespace-pre-wrap text-base text-muted-foreground">{notes}</p>
              </CardContent>
            </Card>
          )}
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
            <div className={cn("text-4xl font-bold tracking-tight tabular-nums", isPerfect ? "text-accent-foreground" : "text-primary")}>
              {points.toLocaleString()} points
            </div>
            <div className="w-full">
              <Progress value={(points / 5000) * 100} className={cn("h-2", isPerfect ? "bg-accent" : "bg-secondary")} />
            </div>
            <p className="text-base text-muted-foreground">
              {timeout ? (
                "Time's up!"
              ) : (
                <>
                  Your guess was{" "}
                  <span className="font-semibold text-primary">{distance} yards</span> from the correct location.
                </>
              )}
            </p>
            <p className="text-sm text-muted-foreground tabular-nums">
              Total score: {score.toLocaleString()} points
            </p>

            {/* Next Round Button */}
            <Button
              onClick={onNextRound}
              className="h-12 w-full rounded-lg text-base font-semibold sm:w-auto sm:px-8"
            >
              {round === 5 ? "View results" : "Start next round"}
              <ArrowRight />
            </Button>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
