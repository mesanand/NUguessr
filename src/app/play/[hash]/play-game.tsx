"use client"

import L from "leaflet"
// Fix the default marker icon issue in Leaflet:
delete (L.Icon.Default.prototype as any)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png",
})

import { useState, useEffect, useRef, useMemo } from "react"
import dynamic from "next/dynamic"
import Image from "next/image"
import "@fontsource/titillium-web"
import "leaflet/dist/leaflet.css"
import { createClient } from "@/lib/supabase/client"
import MapResult from "@/components/map-result"
import exifr from "exifr" // EXIF extraction library
import { useParams, useRouter } from "next/navigation"
import Timer from "@/components/timer"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { Map as MapIcon, MapPin, X } from "lucide-react"
import { updateUserStats } from "@/lib/user-stats"

// ---------------------
// Supabase & Image Helpers
// ---------------------
const SUPABASE_PROJECT_ID = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_STORAGE_BUCKET = "images"

const getSupabaseImageUrl = (path: string) => {
  if (!path) return "/placeholder.svg"
  // Absolute URLs and root-relative paths (e.g. "/places/01.jpg", served from
  // /public) are used as-is; anything else is a key in the Supabase bucket.
  if (path.startsWith("/") || /^https?:\/\//.test(path)) return path
  if (!SUPABASE_PROJECT_ID) {
    console.error("Supabase URL is missing!")
    return "/placeholder.svg"
  }
  const baseUrl = SUPABASE_PROJECT_ID.replace(/\/$/, "") // remove trailing slash if any
  return `${baseUrl}/storage/v1/object/public/${SUPABASE_STORAGE_BUCKET}/${path}`
}

// ---------------------
// Dynamically import Leaflet components to avoid SSR issues
// ---------------------
const MapContainer = dynamic(
  () => import("react-leaflet").then((mod) => mod.MapContainer),
  { ssr: false }
)
const TileLayer = dynamic(
  () => import("react-leaflet").then((mod) => mod.TileLayer),
  { ssr: false }
)
const Marker = dynamic(
  () => import("react-leaflet").then((mod) => mod.Marker),
  { ssr: false }
)
const Popup = dynamic(
  () => import("react-leaflet").then((mod) => mod.Popup),
  { ssr: false }
)

import { useMap, useMapEvent } from "react-leaflet"

// ---------------------
// Helper Components for the Map
// ---------------------

// This component ensures that the Leaflet map properly resizes when the container dimensions change.
function MapResizeHandler({ trigger }: { trigger: boolean }) {
  const map = useMap()
  useEffect(() => {
    setTimeout(() => {
      map.invalidateSize()
    }, 300) // allow time for CSS transition to complete
  }, [trigger, map])
  return null
}

// This component listens for map clicks and updates the marker position.
function MapClickHandler({
  setMarkerPosition,
}: {
  setMarkerPosition: (latlng: L.LatLng) => void
}) {
  useMapEvent("click", (e) => {
    setMarkerPosition(e.latlng)
  })
  return null
}

// ---------------------
// Main PlayPage Component
// ---------------------

export default function PlayPage() {
  // IMPORTANT: The dynamic segment key here must match your folder name.
  // For example, if your file is at `/app/play/[id]/page.tsx`, then use "id" below.
  // If it's named [ids], then you must use:
  // const { ids } = useParams();
  const router = useRouter()

  const params = useParams()
  const id = params?.hash

  // Parse the id string into an array of numbers.
  const idArray: number[] = useMemo(() => {
    if (!id) return []
    return (id as string).split("-").map((idStr: string) => Number.parseInt(idStr, 10))
  }, [id])

  // State variables for managing images, current image index, marker position, EXIF data, and view state.
  const [images, setImages] = useState<any[]>([])
  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  const [markerPosition, setMarkerPosition] = useState<L.LatLng | null>(null)
  const [showResult, setShowResult] = useState(false)
  const [exifCoords, setExifCoords] = useState<[number, number] | null>(null)
  const [exifLoading, setExifLoading] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)
  const [timeout, setTimeout] = useState(false)

  // Create a ref for the map container element.
  const mapContainerRef = useRef<HTMLDivElement>(null)

  // Collapse the map if the user clicks or taps outside the map container.
  useEffect(() => {
    function handleOutsideInteraction(event: MouseEvent | TouchEvent) {
      if (
        mapContainerRef.current &&
        !mapContainerRef.current.contains(event.target as Node)
      ) {
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

  // Fetch images from Supabase using the ids provided in the URL.
  const [fetchState, setFetchState] = useState<"loading" | "done" | "error">(
    "loading"
  )
  useEffect(() => {
    async function fetchImages() {
      if (idArray.length === 0) return
      const supabaseClient = createClient()
      const { data, error } = await supabaseClient
        .from("places")
        .select("*")
        .in("id", idArray)
      if (error) {
        console.error("Error fetching images:", error)
        setFetchState("error")
      } else if (data) {
        // Sort the images in the order provided by the URL
        data.sort(
          (a: any, b: any) => idArray.indexOf(a.id) - idArray.indexOf(b.id)
        )
        setImages(data)
        setFetchState("done")
      }
    }
    fetchImages()
  }, [idArray])

  // When images are loaded, start with the first one.
  useEffect(() => {
    if (images.length > 0) {
      setCurrentImageIndex(0)
    }
  }, [images])

  // Extract EXIF data (specifically, the GPS coordinates) from the current image.
  useEffect(() => {
    async function extractExif() {
      if (images.length > 0) {
        setExifLoading(true)
        const image = images[currentImageIndex]
        const imageUrl = getSupabaseImageUrl(image.image_url)
        try {
          // exifr.gps returns an object with latitude and longitude (if available).
          const gpsData = await exifr.gps(imageUrl)
          if (gpsData && gpsData.latitude && gpsData.longitude) {
            setExifCoords([gpsData.latitude, gpsData.longitude])
          } else {
            console.warn("No GPS data found in EXIF for image:", imageUrl)
            setExifCoords(null)
          }
        } catch (err) {
          console.error("Error extracting EXIF data:", err)
          setExifCoords(null)
        }
        setExifLoading(false)
      }
    }
    extractExif()
  }, [images, currentImageIndex])

  // Handler for when the user clicks the "Guess" button.
  const handleGuess = () => {
    if (markerPosition && exifCoords) {
      setIsExpanded(false) // Collapse the map
      setShowResult(true)
    }
  }

  // Handler for moving to the next round.
  const handleNextRound = async () => {
    if (currentImageIndex < images.length - 1) {
      setCurrentImageIndex((prevIndex) => prevIndex + 1)
      setMarkerPosition(null)
      setShowResult(false)
      setTimeout(false)
    } else {
      // All rounds completed. MapResult has already written the accumulated
      // finalScore to localStorage by this point (it does so on the 5th round).
      const finalScore = Number(localStorage.getItem("finalScore") || "0")
      await updateUserStats(finalScore)
      router.push("/play-finish")
    }
  }

  // Handler for moving to the next round on timeout.
  const handleTimeout = () => {
    setTimeout(true)
    setShowResult(true)
    setMarkerPosition(exifCoords ? L.latLng(exifCoords[0], exifCoords[1]) : null)
    setIsExpanded(false) // Collapse the map
  }

  // If the user has made a guess and the current image's EXIF data is available,
  // render the MapResult component.
  if (showResult && markerPosition && exifCoords) {
    const guessCoords: [number, number] = [markerPosition.lat, markerPosition.lng]
    return (
      <MapResult
        guessCoords={guessCoords}
        actualCoords={exifCoords}
        onNextRound={handleNextRound}
        round={currentImageIndex + 1}
        timeout={timeout}
        notes={images[currentImageIndex].notes}
      />
    )
  }

  // Determine whether the Guess button should be enabled.
  const canGuess =
    isExpanded && markerPosition && !exifLoading && exifCoords !== null

  return (
    <div className="h-[100dvh] flex flex-col bg-background text-foreground">
      {/* Header bar: round indicator + timer on one row */}
      <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-border bg-card px-4 sm:px-6">
        <div className="flex items-baseline gap-2">
          <span className="text-sm text-muted-foreground">Round</span>
          <span className="text-xl font-semibold tabular-nums">
            {images.length > 0
              ? `${currentImageIndex + 1} / ${images.length}`
              : "–"}
          </span>
        </div>
        <Timer seconds={45} onComplete={handleTimeout} />
      </header>

      {/* Photo fills the rest of the viewport (bottom padding on mobile
          leaves room for the collapsed "Open map" bar). */}
      <main className="relative flex-1 min-h-0 bg-muted pb-20 sm:pb-0">
        {images.length > 0 ? (
          <div className="relative h-full w-full">
            <Image
              src={
                getSupabaseImageUrl(images[currentImageIndex].image_url) ||
                "/placeholder.svg"
              }
              alt="Campus location"
              fill
              unoptimized
              className="object-contain"
              priority
            />
          </div>
        ) : fetchState === "loading" ? (
          <p className="flex h-full items-center justify-center text-base text-muted-foreground">
            Loading images...
          </p>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <h2 className="text-2xl font-bold">No locations found for this round.</h2>
            <p className="text-sm text-muted-foreground">
              {fetchState === "error"
                ? "Something went wrong loading this round. Try refreshing, or start a new game."
                : "This round's locations haven't been set up yet. Start a new game to try again."}
            </p>
          </div>
        )}
      </main>

      {/* Guess map card. Desktop: compact corner card that expands on
          click/tap. Mobile: collapsed "Open map" bar that expands into a
          full-width bottom sheet. Everything interactive lives inside
          mapContainerRef so the outside-tap collapse listener ignores it. */}
      <div
        ref={mapContainerRef}
        className={cn(
          "fixed z-[1000] flex flex-col overflow-hidden border-border bg-card shadow-md transition-all duration-300",
          "inset-x-0 bottom-0 rounded-t-2xl border-t",
          "sm:inset-x-auto sm:bottom-6 sm:right-6 sm:rounded-2xl sm:border",
          isExpanded
            ? "h-[80dvh] sm:h-[60vh] sm:w-[50vw]"
            : "h-auto sm:h-[200px] sm:w-[300px]"
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
        <div
          className={cn(
            "relative flex-1 min-h-0",
            !isExpanded && "hidden sm:block"
          )}
        >
          <MapContainer
            center={[42.3398, -71.0892]}
            zoom={16}
            className="w-full h-full"
          >
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution="&copy; <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> contributors"
            />
            <MapClickHandler setMarkerPosition={setMarkerPosition} />
            {markerPosition && (
              <Marker position={markerPosition}>
                <Popup>
                  Pin dropped at: {markerPosition.lat.toFixed(4)},{" "}
                  {markerPosition.lng.toFixed(4)}
                </Popup>
              </Marker>
            )}
            <MapResizeHandler trigger={isExpanded} />
          </MapContainer>
          {/* Tap-to-expand overlay: works on mouse AND touch (hover never
              fires on a touchscreen, which is why the map was stuck tiny
              on mobile before). Hidden once expanded so it doesn't
              swallow real pin-drop clicks on the map underneath. */}
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

        {/* Guess Button */}
        {isExpanded && (
          <div className="shrink-0 border-t border-border p-3">
            <Button
              type="button"
              onClick={handleGuess}
              disabled={!canGuess}
              className="h-12 w-full rounded-lg text-base font-semibold"
            >
              <MapPin />
              {exifLoading
                ? "Loading EXIF..."
                : markerPosition
                  ? "Submit guess"
                  : "Tap the map to drop a pin"}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
