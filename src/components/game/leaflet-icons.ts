// Leaflet marker icons. Client-only: import this only from modules that are
// loaded with next/dynamic { ssr: false } (Leaflet touches `window`).
// The PNGs are copied from node_modules/leaflet/dist/images into /public by
// next.config.ts, so nothing is fetched from a third-party CDN.

import L from "leaflet"

// The player's guess: an ink map pin (tip at the exact point).
export const guessIcon = L.divIcon({
  className: "",
  html:
    '<span class="relative block h-9 w-7">' +
    '<span class="absolute left-0 top-0 block size-7 rounded-full rounded-br-none rotate-45 border-2 border-card bg-ink shadow-md"></span>' +
    '<span class="absolute left-[9px] top-[9px] block size-2.5 rounded-full bg-card"></span>' +
    "</span>",
  iconSize: [28, 36],
  iconAnchor: [14, 36],
})

// The true location: a red "station" stop (white ring, red ring), clearly
// different from the ink guess pin.
export const actualIcon = L.divIcon({
  className: "",
  html: '<span class="block size-6 rounded-full border-[4px] border-card bg-primary shadow-md ring-[3px] ring-primary"></span>',
  iconSize: [24, 24],
  iconAnchor: [12, 12],
})

// Default icon for any <Marker> without an explicit icon.
delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl
L.Icon.Default.mergeOptions({
  iconUrl: "/marker-icon.png",
  iconRetinaUrl: "/marker-icon-2x.png",
  shadowUrl: "/marker-shadow.png",
})
