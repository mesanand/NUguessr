"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Check, Loader2, Pencil } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { loadMyName, NAME_MAX, saveMyName } from "@/lib/player"

/**
 * "Put your name on the board": players don't sign in, they just pick a name.
 * Their stats are already recorded against their (anonymous) account by the
 * server; this only sets the name the leaderboard shows.
 */
export function NameOnBoard({ userId }: { userId: string | null }) {
  const [saved, setSaved] = useState<string | null>(null)
  const [draft, setDraft] = useState("")
  const [editing, setEditing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!userId) {
      setLoading(false)
      return
    }
    let cancelled = false
    loadMyName(userId)
      .then((name) => {
        if (cancelled) return
        setSaved(name)
        setDraft(name ?? "")
        setEditing(!name)
      })
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [userId])

  if (!userId) {
    return (
      <p className="rounded-md border border-border bg-card px-4 py-3 text-base text-muted-foreground">
        This game was played as a guest, so it can&apos;t go on the leaderboard.
      </p>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Loading…
      </div>
    )
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!userId || saving) return
    setSaving(true)
    setError(null)
    const problem = await saveMyName(userId, draft)
    setSaving(false)
    if (problem) {
      setError(problem)
      return
    }
    setSaved(draft.trim())
    setEditing(false)
  }

  if (!editing && saved) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-primary/30 bg-secondary p-4">
        <div className="min-w-0">
          <p className="sign-label text-secondary-foreground">On the board as</p>
          <p className="truncate font-display text-2xl font-bold uppercase tracking-wide text-secondary-foreground">
            {saved}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => setEditing(true)}
            className="h-11 rounded-md text-secondary-foreground hover:bg-primary/10"
          >
            <Pencil aria-hidden="true" />
            Change name
          </Button>
          <Button asChild variant="outline" className="h-11 rounded-md">
            <Link href="/leaderboards">See the board</Link>
          </Button>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="rounded-md border border-border bg-card p-4" noValidate>
      <label htmlFor="board-name" className="sign-label">
        Put your name on the board
      </label>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <Input
          id="board-name"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value)
            if (error) setError(null)
          }}
          maxLength={NAME_MAX}
          autoComplete="nickname"
          placeholder="Paws McHusky"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "board-name-error" : undefined}
          className="h-12 rounded-md text-base"
        />
        <Button
          type="submit"
          disabled={saving}
          aria-busy={saving}
          className="h-12 shrink-0 rounded-md px-6 text-base font-semibold"
        >
          {saving ? <Loader2 className="animate-spin" /> : <Check />}
          Save name
        </Button>
      </div>
      {error ? (
        <p id="board-name-error" role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">
          Any name, up to {NAME_MAX} characters. Your best score shows next to it.
        </p>
      )}
    </form>
  )
}
