"use client"

// The round photo with tap-to-zoom: tap/click zooms in 2.5x at that spot,
// tap again to zoom out. With a mouse, moving while zoomed pans. Z toggles
// zoom on the centre, Esc zooms out (wired up by the game screen).

import { useCallback, useRef, useState } from "react"
import Image from "next/image"
import { ZoomIn, ZoomOut } from "lucide-react"
import { cn } from "@/lib/utils"

const ZOOM = 2.5

export function useZoom() {
  const [zoomed, setZoomed] = useState(false)
  const [origin, setOrigin] = useState({ x: 50, y: 50 })
  return { zoomed, setZoomed, origin, setOrigin }
}

interface ZoomablePhotoProps {
  src: string
  zoom: ReturnType<typeof useZoom>
}

export function ZoomablePhoto({ src, zoom }: ZoomablePhotoProps) {
  const { zoomed, setZoomed, origin, setOrigin } = zoom
  const boxRef = useRef<HTMLDivElement>(null)

  const pointAt = useCallback((clientX: number, clientY: number) => {
    const box = boxRef.current?.getBoundingClientRect()
    if (!box) return { x: 50, y: 50 }
    const clamp = (v: number) => Math.min(100, Math.max(0, v))
    return {
      x: clamp(((clientX - box.left) / box.width) * 100),
      y: clamp(((clientY - box.top) / box.height) * 100),
    }
  }, [])

  return (
    <div
      ref={boxRef}
      className={cn("relative h-full w-full overflow-hidden", zoomed ? "cursor-zoom-out" : "cursor-zoom-in")}
      onClick={(e) => {
        if (!zoomed) setOrigin(pointAt(e.clientX, e.clientY))
        setZoomed(!zoomed)
      }}
      onMouseMove={(e) => {
        if (zoomed) setOrigin(pointAt(e.clientX, e.clientY))
      }}
    >
      <div
        className="relative h-full w-full transition-transform duration-200 ease-out motion-reduce:transition-none"
        style={{
          transform: zoomed ? `scale(${ZOOM})` : "scale(1)",
          transformOrigin: `${origin.x}% ${origin.y}%`,
        }}
      >
        <Image
          key={src}
          src={src}
          alt="Mystery campus location"
          fill
          unoptimized
          priority
          draggable={false}
          className="select-none object-contain"
        />
      </div>

      {/* Zoom hint / button (keyboard and screen-reader accessible) */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          if (!zoomed) setOrigin({ x: 50, y: 50 })
          setZoomed(!zoomed)
        }}
        aria-pressed={zoomed}
        aria-label={zoomed ? "Zoom photo out" : "Zoom photo in"}
        className="absolute left-3 top-3 z-[600] inline-flex h-11 items-center gap-2 rounded-md bg-ink/75 px-3 text-sm font-medium text-ink-foreground backdrop-blur-sm transition-colors hover:bg-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        {zoomed ? <ZoomOut className="size-4" aria-hidden="true" /> : <ZoomIn className="size-4" aria-hidden="true" />}
        <span className="hidden sm:inline">{zoomed ? "Zoom out" : "Tap photo to zoom"}</span>
        <kbd className="hidden rounded border border-ink-foreground/30 px-1.5 font-mono text-xs sm:inline">Z</kbd>
      </button>
    </div>
  )
}
