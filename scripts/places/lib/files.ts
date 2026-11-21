// JSON I/O for the data/ working folder + candidate merging.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Candidate } from './types'

export const REPO_ROOT = path.resolve(__dirname, '..', '..', '..')
export const DATA_DIR = path.join(REPO_ROOT, 'data')
export const CACHE_DIR = path.join(DATA_DIR, 'cache')
export const OSM_DIR = path.join(DATA_DIR, 'osm')
export const CANDIDATES_FILE = path.join(DATA_DIR, 'candidates.json')

export function dataPath(...parts: string[]): string {
  return path.join(DATA_DIR, ...parts)
}

export function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

export function readJson<T>(file: string, fallback: T): T {
  if (!existsSync(file)) return fallback
  const text = readFileSync(file, 'utf8')
  if (!text.trim()) return fallback
  return JSON.parse(text) as T
}

/** Atomic-ish write (tmp + rename) so an interrupted run never leaves half a file. */
export function writeJson(file: string, value: unknown): void {
  ensureDir(path.dirname(file))
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8')
  renameSync(tmp, file)
}

export const candidateKey = (c: Pick<Candidate, 'source' | 'source_id'>) => `${c.source}:${c.source_id}`

export function readCandidates(): Candidate[] {
  return readJson<Candidate[]>(CANDIDATES_FILE, [])
}

export function writeCandidates(list: Candidate[]): void {
  writeJson(CANDIDATES_FILE, list)
}

/**
 * Merge `incoming` into the existing list keyed by source+source_id. Fresh
 * source data overwrites old fields, but enrichment added later
 * (nearby_features, suggested_name, cell) is kept when the incoming record
 * doesn't carry it.
 */
export function mergeCandidates(existing: Candidate[], incoming: Candidate[]): { list: Candidate[]; added: number; updated: number } {
  const map = new Map<string, Candidate>()
  for (const c of existing) map.set(candidateKey(c), c)
  let added = 0
  let updated = 0
  for (const c of incoming) {
    const k = candidateKey(c)
    const prev = map.get(k)
    if (!prev) {
      map.set(k, c)
      added++
    } else {
      map.set(k, {
        ...prev,
        ...c,
        suggested_name: c.suggested_name ?? prev.suggested_name,
        nearby_features: c.nearby_features ?? prev.nearby_features,
        cell: c.cell ?? prev.cell,
      })
      updated++
    }
  }
  return { list: [...map.values()], added, updated }
}

/** Replace all candidates of one source with `incoming` (drops ones that no longer pass filters). */
export function replaceSource(existing: Candidate[], source: Candidate['source'], incoming: Candidate[]): { list: Candidate[]; added: number; removed: number } {
  const others = existing.filter((c) => c.source !== source)
  const prevOfSource = existing.filter((c) => c.source === source)
  const merged = mergeCandidates(prevOfSource, incoming)
  const keep = new Set(incoming.map(candidateKey))
  const list = [...others, ...merged.list.filter((c) => keep.has(candidateKey(c)))]
  return { list, added: merged.added, removed: prevOfSource.filter((c) => !keep.has(candidateKey(c))).length }
}

/** Filesystem-safe id for cache file names. */
export function safeId(id: string): string {
  return id.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120)
}

export function thumbPath(c: Pick<Candidate, 'source' | 'source_id'>): string {
  return path.join(CACHE_DIR, `${c.source}-${safeId(c.source_id)}.jpg`)
}
