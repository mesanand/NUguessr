// Gathers geotagged, freely licensed Wikimedia Commons photos on campus.
//
//  1. list=geosearch (namespace 6) on a grid of centers covering CAMPUS_BOUNDS;
//     any center that hits the 500 cap is split into 4 smaller circles.
//  2. prop=imageinfo|coordinates in batches of 50 pageids (cached in
//     data/commons/info.json â€” rerun with --refresh to refetch).
//  3. Filters: free license, raster photo mime, width >= 1000, on campus
//     (lib/campus-filter.ts), not a map/logo/scan/portrait/interior/historic.
//  4. Thins same-author bursts (<15 m, same day), merges into
//     data/candidates.json (keyed source+source_id), downloads thumbnails.
//
// Run: npm run places:fetch:commons [-- --refresh] [-- --no-thumbs]
import { fetchJson } from './lib/http'
import { dataPath, readCandidates, readJson, replaceSource, writeCandidates, writeJson } from './lib/files'
import { CAMPUS_BOUNDS, inCampusBounds, onCampus } from './lib/campus-filter'
import { cellId, haversineM } from './lib/geo'
import { downloadThumbs } from './lib/thumbs'
import type { Candidate } from './lib/types'

const API = 'https://commons.wikimedia.org/w/api.php'
const HITS_FILE = dataPath('commons', 'geosearch.json')
const INFO_FILE = dataPath('commons', 'info.json')
const REPORT_FILE = dataPath('commons', 'report.json')
const GS_LIMIT = 500

interface GeoHit {
  pageid: number
  title: string
  lat: number
  lon: number
}
interface ExtMeta {
  [k: string]: { value: string | number } | undefined
}
interface ImageInfo {
  url: string
  thumburl?: string
  descriptionurl: string
  width: number
  height: number
  mime: string
  extmetadata?: ExtMeta
}
interface PageInfo {
  pageid: number
  title: string
  imageinfo?: ImageInfo[]
  coordinates?: { lat: number; lon: number; primary?: string; type?: string }[]
}

// ---------- step 1: geosearch ----------

function qs(params: Record<string, string | number>): string {
  const u = new URLSearchParams({ format: 'json', formatversion: '2', maxlag: '5', ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) })
  return `${API}?${u.toString()}`
}

async function geosearch(lat: number, lng: number, radius: number): Promise<GeoHit[]> {
  const json = await fetchJson<{ query?: { geosearch: GeoHit[] } }>(
    qs({ action: 'query', list: 'geosearch', gscoord: `${lat}|${lng}`, gsradius: radius, gsnamespace: 6, gslimit: GS_LIMIT, gsprimary: 'all' }),
    { label: 'geosearch' },
  )
  return json.query?.geosearch ?? []
}

async function collectHits(): Promise<Map<number, GeoHit>> {
  const hits = new Map<number, GeoHit>()
  const { south, north, west, east } = CAMPUS_BOUNDS
  // ~250 m grid; radius 200 m circles overlap so the box is fully covered.
  const stepLat = 250 / 111_320
  const stepLng = 250 / (111_320 * Math.cos((42.339 * Math.PI) / 180))
  const queue: { lat: number; lng: number; r: number }[] = []
  for (let la = south + stepLat / 2; la < north + stepLat / 2; la += stepLat)
    for (let ln = west + stepLng / 2; ln < east + stepLng / 2; ln += stepLng) queue.push({ lat: +la.toFixed(6), lng: +ln.toFixed(6), r: 200 })
  let calls = 0
  while (queue.length) {
    const c = queue.shift()!
    const res = await geosearch(c.lat, c.lng, c.r)
    calls++
    let fresh = 0
    for (const h of res) if (!hits.has(h.pageid)) (hits.set(h.pageid, h), fresh++)
    console.log(`  geosearch (${c.lat},${c.lng}) r=${c.r}: ${res.length} hits, ${fresh} new (total ${hits.size})`)
    if (res.length >= GS_LIMIT && c.r > 25) {
      const d = c.r / 2
      const dLat = d / 111_320
      const dLng = d / (111_320 * Math.cos((c.lat * Math.PI) / 180))
      for (const [a, b] of [[1, 1], [1, -1], [-1, 1], [-1, -1]])
        queue.push({ lat: +(c.lat + a * dLat).toFixed(6), lng: +(c.lng + b * dLng).toFixed(6), r: Math.ceil(c.r * 0.75) })
    }
  }
  console.log(`geosearch: ${calls} calls, ${hits.size} unique files`)
  return hits
}

// ---------- step 2: imageinfo ----------

async function fetchInfo(pageids: number[], cache: Record<string, PageInfo>): Promise<void> {
  const todo = pageids.filter((id) => !cache[id])
  console.log(`imageinfo: ${pageids.length - todo.length} cached, ${todo.length} to fetch`)
  for (let i = 0; i < todo.length; i += 50) {
    const batch = todo.slice(i, i + 50)
    const json = await fetchJson<{ query?: { pages: PageInfo[] } }>(
      qs({
        action: 'query',
        pageids: batch.join('|'),
        prop: 'imageinfo|coordinates',
        iiprop: 'url|extmetadata|size|mime',
        // 960 is one of Wikimedia's standard thumbnail steps (non-standard widths get throttled).
        iiurlwidth: 960,
        iiextmetadatalanguage: 'en',
        coprimary: 'all',
        coprop: 'type',
        colimit: 'max',
      }),
      { label: 'imageinfo' },
    )
    for (const p of json.query?.pages ?? []) cache[p.pageid] = p
    writeJson(INFO_FILE, cache)
    console.log(`  imageinfo ${Math.min(i + 50, todo.length)}/${todo.length}`)
  }
}

// ---------- step 3: filters ----------

export function stripHtml(s: string): string {
  return s
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const meta = (ii: ImageInfo, k: string): string => {
  const v = ii.extmetadata?.[k]?.value
  return v == null ? '' : String(v)
}

/** Returns normalized license short name, or null if not free enough. */
export function normalizeLicense(shortName: string, licenseCode: string): string | null {
  const s = shortName.trim()
  const code = licenseCode.trim().toLowerCase()
  if (/\b(nc|nd)\b|noncommercial|no ?deriv/i.test(s) || /-(nc|nd)\b/.test(code)) return null
  if (/^cc0\b|^cc-zero/i.test(s) || code === 'cc0') return 'CC0 1.0'
  if (/public domain|^pd\b|^pd-/i.test(s) || code.startsWith('pd')) return 'Public domain'
  const m = s.replace(/-(?=\d)/g, ' ').match(/^CC[ -]BY(?:[ -]SA)?(?: \d(?:\.\d)?)?/i)
  if (m) return m[0].toUpperCase().replace(/^CC[ -]BY[ -]SA/, 'CC BY-SA').replace(/^CC[ -]BY/, 'CC BY')
  if (/^cc-by(-sa)?-\d/.test(code)) {
    const mm = code.match(/^cc-by(-sa)?-(\d(?:\.\d)?)/)!
    return `CC BY${mm[1] ? '-SA' : ''} ${mm[2]}`
  }
  return null // GFDL-only, unknown, fair use, etc.
}

const BAD_TITLE = /\b(map|maps|logo|seal|diagram|plan|plans|floor ?plan|scan|scanned|postcard|portrait|headshot|coat of arms|emblem|chart|screenshot|drawing|illustration|poster|flyer|brochure|blueprint|elevation|sketch|aerial view map|signature)\b/i
const BAD_CAT = /\b(maps? of|logos?|seals of|diagrams|postcards|portraits?|people of|faculty|alumni|headshots|coats of arms|scans|scanned|drawings|illustrations|posters|architectural drawings|floor plans|historical images|black and white photographs|interiors?|indoor|events? at|commencement|concerts?|sports? events|ice hockey games)\b/i
const BAD_CAT2 = /\b(paintings|artworks with|ice hockey|basketball|in baseball|T206|sculptures in the museum)\b/i
/** "ca. 1910", "1940s" in a title => historic photo. (Bare years are not used: bus/train numbers look like years.) */
const HISTORIC_TITLE = /\b(ca\.?|circa|c\.)\s*1[89]\d\d\b|\b1[89][0-8]0s\b/i
const PLACE_WORD = /\b(hall|library|center|centre|station|street|avenue|ave|building|plaza|quad|park|church|cathedral|museum|school|college|university|arena|garage|village|house|court|square|bridge|fenway)\b/i
/** Title is just a person's name that is also a category ("Ronald Takaki 2") => portrait. */
function looksLikePortrait(title: string, cats: string): boolean {
  const core = title.replace(/\s*\((crop|cropped)\)|\s+\d+$/gi, '').trim()
  if (!/^[A-Z][a-z'.-]+( [A-Z]\.?)?( [A-Z][a-z'.-]+){1,2}$/.test(core) || PLACE_WORD.test(core)) return false
  return cats.split('|').some((c) => c.trim() === core)
}
const INTERIOR_TITLE =/\b(interior|inside|lobby|atrium|classroom|lecture hall|hallway|corridor|stairwell|dining hall|cafeteria|auditorium)\b/i

function parseDate(raw: string): string | null {
  const s = stripHtml(raw)
  const m = s.match(/(\d{4})[-:](\d{2})[-:](\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/)
  if (m) {
    const [, y, mo, d, h = '12', mi = '00', se = '00'] = m
    if (+mo >= 1 && +mo <= 12 && +d >= 1 && +d <= 31) return `${y}-${mo}-${d}T${h}:${mi}:${se}`
  }
  const y = s.match(/\b(1[89]\d\d|20\d\d)\b/)
  return y ? `${y[1]}-01-01` : null // year-only: date part is not a real day
}

function cleanTitle(title: string): string {
  return title.replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, '')
}

type Reason = string
function toCandidate(p: PageInfo, hit: GeoHit | undefined): Candidate | Reason {
  const ii = p.imageinfo?.[0]
  if (!ii) return 'no imageinfo (missing/deleted)'
  if (!/^image\/(jpeg|png|webp)$/.test(ii.mime)) return `mime ${ii.mime}`
  if (ii.width < 1000) return 'width < 1000'
  const license = normalizeLicense(meta(ii, 'LicenseShortName'), meta(ii, 'License'))
  if (!license) return `license not free/known (${meta(ii, 'LicenseShortName') || 'none'})`
  const title = p.title
  const cats = meta(ii, 'Categories')
  if (BAD_TITLE.test(cleanTitle(title))) return 'title looks like map/logo/scan/portrait/etc'
  if (BAD_CAT.test(cats)) return 'category looks like map/logo/portrait/interior/event/historic'
  if (BAD_CAT2.test(cats)) return 'category looks like artwork/indoor sports/baseball card'
  if (HISTORIC_TITLE.test(cleanTitle(title))) return 'historic (pre-1990)'
  if (looksLikePortrait(cleanTitle(title), cats)) return 'portrait of a person'
  if (INTERIOR_TITLE.test(cleanTitle(title))) return 'interior'

  // Coordinates: camera location (extmetadata GPS / {{Location}}) > camera-type coord > primary > geosearch.
  let lat = parseFloat(meta(ii, 'GPSLatitude'))
  let lng = parseFloat(meta(ii, 'GPSLongitude'))
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    const coords = p.coordinates ?? []
    const c = coords.find((x) => x.type === 'camera') ?? coords.find((x) => x.primary !== undefined) ?? coords[0]
    if (c) {
      lat = c.lat
      lng = c.lon
    } else if (hit) {
      lat = hit.lat
      lng = hit.lon
    } else return 'no coordinates'
  }
  if (!inCampusBounds(lat, lng)) return 'outside CAMPUS_BOUNDS'
  if (!onCampus(lat, lng)) return 'outside campus polygon (+40 m)'

  const captured = parseDate(meta(ii, 'DateTimeOriginal'))
  if (captured && +captured.slice(0, 4) < 1990) return 'historic (pre-1990)'

  let author = stripHtml(meta(ii, 'Artist'))
  if (!author) author = stripHtml(meta(ii, 'Credit'))
  if (!author || /^own work$/i.test(author)) author = 'Unknown author'
  if (author.length > 120) author = author.slice(0, 117) + '...'

  const clean = (u: string) => u.replace(/\?utm_[^#]*$/, '')
  return {
    source: 'wikimedia',
    source_id: String(p.pageid),
    source_url: ii.descriptionurl,
    image_remote_url: clean(ii.url),
    thumb_url: ii.thumburl ? clean(ii.thumburl) : undefined,
    lat: +lat.toFixed(7),
    lng: +lng.toFixed(7),
    heading: null,
    author,
    license,
    attribution: `Photo: ${author}, ${license}, via Wikimedia Commons`,
    captured_at: captured,
    width: ii.width,
    height: ii.height,
    title: cleanTitle(title),
    suggested_name: null,
    cell: cellId(lat, lng),
  }
}

/** Same author, < 15 m apart, same day: keep the largest image. */
function thinBursts(list: Candidate[]): { kept: Candidate[]; dropped: number } {
  const sorted = [...list].sort((a, b) => b.width * b.height - a.width * a.height)
  const kept: Candidate[] = []
  let dropped = 0
  for (const c of sorted) {
    // only real timestamps (not year-only fallbacks) can define a "same day burst"
    const day = c.captured_at && c.captured_at.length > 10 ? c.captured_at.slice(0, 10) : undefined
    const dup = kept.find(
      (k) => k.author === c.author && day && k.captured_at?.slice(0, 10) === day && haversineM(k.lat, k.lng, c.lat, c.lng) < 15,
    )
    if (dup) dropped++
    else kept.push(c)
  }
  return { kept, dropped }
}

async function main() {
  const refresh = process.argv.includes('--refresh')
  let hitsArr = readJson<GeoHit[]>(HITS_FILE, [])
  if (!hitsArr.length || refresh) {
    hitsArr = [...(await collectHits()).values()]
    writeJson(HITS_FILE, hitsArr)
  } else console.log(`geosearch: using cached ${hitsArr.length} hits (--refresh to refetch)`)
  const hits = new Map(hitsArr.map((h) => [h.pageid, h]))

  const cache = refresh ? {} : readJson<Record<string, PageInfo>>(INFO_FILE, {})
  await fetchInfo([...hits.keys()], cache)

  const reasons: Record<string, number> = {}
  const passed: Candidate[] = []
  for (const id of hits.keys()) {
    const p = cache[id]
    const r = p ? toCandidate(p, hits.get(id)) : 'no page info'
    if (typeof r === 'string') reasons[r] = (reasons[r] ?? 0) + 1
    else passed.push(r)
  }
  const { kept, dropped } = thinBursts(passed)
  if (dropped) reasons['near-duplicate burst (same author, <15 m, same day)'] = dropped

  const existing = readCandidates()
  const merged = replaceSource(existing, 'wikimedia', kept)
  writeCandidates(merged.list)

  const report = { raw_hits: hits.size, passed_filters: passed.length, kept: kept.length, rejected: reasons }
  writeJson(REPORT_FILE, report)
  console.log(`\nCommons: ${hits.size} raw hits -> ${passed.length} pass filters -> ${kept.length} kept (+${merged.added} new, -${merged.removed} removed)`)
  for (const [k, v] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) console.log(`  rejected ${String(v).padStart(4)}  ${k}`)
  console.log(`candidates.json now holds ${merged.list.length} candidates`)

  if (!process.argv.includes('--no-thumbs')) {
    console.log('downloading thumbnails...')
    const t = await downloadThumbs(merged.list.filter((c) => c.source === 'wikimedia'))
    console.log(`thumbs: ${t.ok} downloaded, ${t.skipped} cached, ${t.failed.length} failed`)
    for (const f of t.failed.slice(0, 20)) console.log(`  FAILED ${f}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
