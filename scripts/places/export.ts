// Writes data/places.manifest.json — a committed, REPO-ONLY backup of the
// curated places. It lives outside public/ and must never be imported or
// served by the app.
//
// The repo is public, so the manifest must NOT be an answer key: it contains
// NO image_path / image_url / file names / place ids — nothing that maps the
// served `<uuid>.webp` objects to their answers. Every field it does keep
// (source, source_id, source_url, author, license, attribution, name, notes,
// lat, lng, heading, difficulty, crop, redact) is either public Commons /
// Mapillary metadata or our curation of it, so it can't be used to look up the
// answer for a round's image. To rebuild after a loss: copy the places into
// data/selected.json and re-run places:publish (new UUIDs are generated).
//
// With SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY:
//   dumps the places rows (lat not null), crop/redact filled from
//   data/publish/published.json / data/selected.json.
// Otherwise: builds it from data/publish/published.json (written by publish.ts),
// filling gaps from data/selected.json.
//
// Run: npx tsx scripts/places/export.ts [--force]
import { createClient } from '@supabase/supabase-js'
import { dataPath, readJson, writeJson } from './lib/files'

type Rect = { left: number; top: number; width: number; height: number }

interface ManifestEntry {
  source: string
  source_id: string
  source_url: string | null
  author: string | null
  license: string | null
  attribution: string | null
  name: string | null
  notes: string | null
  lat: number
  lng: number
  heading: number | null
  difficulty: number | null
  crop: Rect | null
  redact: Rect[] | null
}

type Loose = Record<string, unknown>
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

function rect(v: unknown): Rect | null {
  if (!v || typeof v !== 'object') return null
  const r = v as Loose
  const [left, top, width, height] = [r.left, r.top, r.width, r.height].map(num)
  return left == null || top == null || width == null || height == null ? null : { left, top, width, height }
}

function normalize(p: Loose, fallback?: Loose): ManifestEntry | null {
  const f = fallback ?? {}
  const pick = (k: string) => (p[k] ?? f[k]) as unknown
  const lat = num(pick('lat'))
  const lng = num(pick('lng'))
  if (lat == null || lng == null) return null
  const source = String(pick('source') ?? '')
  const redact = Array.isArray(pick('redact')) ? (pick('redact') as unknown[]).map(rect).filter((x): x is Rect => !!x) : []
  // Explicit allowlist of fields: image_path / image_url / id never get copied.
  return {
    source,
    source_id: String(pick('source_id') ?? ''),
    // own photos point at a local file; never record that path
    source_url: source === 'own' ? null : str(pick('source_url')),
    author: str(pick('author')),
    license: str(pick('license')),
    attribution: str(pick('attribution')),
    name: str(pick('name')),
    notes: str(pick('notes')),
    lat,
    lng,
    heading: num(pick('heading')),
    difficulty: num(pick('difficulty')),
    crop: rect(pick('crop')),
    redact: redact.length ? redact : null,
  }
}

/** crop/redact live only in the local pipeline files, keyed by source:source_id. */
function localEdits(): Map<string, Loose> {
  const published = readJson<Loose[]>(dataPath('publish', 'published.json'), [])
  const selected = readJson<Loose[]>(dataPath('selected.json'), [])
  const m = new Map<string, Loose>()
  for (const r of [...published, ...selected]) m.set(`${r.source}:${r.source_id}`, { crop: r.crop ?? null, redact: r.redact ?? null })
  return m
}

async function fromDb(url: string, key: string): Promise<ManifestEntry[]> {
  const sb = createClient(url, key, { auth: { persistSession: false } })
  const { data, error } = await sb
    .from('places')
    .select('source, source_id, source_url, author, license, attribution, name, notes, lat, lng, heading, difficulty')
    .not('lat', 'is', null)
    .not('source', 'is', null)
    .order('id')
  if (error) throw new Error(`select places failed: ${error.message}`)
  const edits = localEdits()
  return (data as Loose[])
    .map((r) => normalize(r, edits.get(`${r.source}:${r.source_id}`)))
    .filter((x): x is ManifestEntry => !!x)
}

function fromFiles(): ManifestEntry[] {
  const published = readJson<Loose[]>(dataPath('publish', 'published.json'), [])
  const selected = readJson<Loose[]>(dataPath('selected.json'), [])
  const sel = new Map(selected.map((s) => [`${s.source}:${s.source_id}`, s]))
  return published.map((p) => normalize(p, sel.get(`${p.source}:${p.source_id}`))).filter((x): x is ManifestEntry => !!x)
}

async function main() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  let entries: ManifestEntry[]
  let origin: string
  if (url && key) {
    entries = await fromDb(url, key)
    origin = 'places table'
  } else {
    entries = fromFiles()
    origin = 'data/publish/published.json + data/selected.json'
  }
  if (!entries.length && !process.argv.includes('--force')) {
    console.log(`No published places found in ${origin} — leaving data/places.manifest.json untouched (--force to write an empty one).`)
    return
  }
  entries.sort((a, b) => `${a.source}:${a.source_id}`.localeCompare(`${b.source}:${b.source_id}`))
  const file = dataPath('places.manifest.json')
  writeJson(file, {
    note:
      'Repo-only backup of curated places. Deliberately has NO image paths/file names, so it cannot map served images to answers. Never serve or import this from the app.',
    generated_at: new Date().toISOString(),
    origin,
    count: entries.length,
    places: entries,
  })
  console.log(`wrote ${entries.length} places to ${file} from ${origin}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
