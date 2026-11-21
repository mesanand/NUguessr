"use client"

// Label-free campus basemap for the guess map, drawn from
// public/map/campus-basemap.json (OSM geometry with no names or tags; built
// by scripts/places/build-basemap.ts). Hosted raster "no labels" tiles either
// need an API key or still print street names, so we draw it ourselves.
// Leaflet renders on canvas, so colors must be literal values here — they
// mirror the sand/mint tokens in globals.css.

import { useEffect, useState } from "react"
import type { FeatureCollection } from "geojson"
import type { PathOptions } from "leaflet"
import { GeoJSON } from "react-leaflet"

export const BASEMAP_BACKGROUND = "#efeee9"

const STYLES: Record<string, PathOptions> = {
  green: { stroke: false, fillColor: "#d6e8cf", fillOpacity: 1 },
  pitch: { stroke: false, fillColor: "#c5e1bb", fillOpacity: 1 },
  water: { stroke: false, fillColor: "#b8d6e8", fillOpacity: 1 },
  major: { color: "#ffffff", weight: 7, lineCap: "round", lineJoin: "round" },
  minor: { color: "#ffffff", weight: 4, lineCap: "round", lineJoin: "round" },
  path: { color: "#b7b2a8", weight: 1.2, dashArray: "3 3" },
  rail: { color: "#9e9a93", weight: 2, dashArray: "6 4" },
  building: { color: "#bdb9b1", weight: 0.8, fillColor: "#d9d6cf", fillOpacity: 1 },
}

const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'

// One fetch per page load, shared by every round's map.
let cache: Promise<FeatureCollection> | null = null
function loadBasemap(): Promise<FeatureCollection> {
  cache ??= fetch("/map/campus-basemap.json").then((r) => {
    if (!r.ok) throw new Error(`basemap HTTP ${r.status}`)
    return r.json() as Promise<FeatureCollection>
  })
  cache.catch(() => {
    cache = null
  })
  return cache
}

export default function CampusBasemap() {
  const [data, setData] = useState<FeatureCollection | null>(null)

  useEffect(() => {
    let alive = true
    loadBasemap()
      .then((d) => alive && setData(d))
      .catch((e) => console.error("Failed to load campus basemap", e))
    return () => {
      alive = false
    }
  }, [])

  if (!data) return null
  return (
    <GeoJSON
      data={data}
      interactive={false}
      attribution={ATTRIBUTION}
      style={(f) => STYLES[(f?.properties as { k?: string } | undefined)?.k ?? ""] ?? STYLES.path}
    />
  )
}
