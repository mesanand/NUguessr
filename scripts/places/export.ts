// Writes data/places.manifest.json — a committed, REPO-ONLY backup of the
// published places (answers included). It lives outside public/ and must never
// be imported or served by the app.
//
// With NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY: dumps
//   select * from places where lat is not null.
// Otherwise: builds it from data/publish/published.json (written by publish.ts),
// filling gaps from data/selected.json.
//
// Run: npm run places:export
import { createClient } from '@supabase/supabase-js'
import { dataPath, readJson, writeJson } from './lib/files'

interface ManifestEntry {
  place_id: number | null
  image_path: string
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
}

type Loose = Record<string, unknown>
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

function normalize(p: Loose, fallback?: Loose): ManifestEntry | null {
  const f = fallback ?? {}
  const pick = (k: string) => (p[k] ?? f[k]) as unknown
  const lat = num(pick('lat'))
  const lng = num(pick('lng'))
  const image_path = str(p.image_path) ?? str(p.image_url) ?? str(f.image_path)
  if (lat == null || lng == null || !image_path) return null
  return {
    place_id: num(p.place_id) ?? num(p.id),
    image_path,
    source: String(pick('source') ?? ''),
    source_id: String(pick('source_id') ?? ''),
    source_url: str(pick('source_url')),
    author: str(pick('author')),
    license: str(pick('license')),
    attribution: str(pick('attribution')),
    name: str(pick('name')),
    notes: str(pick('notes')),
    lat,
    lng,
    heading: num(pick('heading')),
    difficulty: num(pick('difficulty')),
  }
}

async function fromDb(url: string, key: string): Promise<ManifestEntry[]> {
  const sb = createClient(url, key, { auth: { persistSession: false } })
  const { data, error } = await sb.from('places').select('*').not('lat', 'is', null).order('id')
  if (error) throw new Error(`select places failed: ${error.message}`)
  return (data as Loose[]).map((r) => normalize(r)).filter((x): x is ManifestEntry => !!x)
}

function fromFiles(): ManifestEntry[] {
  const published = readJson<Loose[]>(dataPath('publish', 'published.json'), [])
  const selected = readJson<Loose[]>(dataPath('selected.json'), [])
  const sel = new Map(selected.map((s) => [`${s.source}:${s.source_id}`, s]))
  return published.map((p) => normalize(p, sel.get(`${p.source}:${p.source_id}`))).filter((x): x is ManifestEntry => !!x)
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  let entries: ManifestEntry[]
  let origin: string
  if (url && key) {
    entries = await fromDb(url, key)
    origin = `database ${new URL(url).host}`
  } else {
    entries = fromFiles()
    origin = 'data/publish/published.json + data/selected.json (no SUPABASE_SERVICE_ROLE_KEY)'
  }
  if (!entries.length && !process.argv.includes('--force')) {
    console.log(`No published places found in ${origin} — leaving data/places.manifest.json untouched (--force to write an empty one).`)
    return
  }
  entries.sort((a, b) => `${a.source}:${a.source_id}`.localeCompare(`${b.source}:${b.source_id}`))
  const file = dataPath('places.manifest.json')
  writeJson(file, {
    note: 'Repo-only backup of published places (contains answers). Never serve or import this from the app.',
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
