"use server"

import { AdminAuthError, requireAdmin } from "@/lib/require-admin"
import {
  IMAGES_BUCKET,
  assertNoMetadata,
  fetchImage,
  newImagePath,
  processImage,
} from "@/lib/publish-image"

import type { CandidateRow, CandidateStatus } from "./types"

// Every action re-checks admin itself: server actions are public POST
// endpoints, so the /admin middleware redirect is not a security boundary.
// All writes use the admin's own session (RLS: is_admin()); no service key.

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string }

export type CandidateEdits = {
  name?: string | null
  notes?: string | null
  difficulty?: number | null
  lat?: number
  lng?: number
  status?: CandidateStatus
  review_notes?: string | null
  /** Admin flagged visible signage: stored in ai_scores.has_sign. */
  has_sign?: boolean
}

const CANDIDATE_COLUMNS =
  "id, source, source_id, source_url, image_remote_url, lat, lng, heading, author, license, attribution, captured_at, width, height, title, suggested_name, name, notes, difficulty, status, review_notes, ai_scores, place_id, created_at, updated_at"

function fail(err: unknown): { ok: false; error: string } {
  if (err instanceof AdminAuthError) return { ok: false, error: err.message }
  const message = err instanceof Error ? err.message : String(err)
  console.error("[admin/curate]", message)
  return { ok: false, error: message }
}

function cleanText(v: string | null | undefined, max: number): string | null {
  if (v == null) return null
  const t = v.trim()
  return t ? t.slice(0, max) : null
}

function validateEdits(edits: CandidateEdits): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  if ("name" in edits) patch.name = cleanText(edits.name, 200)
  if ("notes" in edits) patch.notes = cleanText(edits.notes, 2000)
  if ("review_notes" in edits) patch.review_notes = cleanText(edits.review_notes, 2000)
  if ("difficulty" in edits) {
    const d = edits.difficulty
    if (d != null && ![1, 2, 3].includes(d)) throw new Error("difficulty must be 1, 2 or 3")
    patch.difficulty = d ?? null
  }
  if (edits.lat !== undefined || edits.lng !== undefined) {
    const { lat, lng } = edits
    if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      throw new Error("invalid coordinates")
    }
    patch.lat = lat
    patch.lng = lng
  }
  if (edits.status !== undefined) {
    if (!["pending", "approved", "rejected"].includes(edits.status)) throw new Error("invalid status")
    patch.status = edits.status
  }
  return patch
}

async function loadCandidate(supabase: Awaited<ReturnType<typeof requireAdmin>>["supabase"], id: number) {
  const { data, error } = await supabase.from("place_candidates").select(CANDIDATE_COLUMNS).eq("id", id).single()
  if (error || !data) throw new Error(`candidate ${id} not found`)
  return data as CandidateRow
}

async function saveCandidate(
  supabase: Awaited<ReturnType<typeof requireAdmin>>["supabase"],
  current: CandidateRow,
  edits: CandidateEdits,
  extra: Record<string, unknown> = {}
): Promise<CandidateRow> {
  const patch: Record<string, unknown> = { ...validateEdits(edits), ...extra, updated_at: new Date().toISOString() }
  if (edits.has_sign !== undefined) {
    patch.ai_scores = { ...(current.ai_scores ?? {}), has_sign: Boolean(edits.has_sign) }
  }
  const { data, error } = await supabase
    .from("place_candidates")
    .update(patch)
    .eq("id", current.id)
    .select(CANDIDATE_COLUMNS)
    .single()
  if (error || !data) throw new Error(`update failed: ${error?.message ?? "no row"}`)
  return data as CandidateRow
}

export async function updateCandidate(id: number, edits: CandidateEdits): Promise<ActionResult<CandidateRow>> {
  try {
    const { supabase } = await requireAdmin()
    const current = await loadCandidate(supabase, id)
    return { ok: true, data: await saveCandidate(supabase, current, edits) }
  } catch (err) {
    return fail(err)
  }
}

export async function rejectCandidate(id: number, edits: CandidateEdits = {}): Promise<ActionResult<CandidateRow>> {
  try {
    const { supabase } = await requireAdmin()
    const current = await loadCandidate(supabase, id)
    const saved = await saveCandidate(supabase, current, { ...edits, status: "rejected" })
    // A rejected candidate must not stay playable.
    if (saved.place_id != null) {
      const { error } = await supabase.from("places").update({ active: false }).eq("id", saved.place_id)
      if (error) throw new Error(`deactivating place failed: ${error.message}`)
    }
    return { ok: true, data: saved }
  } catch (err) {
    return fail(err)
  }
}

/**
 * Save edits, then (first time) download -> processImage (strip metadata) ->
 * upload `<uuid>.webp` to `images` -> upsert the places row on (source, source_id).
 * Already-published candidates just get their places row updated.
 */
export async function approveAndPublish(id: number, edits: CandidateEdits = {}): Promise<ActionResult<CandidateRow>> {
  try {
    const { supabase } = await requireAdmin()
    let cand = await loadCandidate(supabase, id)
    cand = await saveCandidate(supabase, cand, edits)

    if (cand.difficulty == null) throw new Error("set a difficulty (1-3) before publishing")

    const placeFields = {
      lat: cand.lat,
      lng: cand.lng,
      name: cand.name,
      notes: cand.notes,
      source: cand.source,
      source_id: cand.source_id,
      source_url: cand.source_url,
      author: cand.author,
      license: cand.license,
      attribution: cand.attribution,
      heading: cand.heading,
      difficulty: cand.difficulty,
      active: true,
    }

    let placeId = cand.place_id
    if (placeId == null) {
      // Is it already a place (e.g. published by the script)? Then don't re-upload.
      const { data: existing, error: lookupError } = await supabase
        .from("places")
        .select("id")
        .eq("source", cand.source)
        .eq("source_id", cand.source_id)
        .maybeSingle()
      if (lookupError) throw new Error(`places lookup failed: ${lookupError.message}`)
      placeId = existing?.id ?? null
    }

    if (placeId != null) {
      const { error } = await supabase.from("places").update(placeFields).eq("id", placeId)
      if (error) throw new Error(`places update failed: ${error.message}`)
    } else {
      const url = new URL(cand.image_remote_url)
      if (url.protocol !== "https:") {
        throw new Error("only https images can be published from the UI (use npm run places:publish for own photos)")
      }
      const processed = await processImage(await fetchImage(url.toString(), { retries: 2, timeoutMs: 45_000 }))
      await assertNoMetadata(processed.buffer)

      const imagePath = newImagePath()
      const { error: uploadError } = await supabase.storage.from(IMAGES_BUCKET).upload(imagePath, processed.buffer, {
        contentType: "image/webp",
        upsert: false,
        cacheControl: "31536000",
      })
      if (uploadError) throw new Error(`upload failed: ${uploadError.message}`)

      const { data: place, error: insertError } = await supabase
        .from("places")
        .upsert({ ...placeFields, image_url: imagePath }, { onConflict: "source,source_id" })
        .select("id")
        .single()
      if (insertError || !place) {
        await supabase.storage.from(IMAGES_BUCKET).remove([imagePath])
        throw new Error(`places insert failed: ${insertError?.message ?? "no row"}`)
      }
      placeId = place.id as number
    }

    cand = await saveCandidate(supabase, cand, { status: "approved" }, { place_id: placeId })
    return { ok: true, data: cand }
  } catch (err) {
    return fail(err)
  }
}

/** Take a published place out of (or back into) the game rotation. */
export async function setPlaceActive(placeId: number, active: boolean): Promise<ActionResult<{ placeId: number; active: boolean }>> {
  try {
    const { supabase } = await requireAdmin()
    if (!Number.isInteger(placeId)) throw new Error("invalid place id")
    const { data, error } = await supabase
      .from("places")
      .update({ active: Boolean(active) })
      .eq("id", placeId)
      .select("id, active")
      .single()
    if (error || !data) throw new Error(`update failed: ${error?.message ?? "no row"}`)
    return { ok: true, data: { placeId: data.id as number, active: data.active as boolean } }
  } catch (err) {
    return fail(err)
  }
}
