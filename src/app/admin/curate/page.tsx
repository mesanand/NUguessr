import Link from "next/link"
import { redirect } from "next/navigation"

import { checkAdmin } from "@/lib/require-admin"
import { cn } from "@/lib/utils"

import { CurateClient } from "./curate-client"
import { CURATE_FILTERS, PAGE_SIZE, type CandidateRow, type CurateFilter } from "./types"

export const dynamic = "force-dynamic"

const CANDIDATE_COLUMNS =
  "id, source, source_id, source_url, image_remote_url, lat, lng, heading, author, license, attribution, captured_at, width, height, title, suggested_name, name, notes, difficulty, status, review_notes, ai_scores, place_id, created_at, updated_at"

type SearchParams = Promise<{ status?: string; page?: string }>

export default async function CuratePage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const filter: CurateFilter = CURATE_FILTERS.includes(params.status as CurateFilter)
    ? (params.status as CurateFilter)
    : "pending"
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1)

  // Middleware already redirects non-admins away from /admin; enforce here too.
  const admin = await checkAdmin()
  if (!admin.ok) {
    redirect(admin.reason === "unauthenticated" ? `/signin?next=/admin/curate` : "/")
  }
  const { supabase } = admin

  // `published` = has a places row; `approved` = approved but not yet published.
  const filtered = () => {
    const q = supabase.from("place_candidates").select(CANDIDATE_COLUMNS, { count: "exact" })
    if (filter === "published") return q.not("place_id", "is", null)
    if (filter === "approved") return q.eq("status", "approved").is("place_id", null)
    return q.eq("status", filter)
  }
  const from = (page - 1) * PAGE_SIZE
  const [{ data, count, error }, ...counts] = await Promise.all([
    filtered().order("id", { ascending: true }).range(from, from + PAGE_SIZE - 1),
    ...CURATE_FILTERS.map((f) => {
      const q = supabase.from("place_candidates").select("id", { count: "exact", head: true })
      if (f === "published") return q.not("place_id", "is", null)
      if (f === "approved") return q.eq("status", "approved").is("place_id", null)
      return q.eq("status", f)
    }),
  ])
  const candidates = (data ?? []) as CandidateRow[]

  // Active flag of the published places shown on this page.
  const placeIds = candidates.map((c) => c.place_id).filter((id): id is number => id != null)
  const placeActive: Record<number, boolean> = {}
  if (placeIds.length) {
    const { data: places } = await supabase.from("places").select("id, active").in("id", placeIds)
    for (const p of places ?? []) placeActive[p.id as number] = p.active as boolean
  }

  const total = count ?? 0
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-7xl flex-col gap-4 px-4 py-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Curate photos</h1>
          <p className="text-sm text-muted-foreground">
            Keys: <kbd className="rounded border border-border px-1">A</kbd> approve + publish,{" "}
            <kbd className="rounded border border-border px-1">R</kbd> reject,{" "}
            <kbd className="rounded border border-border px-1">S</kbd> skip,{" "}
            <kbd className="rounded border border-border px-1">←</kbd>/<kbd className="rounded border border-border px-1">→</kbd> prev/next
          </p>
        </div>
        <Link href="/admin" className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold text-primary hover:bg-muted">
          ← Admin
        </Link>
      </header>

      <nav aria-label="Filter candidates" className="flex flex-wrap gap-2">
        {CURATE_FILTERS.map((f, i) => (
          <Link
            key={f}
            href={`/admin/curate?status=${f}`}
            aria-current={f === filter ? "page" : undefined}
            className={cn(
              "inline-flex min-h-11 items-center gap-2 rounded-lg border border-border px-4 text-sm font-semibold capitalize transition-colors",
              f === filter ? "bg-primary text-primary-foreground" : "bg-card hover:bg-muted"
            )}
          >
            {f}
            <span className={cn("tabular-nums", f === filter ? "opacity-80" : "text-muted-foreground")}>
              {counts[i]?.count ?? 0}
            </span>
          </Link>
        ))}
      </nav>

      {error ? (
        <p className="rounded-lg border border-border bg-card p-4 text-sm text-destructive">
          Could not load candidates: {error.message}
        </p>
      ) : (
        <CurateClient
          key={`${filter}-${page}`}
          candidates={candidates}
          placeActive={placeActive}
          filter={filter}
          page={page}
          pageCount={pageCount}
          total={total}
        />
      )}
    </main>
  )
}
