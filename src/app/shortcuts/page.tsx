import type { Metadata } from "next"
import { MainNav } from "@/components/main-nav"
import { Kbd, ShortcutList } from "@/components/shortcut-list"

export const metadata: Metadata = {
  title: "Keyboard shortcuts · NUGuessr",
}

export default function ShortcutsPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <MainNav />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:py-12">
        <div className="h-1 w-12 bg-primary" aria-hidden="true" />
        <h1 className="mt-3 text-4xl uppercase sm:text-5xl">Keyboard shortcuts</h1>
        <p className="mt-2 max-w-2xl text-base text-muted-foreground">
          Play the whole game without touching the mouse, except to drop your pin. Press{" "}
          <Kbd>?</Kbd> on any page to bring this list up over what you&apos;re doing.
        </p>
        <div className="mt-8">
          <ShortcutList />
        </div>
      </main>
    </div>
  )
}
