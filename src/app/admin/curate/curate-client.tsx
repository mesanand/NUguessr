"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react"
import dynamic from "next/dynamic"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { AlertTriangle, Check, ChevronLeft, ChevronRight, ExternalLink, SkipForward, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

import { approveAndPublish, rejectCandidate, setPlaceActive, updateCandidate, type CandidateEdits } from "./actions"
import { PAGE_SIZE, type AiScores, type CandidateRow, type CurateFilter } from "./types"

const CandidateMap = dynamic(() => import("./candidate-map"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-muted" />,
})

type Props = {
  candidates: CandidateRow[]
  placeActive: Record<number, boolean>
  filter: CurateFilter
  page: number
  pageCount: number
  total: number
}

type Draft = {
  name: string
  notes: string
  difficulty: number | null
  lat: number
  lng: number
  reviewNotes: string
  hasSign: boolean
}

function draftFrom(c: CandidateRow): Draft {
  const ai = c.ai_scores ?? {}
  return {
    name: c.name ?? (typeof ai.name === "string" ? ai.name : ""),
    notes: c.notes ?? (typeof ai.notes === "string" ? ai.notes : ""),
    difficulty: c.difficulty ?? (typeof ai.difficulty === "number" ? ai.difficulty : null),
    lat: c.lat,
    lng: c.lng,
    reviewNotes: c.review_notes ?? "",
    hasSign: ai.has_sign === true,
  }
}

function editsFrom(d: Draft): CandidateEdits {
  return {
    name: d.name,
    notes: d.notes,
    difficulty: d.difficulty,
    lat: d.lat,
    lng: d.lng,
    review_notes: d.reviewNotes,
    has_sign: d.hasSign,
  }
}

/** Commons originals can be 20+ MB; review a 1280 px thumbnail instead. */
function reviewImageUrl(c: CandidateRow): string | null {
  if (!/^https?:/i.test(c.image_remote_url)) return null
  const m = c.image_remote_url.match(/^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/([0-9a-f]\/[0-9a-f]{2})\/([^/?#]+)(?:[?#].*)?$/)
  if (m && (c.width ?? 0) > 1280) {
    const suffix = /\.tiff?$/i.test(m[2]) ? ".jpg" : ""
    return `https://upload.wikimedia.org/wikipedia/commons/thumb/${m[1]}/${m[2]}/1280px-${m[2]}${suffix}`
  }
  return c.image_remote_url
}

function ScoreBadges({ ai, hasSign }: { ai: AiScores | null; hasSign: boolean }) {
  const giveaway = ai?.giveaway === true || hasSign
  const badge = "inline-flex min-h-7 items-center gap-1 rounded-lg border border-border px-2 text-xs font-semibold"
  return (
    <div className="flex flex-wrap gap-2">
      {typeof ai?.quality === "number" && <span className={cn(badge, "bg-card")}>Quality {ai.quality}/5</span>}
      {typeof ai?.recognizable === "number" && <span className={cn(badge, "bg-card")}>Recognizable {ai.recognizable}/5</span>}
      {typeof ai?.difficulty === "number" && <span className={cn(badge, "bg-card")}>AI difficulty {ai.difficulty}</span>}
      {typeof ai?.pin_check === "string" && ai.pin_check !== "ok" && (
        <span className={cn(badge, "bg-secondary text-secondary-foreground")}>Pin {ai.pin_check}</span>
      )}
      {ai?.is_outdoor_campus_scene === false && (
        <span className={cn(badge, "bg-secondary text-secondary-foreground")}>Not an outdoor campus scene</span>
      )}
      {giveaway && (
        <span className={cn(badge, "border-destructive bg-destructive text-destructive-foreground")}>
          <AlertTriangle className="size-3.5" aria-hidden="true" />
          Giveaway{hasSign ? " (has sign)" : ""}
        </span>
      )}
      {!ai && <span className={cn(badge, "text-muted-foreground")}>No AI scores</span>}
    </div>
  )
}

function StatusBadge({ c }: { c: CandidateRow }) {
  const label = c.place_id != null ? "published" : c.status
  return (
    <span
      className={cn(
        "inline-flex min-h-7 items-center rounded-lg px-2 text-xs font-semibold capitalize",
        label === "published" && "bg-primary text-primary-foreground",
        label === "approved" && "bg-accent text-accent-foreground",
        label === "rejected" && "bg-destructive text-destructive-foreground",
        label === "pending" && "bg-muted text-muted-foreground"
      )}
    >
      {label}
    </span>
  )
}

export function CurateClient({ candidates, placeActive, filter, page, pageCount, total }: Props) {
  const router = useRouter()
  const [rows, setRows] = useState(candidates)
  const [active, setActive] = useState(placeActive)
  const [index, setIndex] = useState(0)
  const current = rows[index] as CandidateRow | undefined
  const [draft, setDraft] = useState<Draft | null>(current ? draftFrom(current) : null)
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null)
  const [pending, startTransition] = useTransition()
  const [imgFallback, setImgFallback] = useState(false)
  const busy = useRef(false)

  // Reset the form whenever the selection changes.
  useEffect(() => {
    setDraft(current ? draftFrom(current) : null)
    setImgFallback(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id])

  const go = useCallback(
    (delta: number) => {
      const next = index + delta
      if (next >= 0 && next < rows.length) {
        setIndex(next)
        setMessage(null)
      } else if (next >= rows.length && page < pageCount) {
        router.push(`/admin/curate?status=${filter}&page=${page + 1}`)
      } else if (next < 0 && page > 1) {
        router.push(`/admin/curate?status=${filter}&page=${page - 1}`)
      }
    },
    [index, rows.length, page, pageCount, filter, router]
  )

  const run = useCallback(
    (kind: "approve" | "reject" | "save") => {
      if (!current || !draft || busy.current) return
      busy.current = true
      const edits = editsFrom(draft)
      startTransition(async () => {
        const res =
          kind === "approve"
            ? await approveAndPublish(current.id, edits)
            : kind === "reject"
              ? await rejectCandidate(current.id, edits)
              : await updateCandidate(current.id, edits)
        busy.current = false
        if (!res.ok) {
          setMessage({ kind: "error", text: res.error })
          return
        }
        const updated = res.data
        setRows((rs) => rs.map((r) => (r.id === updated.id ? updated : r)))
        if (updated.place_id != null) {
          const placeId = updated.place_id
          setActive((a) => ({ ...a, [placeId]: kind === "reject" ? false : true }))
        }
        setMessage({
          kind: "ok",
          text: kind === "approve" ? `Published as place #${updated.place_id}` : kind === "reject" ? "Rejected" : "Saved",
        })
        if (kind !== "save") go(1)
      })
    },
    [current, draft, go]
  )

  const togglePlace = useCallback(() => {
    if (!current?.place_id || busy.current) return
    const placeId = current.place_id
    busy.current = true
    startTransition(async () => {
      const res = await setPlaceActive(placeId, !(active[placeId] ?? true))
      busy.current = false
      if (!res.ok) return setMessage({ kind: "error", text: res.error })
      setActive((a) => ({ ...a, [placeId]: res.data.active }))
      setMessage({ kind: "ok", text: res.data.active ? "Place activated" : "Place deactivated" })
    })
  }, [current, active])

  // Keyboard shortcuts (ignored while typing in a field).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return
      const key = e.key.toLowerCase()
      if (key === "a") run("approve")
      else if (key === "r") run("reject")
      else if (key === "s") go(1)
      else if (e.key === "ArrowRight" || e.key === "ArrowDown") go(1)
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") go(-1)
      else return
      e.preventDefault()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [run, go])

  const onMove = useCallback((lat: number, lng: number) => {
    setDraft((d) => (d ? { ...d, lat: Number(lat.toFixed(7)), lng: Number(lng.toFixed(7)) } : d))
  }, [])

  const photo = useMemo(() => (current ? reviewImageUrl(current) : null), [current])

  if (!current || !draft) {
    return (
      <Card className="p-8 text-center text-muted-foreground">
        No {filter} candidates{page > 1 ? " on this page" : ""}.
        {page > 1 && (
          <div className="mt-4">
            <Link className="font-semibold text-primary" href={`/admin/curate?status=${filter}`}>
              Back to page 1
            </Link>
          </div>
        )}
      </Card>
    )
  }

  const moved = draft.lat !== current.lat || draft.lng !== current.lng
  const isActive = current.place_id != null ? active[current.place_id] ?? true : null

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="flex flex-col gap-4">
        <Card className="overflow-hidden">
          <div className="flex aspect-[4/3] max-h-[60vh] w-full items-center justify-center bg-muted">
            {photo ? (
              // Remote review image (Commons/Mapillary); next/image is not configured for these hosts.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={current.id}
                src={imgFallback ? current.image_remote_url : photo}
                onError={() => setImgFallback(true)}
                alt={current.title ?? "Candidate photo"}
                referrerPolicy="no-referrer"
                className="h-full w-full object-contain"
              />
            ) : (
              <p className="p-6 text-sm text-muted-foreground">Local photo; preview not available in the browser.</p>
            )}
          </div>
        </Card>

        <Card className="h-[360px] overflow-hidden">
          <CandidateMap key={current.id} lat={draft.lat} lng={draft.lng} onMove={onMove} />
        </Card>
      </div>

      <Card className="flex flex-col gap-4 p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-muted-foreground tabular-nums">
            {(page - 1) * PAGE_SIZE + index + 1} of {total}
          </span>
          <StatusBadge c={current} />
        </div>

        <div className="space-y-1">
          <h2 className="break-words text-lg font-semibold leading-tight">{current.title ?? current.source_id}</h2>
          {current.suggested_name && (
            <p className="text-sm text-muted-foreground">Suggested: {current.suggested_name}</p>
          )}
          <p className="text-xs text-muted-foreground">
            {current.author ?? "Unknown author"} · {current.license ?? "no license"} · {current.source}
            {current.source_url && /^https?:/i.test(current.source_url) && (
              <>
                {" · "}
                <a href={current.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline">
                  source <ExternalLink className="size-3" aria-hidden="true" />
                </a>
              </>
            )}
          </p>
        </div>

        <ScoreBadges ai={current.ai_scores} hasSign={draft.hasSign} />
        {typeof current.ai_scores?.reason === "string" && (
          <p className="rounded-lg bg-muted p-2 text-xs text-muted-foreground">{current.ai_scores.reason}</p>
        )}

        <label className="space-y-1 text-sm font-semibold">
          <span>Name</span>
          <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder={current.suggested_name ?? "Place name"} />
        </label>

        <label className="space-y-1 text-sm font-semibold">
          <span>Fun fact / notes</span>
          <textarea
            value={draft.notes}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            rows={3}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-base font-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:text-sm"
          />
        </label>

        <fieldset className="space-y-1">
          <legend className="text-sm font-semibold">Difficulty</legend>
          <div className="flex gap-2">
            {[1, 2, 3].map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={draft.difficulty === d}
                onClick={() => setDraft({ ...draft, difficulty: d })}
                className={cn(
                  "min-h-11 flex-1 rounded-lg border border-border text-sm font-semibold",
                  draft.difficulty === d ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"
                )}
              >
                {d === 1 ? "1 Easy" : d === 2 ? "2 Medium" : "3 Hard"}
              </button>
            ))}
          </div>
        </fieldset>

        <label className="flex min-h-11 items-center gap-3 text-sm font-semibold">
          <input
            type="checkbox"
            checked={draft.hasSign}
            onChange={(e) => setDraft({ ...draft, hasSign: e.target.checked })}
            className="size-5 accent-primary"
          />
          Has a sign / text that gives it away
        </label>

        <div className="text-xs text-muted-foreground tabular-nums">
          Pin: {draft.lat.toFixed(6)}, {draft.lng.toFixed(6)}
          {moved && (
            <>
              {" "}(moved){" "}
              <button type="button" className="font-semibold text-primary" onClick={() => setDraft({ ...draft, lat: current.lat, lng: current.lng })}>
                reset
              </button>
            </>
          )}
        </div>

        <label className="space-y-1 text-sm font-semibold">
          <span>Review notes (internal)</span>
          <Input value={draft.reviewNotes} onChange={(e) => setDraft({ ...draft, reviewNotes: e.target.value })} />
        </label>

        {message && (
          <p
            role="status"
            className={cn(
              "rounded-lg p-2 text-sm",
              message.kind === "error" ? "bg-destructive text-destructive-foreground" : "bg-muted text-foreground"
            )}
          >
            {message.text}
          </p>
        )}

        <p className="text-xs text-muted-foreground">
          {current.place_id != null
            ? "Update place only changes name, notes, difficulty and pin; the published photo and credit stay as they are. "
            : "Publishing here uses the photo as-is (no crop or blur). "}
          Photos with signs need cropping via the script pipeline.
        </p>

        <div className="grid grid-cols-2 gap-2">
          <Button onClick={() => run("approve")} disabled={pending}>
            <Check aria-hidden="true" />
            {current.place_id != null ? "Update place" : "Approve + publish"}
          </Button>
          <Button variant="destructive" onClick={() => run("reject")} disabled={pending}>
            <X aria-hidden="true" />
            Reject
          </Button>
          <Button variant="outline" onClick={() => run("save")} disabled={pending}>
            Save
          </Button>
          <Button variant="outline" onClick={() => go(1)} disabled={pending}>
            <SkipForward aria-hidden="true" />
            Skip
          </Button>
        </div>

        {current.place_id != null && (
          <Button variant="secondary" onClick={togglePlace} disabled={pending}>
            Place #{current.place_id} is {isActive ? "active" : "inactive"}: {isActive ? "deactivate" : "activate"}
          </Button>
        )}

        <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
          <Button variant="ghost" size="icon" onClick={() => go(-1)} aria-label="Previous candidate" disabled={pending}>
            <ChevronLeft />
          </Button>
          <span className="text-sm text-muted-foreground tabular-nums">
            Page {page} / {pageCount}
          </span>
          <Button variant="ghost" size="icon" onClick={() => go(1)} aria-label="Next candidate" disabled={pending}>
            <ChevronRight />
          </Button>
        </div>
      </Card>
    </div>
  )
}
