// Polite fetch helper: per-host rate limiting, retries with exponential
// backoff, honors Retry-After / HTTP 429 / 503 and MediaWiki maxlag errors.

export const USER_AGENT = 'NUguessr/1.0 (github.com/mesanand/NUguessr)'

/** Minimum gap between requests per host (ms). */
const HOST_GAPS: Record<string, number> = {
  'commons.wikimedia.org': 250,
  'upload.wikimedia.org': 300,
  'overpass-api.de': 2000,
  'graph.mapillary.com': 150,
}
const DEFAULT_GAP = 250

const lastCall = new Map<string, number>()
const chains = new Map<string, Promise<void>>()

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Serialized per host, so concurrent callers still respect the gap. */
function throttle(host: string): Promise<void> {
  const gap = HOST_GAPS[host] ?? DEFAULT_GAP
  const next = (chains.get(host) ?? Promise.resolve()).then(async () => {
    const wait = (lastCall.get(host) ?? 0) + gap - Date.now()
    if (wait > 0) await sleep(wait)
    lastCall.set(host, Date.now())
  })
  chains.set(host, next)
  return next
}

export interface FetchOpts extends RequestInit {
  retries?: number
  /** Log label for errors (never include secrets). */
  label?: string
}

function retryAfterMs(res: Response, attempt: number): number {
  const ra = res.headers.get('retry-after')
  if (ra) {
    const secs = Number(ra)
    if (!Number.isNaN(secs)) return Math.min(secs * 1000, 120_000)
    const date = Date.parse(ra)
    if (!Number.isNaN(date)) return Math.max(0, Math.min(date - Date.now(), 120_000))
  }
  return Math.min(1000 * 2 ** attempt, 60_000)
}

/** Redact access tokens from URLs before logging. */
export function redact(url: string): string {
  return url.replace(/(access_token|key|token)=[^&]+/gi, '$1=***')
}

export async function politeFetch(url: string, opts: FetchOpts = {}): Promise<Response> {
  const { retries = 5, label, ...init } = opts
  const host = new URL(url).host
  const headers = new Headers(init.headers)
  headers.set('User-Agent', USER_AGENT)
  if (!headers.has('Api-User-Agent')) headers.set('Api-User-Agent', USER_AGENT)
  let lastErr: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    await throttle(host)
    try {
      const res = await fetch(url, { ...init, headers })
      if (res.status === 429 || res.status === 503 || res.status === 502 || res.status === 504) {
        const wait = retryAfterMs(res, attempt)
        console.warn(`[http] ${res.status} from ${host}${label ? ` (${label})` : ''}; retrying in ${Math.round(wait / 1000)}s`)
        await res.body?.cancel().catch(() => {})
        await sleep(wait)
        continue
      }
      return res
    } catch (err) {
      lastErr = err
      const wait = Math.min(1000 * 2 ** attempt, 30_000)
      console.warn(`[http] network error for ${redact(url).slice(0, 120)}: ${(err as Error).message}; retry in ${wait}ms`)
      await sleep(wait)
    }
  }
  throw new Error(`politeFetch failed after ${retries + 1} attempts: ${redact(url).slice(0, 160)} ${lastErr ? String(lastErr) : ''}`)
}

/** GET JSON. For MediaWiki, handles `error.code === 'maxlag'` by waiting and retrying. */
export async function fetchJson<T = unknown>(url: string, opts: FetchOpts = {}): Promise<T> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await politeFetch(url, opts)
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`HTTP ${res.status} for ${redact(url).slice(0, 160)}: ${body.slice(0, 300)}`)
    }
    const json = (await res.json()) as T & { error?: { code?: string; info?: string } }
    if (json && typeof json === 'object' && json.error?.code === 'maxlag') {
      const wait = retryAfterMs(res, attempt + 2)
      console.warn(`[http] maxlag; waiting ${Math.round(wait / 1000)}s`)
      await sleep(wait)
      continue
    }
    return json
  }
  throw new Error(`maxlag persisted for ${redact(url).slice(0, 160)}`)
}

/** Download binary content (Buffer). Returns null on 404. */
export async function fetchBuffer(url: string, opts: FetchOpts = {}): Promise<Buffer | null> {
  const res = await politeFetch(url, opts)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${redact(url).slice(0, 160)}`)
  return Buffer.from(await res.arrayBuffer())
}
