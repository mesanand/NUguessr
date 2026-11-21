"use client"

// Guess map card. Desktop: compact corner card that expands on click/tap.
// Mobile: collapsed "Open map" bar that expands into a full-width bottom
// sheet. Client-only (Leaflet) — load via next/dynamic { ssr: false }.

import { useEffect, useRef, useState } from "react"
import type { LatLng as LeafletLatLng } from "leaflet"
import { MapContainer, Marker, TileLayer, useMap, useMapEvent } from "react-leaflet"
import "leaflet/dist/leaflet.css"
import { Layers, Loader2, Map as MapIcon, MapPin, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  CAMPUS_CENTER,
  CAMPUS_MAX_ZOOM,
  CAMPUS_MIN_ZOOM,
  CAMPUS_ZOOM,
  paddedBounds,
} from "@/lib/campus"
import type { LatLng } from "@/lib/game-types"
import { guessIcon } from "./leaflet-icons"

const OSM_CARTO_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'

const BASE_LAYERS = {
  map: {
    url: "https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png",
    attribution: OSM_CARTO_ATTRIBUTION,
    subdomains: "abcd",
    maxNativeZoom: 20,
  },
  satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution:
      "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    subdomains: "",
    maxNativeZoom: 19,
  },
} as const

type BaseLayer = keyof typeof BASE_LAYERS

const MAX_BOUNDS = paddedBounds()

// Re-measures the map after the card's CSS size transition.
function MapResizeHandler({ trigger }: { trigger: boolean }) {
  const map = useMap()
  useEffect(() => {
    const id = window.setTimeout(() => map.invalidateSize(), 300)
    return () => window.clearTimeout(id)
  }, [trigger, map])
  return null
}

function MapClickHandler({ onClick }: { onClick: (latlng: LeafletLatLng) => void }) {
  useMapEvent("click", (e) => onClick(e.latlng))
  return null
}

interface GuessMapProps {
  /** Called with the pin position when the player presses "Submit guess". */
  onSubmit: (guess: LatLng) => void
  /** A submission is in flight: the submit button is disabled. */
  submitting: boolean
}

export default function GuessMap({ onSubmit, submitting }: GuessMapProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [marker, setMarker] = useState<LatLng | null>(null)
  const [baseLayer, setBaseLayer] = useState<BaseLayer>("map")
  const containerRef = useRef<HTMLDivElement>(null)

  // Collapse the map if the user clicks or taps outside the map card.
  useEffect(() => {
    function handleOutsideInteraction(event: MouseEvent | TouchEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsExpanded(false)
      }
    }
    document.addEventListener("mousedown", handleOutsideInteraction)
    document.addEventListener("touchstart", handleOutsideInteraction)
    return () => {
      document.removeEventListener("mousedown", handleOutsideInteraction)
      document.removeEventListener("touchstart", handleOutsideInteraction)
    }
  }, [])

  const layer = BASE_LAYERS[baseLayer]
  const canGuess = isExpanded && marker !== null && !submitting

  const handleSubmit = () => {
    if (!marker || submitting) return
    onSubmit(marker)
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        "fixed z-[1000] flex flex-col overflow-hidden border-border bg-card shadow-md transition-all duration-300",
        "inset-x-0 bottom-0 rounded-t-2xl border-t",
        "sm:inset-x-auto sm:bottom-6 sm:right-6 sm:rounded-2xl sm:border",
        isExpanded ? "h-[80dvh] sm:h-[60vh] sm:w-[50vw]" : "h-auto sm:h-[200px] sm:w-[300px]"
      )}
    >
      {isExpanded && (
        <div className="shrink-0 border-b border-border">
          {/* Drag handle (mobile bottom sheet affordance) */}
          <div className="flex justify-center pt-2 sm:hidden" aria-hidden="true">
            <div className="h-1.5 w-12 rounded-full bg-border" />
          </div>
          <div className="flex items-center justify-between gap-2 py-1 pl-4 pr-1">
            <h3 className="text-base font-semibold">Drop a pin on your guess</h3>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Close map"
              onClick={() => setIsExpanded(false)}
              className="h-11 w-11 rounded-lg"
            >
              <X />
            </Button>
          </div>
        </div>
      )}

      {/* Map (hidden on mobile while collapsed; MapResizeHandler
          re-measures it once expanded) */}
      <div className={cn("relative flex-1 min-h-0", !isExpanded && "hidden sm:block")}>
        <MapContainer
          center={CAMPUS_CENTER}
          zoom={CAMPUS_ZOOM}
          minZoom={CAMPUS_MIN_ZOOM}
          maxZoom={CAMPUS_MAX_ZOOM}
          maxBounds={MAX_BOUNDS}
          maxBoundsViscosity={1}
          className="h-full w-full"
        >
          <TileLayer
            key={baseLayer}
            url={layer.url}
            attribution={layer.attribution}
            subdomains={layer.subdomains || "abc"}
            maxNativeZoom={layer.maxNativeZoom}
            maxZoom={CAMPUS_MAX_ZOOM}
          />
          <MapClickHandler onClick={(ll) => setMarker({ lat: ll.lat, lng: ll.lng })} />
          {marker && <Marker position={[marker.lat, marker.lng]} icon={guessIcon} />}
          <MapResizeHandler trigger={isExpanded} />
        </MapContainer>

        {/* Map / Satellite toggle (sibling of the map, so pressing it never
            drops a pin). Shown once expanded; the collapsed card is one big
            expand button. */}
        {isExpanded && (
          <button
            type="button"
            onClick={() => setBaseLayer((l) => (l === "map" ? "satellite" : "map"))}
            aria-label={baseLayer === "map" ? "Switch to satellite view" : "Switch to map view"}
            className="absolute right-3 top-3 z-[1000] inline-flex h-11 min-w-11 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-medium text-card-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Layers className="size-4" aria-hidden="true" />
            {baseLayer === "map" ? "Satellite" : "Map"}
          </button>
        )}

        {/* Tap-to-expand overlay: works on mouse AND touch (never hover-only).
            Hidden once expanded so it doesn't swallow pin-drop clicks. */}
        {!isExpanded && (
          <button
            type="button"
            aria-label="Expand map to place your guess"
            onClick={() => setIsExpanded(true)}
            className="absolute inset-0 z-[500] flex items-end justify-center bg-foreground/5 p-3 transition-colors hover:bg-foreground/10 active:bg-foreground/15"
          >
            <span className="inline-flex h-11 items-center gap-2 rounded-lg bg-card px-4 text-sm font-medium text-card-foreground shadow-sm">
              <MapIcon className="size-4" />
              Click to place your guess
            </span>
          </button>
        )}
      </div>

      {/* Mobile collapsed state: clear 44px+ "Open map" control */}
      {!isExpanded && (
        <div className="p-3 sm:hidden">
          <Button
            type="button"
            onClick={() => setIsExpanded(true)}
            className="h-12 w-full rounded-lg text-base font-semibold"
          >
            <MapIcon />
            Open map
          </Button>
        </div>
      )}

      {isExpanded && (
        <div className="shrink-0 border-t border-border p-3">
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={!canGuess}
            aria-busy={submitting}
            className="h-12 w-full rounded-lg text-base font-semibold"
          >
            {submitting ? <Loader2 className="animate-spin" /> : <MapPin />}
            {submitting ? "Submitting..." : marker ? "Submit guess" : "Tap the map to drop a pin"}
          </Button>
        </div>
      )}
    </div>
  )
}
