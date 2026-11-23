/**
 * places:select - turn curation decisions into the final publish list.
 *
 * Reads data/candidates.json + data/curation/batch-*.json (CurationDecision[])
 * and writes data/selected.json for places:publish.
 *
 * Rules:
 *  - only `approve` decisions that satisfy the approval thresholds
 *  - community photos may be indoors (is_outdoor_campus_scene is not required)
 *  - at most one place per ~25 m cluster (keeps the best-scored photo); an
 *    indoor shot and an outdoor shot at the same spot are different views,
 *    and so are indoor shots with different names (two rooms in one building)
 *  - per-area caps so no single spot dominates (Ruggles, ISEC, ...)
 *  - stops at --target (default 60)
 *
 *   npx tsx scripts/places/select.ts [--target 60] [--cluster-m 25]
 */
import fs from "node:fs"
import path from "node:path"
import type { Candidate, CurationDecision } from "./lib/types"

const DATA = path.resolve("data")
const arg = (name: string, def: number) => {
  const i = process.argv.indexOf(name)
  return i > -1 ? Number(process.argv[i + 1]) : def
}
const TARGET = arg("--target", 60)
const CLUSTER_M = arg("--cluster-m", 25)

// Area caps, matched against the curated display name (first match wins).
const AREA_CAPS: { area: string; match: RegExp; cap: number }[] = [
  { area: "Ruggles", match: /ruggles/i, cap: 6 },
  { area: "ISEC", match: /\bisec\b|snell engineering|lightview/i, cap: 6 },
  { area: "West Village", match: /west village/i, cap: 5 },
  { area: "Huntington Ave / Northeastern station", match: /huntington|northeastern station/i, cap: 3 },
  { area: "Museum of Fine Arts", match: /fine arts/i, cap: 2 },
]
const DEFAULT_CAP = 3

type Rect = { left: number; top: number; width: number; height: number }
type Decision = CurationDecision & { crop?: Rect | null; redact?: Rect[] | null }

const key = (x: { source: string; source_id: string }) => `${x.source}:${x.source_id}`

function meters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000
  const r = Math.PI / 180
  const dLat = (b.lat - a.lat) * r
  const dLng = (b.lng - a.lng) * r
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** CC licenses require indicating changes: "CC BY-SA 4.0 (cropped, text blurred)". */
function editNote(license: string, d: Decision): string {
  const edits = [d.crop ? "cropped" : null, d.redact?.length ? "text blurred" : null].filter(Boolean)
  return edits.length ? `${license} (${edits.join(", ")})` : license
}

/**
 * Commons originals are often 10+ MB; a standard thumbnail (1920 px wide for
 * landscape, 1280 px wide for portrait) is plenty for a 2000 px-max game photo
 * and kinder to Wikimedia. Commons refuses to upscale, so the thumbnail is used
 * only when the original is WIDER than the requested thumbnail width.
 */
function publishUrl(c: Candidate): string {
  if (c.source !== "wikimedia" || !c.thumb_url || !/\/960px-/.test(c.thumb_url)) return c.image_remote_url
  const thumbWidth = c.width >= c.height ? 1920 : 1280
  return c.width > thumbWidth ? c.thumb_url.replace(/\/960px-/, `/${thumbWidth}px-`) : c.image_remote_url
}

const normName =(n: string | null) => (n ?? "").toLowerCase().replace(/[^a-z]/g, "")

function areaOf(name: string | null) {
  const n = name ?? ""
  return AREA_CAPS.find((a) => a.match.test(n)) ?? { area: n || "unnamed", cap: DEFAULT_CAP }
}

function main() {
  const candidates: Candidate[] = JSON.parse(fs.readFileSync(path.join(DATA, "candidates.json"), "utf8"))
  const byKey = new Map(candidates.map((c) => [key(c), c]))

  const curationDir = path.join(DATA, "curation")
  const decisions = new Map<string, Decision>()
  // batch-* = first pass; rescue-* = second pass that crops name signs out of
  // otherwise-good photos. Sorted so a rescue decision overrides the first pass.
  const files = fs.readdirSync(curationDir).filter((f) => /^(batch|rescue|review)-\d+\.json$/.test(f))
  // batch < rescue < review (orchestrator/admin overrides last)
  const rank = (f: string) => (f.startsWith("batch") ? 0 : f.startsWith("rescue") ? 1 : 2)
  files.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
  for (const f of files) {
    for (const d of JSON.parse(fs.readFileSync(path.join(curationDir, f), "utf8")) as Decision[]) {
      decisions.set(key(d), d)
    }
  }

  const approved = [...decisions.values()].filter(
    (d) =>
      d.decision === "approve" &&
      (d.is_outdoor_campus_scene || d.source === "community") &&
      d.quality >= 3 &&
      !d.giveaway &&
      d.recognizable >= 2 &&
      d.pin_check === "ok" &&
      byKey.has(key(d))
  )

  // Best first: recognizable + quality, slight preference for easier rounds.
  const score = (d: Decision) => d.recognizable * 2 + d.quality - (d.difficulty === 3 ? 0.5 : 0)
  approved.sort((a, b) => score(b) - score(a))

  const picked: Decision[] = []
  const isIndoor = (d: Decision) => byKey.get(key(d))?.submission?.indoor === true
  const perArea = new Map<string, number>()
  const perName = new Map<string, number>()
  const skipped: string[] = []
  for (const d of approved) {
    if (picked.length >= TARGET) break
    // Same view = very close (<10 m) or close (<CLUSTER_M) with the same place name.
    const near = picked.find((p) => {
      const m = meters(p, d)
      const sameName = normName(p.name) === normName(d.name)
      if (isIndoor(p) !== isIndoor(d)) return false // inside vs outside: never the same view
      if (isIndoor(d)) return m < CLUSTER_M && sameName // two rooms in one building are different views
      return m < 10 || (m < CLUSTER_M && sameName)
    })
    if (near) {
      skipped.push(`${d.source_id} (${d.name}) within ${CLUSTER_M} m of ${near.source_id}`)
      continue
    }
    const { area, cap } = areaOf(d.name)
    if ((perArea.get(area) ?? 0) >= cap) {
      skipped.push(`${d.source_id} (${d.name}) area cap ${area}=${cap}`)
      continue
    }
    // Max 2 photos with the same place name (e.g. four ISEC facades is repetitive).
    if ((perName.get(normName(d.name)) ?? 0) >= 2) {
      skipped.push(`${d.source_id} (${d.name}) name cap 2`)
      continue
    }
    perName.set(normName(d.name), (perName.get(normName(d.name)) ?? 0) + 1)
    perArea.set(area, (perArea.get(area) ?? 0) + 1)
    picked.push(d)
  }

  const selected = picked.map((d) => {
    const c = byKey.get(key(d))!
    return {
      source: c.source,
      source_id: c.source_id,
      // own photos point at a local file; never expose that path as a public link
      source_url: c.source === "own" || c.source === "community" ? null : c.source_url,
      image_remote_url: publishUrl(c),
      author: c.author,
      // CC licenses require indicating changes; cropped photos say so in the credit.
      license: editNote(c.license, d),
      attribution: c.attribution,
      name: d.name,
      notes: d.notes,
      difficulty: d.difficulty,
      lat: d.lat,
      lng: d.lng,
      heading: c.heading,
      crop: d.crop ?? null,
      redact: d.redact?.length ? d.redact : null,
    }
  })

  fs.writeFileSync(path.join(DATA, "selected.json"), JSON.stringify(selected, null, 2))
  console.log(`approved ${approved.length} -> selected ${selected.length} (target ${TARGET})`)
  console.log("per area:", Object.fromEntries(perArea))
  const diff = selected.reduce<Record<number, number>>((m, s) => ((m[s.difficulty] = (m[s.difficulty] ?? 0) + 1), m), {})
  console.log("difficulty:", diff)
  if (skipped.length) console.log(`skipped ${skipped.length}:\n  ` + skipped.join("\n  "))
}

main()
