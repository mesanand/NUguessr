"use client"

import dynamic from "next/dynamic"

// The game screen uses Leaflet, which touches `window` as soon as it is
// imported. Load it client-only so the server render doesn't crash with
// "ReferenceError: window is not defined" (which made /play/[hash] a 500).
const PlayGame = dynamic(() => import("./play-game"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[100dvh] flex-col bg-background text-foreground">
      <header className="flex h-16 shrink-0 items-center border-b border-border bg-card px-4 sm:px-6">
        <span className="text-sm text-muted-foreground">Round</span>
      </header>
      <main className="flex flex-1 items-center justify-center bg-muted">
        <p className="text-base text-muted-foreground">Loading game...</p>
      </main>
    </div>
  ),
})

export default function PlayPage() {
  return <PlayGame />
}
