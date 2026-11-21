"use client"

// Loaded only via next/dynamic({ ssr: false }) from curate-client.tsx:
// Leaflet touches `window` at import time and crashes SSR.

import { useMemo, useState } from "react"
import { Icon, type LeafletEventHandlerFnMap, type Marker as LeafletMarker } from "leaflet"
import { MapContainer, Marker, TileLayer, useMapEvents } from "react-leaflet"
import "leaflet/dist/leaflet.css"

import { cn } from "@/lib/utils"

const pinIcon = new Icon({
  iconUrl: "/marker-icon.png",
  iconRetinaUrl: "/marker-icon-2x.png",
  shadowUrl: "/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
})

const LAYERS = {
  map: {
    // Labeled tiles: admins are allowed to see street/building names.
    url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    maxNativeZoom: 20,
  },
  satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    maxNativeZoom: 19,
  },
} as const

type Props = {
  lat: number
  lng: number
  onMove: (lat: number, lng: number) => void
}

function ClickToMove({ onMove }: { onMove: Props["onMove"] }) {
  useMapEvents({ click: (e) => onMove(e.latlng.lat, e.latlng.lng) })
  return null
}

export default function CandidateMap({ lat, lng, onMove }: Props) {
  const [layer, setLayer] = useState<keyof typeof LAYERS>("map")
  const tiles = LAYERS[layer]

  const handlers = useMemo<LeafletEventHandlerFnMap>(
    () => ({
      dragend(e) {
        const p = (e.target as LeafletMarker).getLatLng()
        onMove(p.lat, p.lng)
      },
    }),
    [onMove]
  )

  return (
    <div className="relative h-full w-full">
      <MapContainer center={[lat, lng]} zoom={18} maxZoom={21} className="h-full w-full" scrollWheelZoom>
        <TileLayer key={layer} url={tiles.url} attribution={tiles.attribution} maxNativeZoom={tiles.maxNativeZoom} maxZoom={21} />
        <Marker position={[lat, lng]} icon={pinIcon} draggable eventHandlers={handlers} />
        <ClickToMove onMove={onMove} />
      </MapContainer>
      <div className="absolute right-2 top-2 z-[1000] flex overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        {(Object.keys(LAYERS) as Array<keyof typeof LAYERS>).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setLayer(key)}
            aria-pressed={layer === key}
            className={cn(
              "min-h-11 px-3 text-sm font-semibold capitalize",
              layer === key ? "bg-primary text-primary-foreground" : "hover:bg-muted"
            )}
          >
            {key}
          </button>
        ))}
      </div>
    </div>
  )
}
