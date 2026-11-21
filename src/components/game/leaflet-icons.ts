// Leaflet marker icons. Client-only: import this only from modules that are
// loaded with next/dynamic { ssr: false } (Leaflet touches `window`).
// The PNGs are copied from node_modules/leaflet/dist/images into /public by
// next.config.ts, so nothing is fetched from a third-party CDN.

import L from "leaflet"

export const guessIcon = new L.Icon({
  iconUrl: "/marker-icon.png",
  iconRetinaUrl: "/marker-icon-2x.png",
  shadowUrl: "/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
})

// The true location: a token-coloured dot with a ring, clearly different
// from the blue guess pin.
export const actualIcon = L.divIcon({
  className: "",
  html: '<span class="block size-6 rounded-full border-[3px] border-card bg-primary shadow-md ring-2 ring-primary"></span>',
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
