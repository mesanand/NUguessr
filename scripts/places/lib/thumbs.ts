// Downloads ~1024 px review thumbnails to data/cache/<source>-<id>.jpg.
// Skips files that already exist (resumable). Always re-encodes to JPEG via
// sharp (auto-rotated) so reviewers get a consistent format.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { CACHE_DIR, ensureDir, thumbPath } from './files'
import { fetchBuffer } from './http'
import type { Candidate } from './types'

export const THUMB_MAX = 1024

async function loadSource(c: Candidate): Promise<Buffer | null> {
  const url = c.thumb_url ?? c.image_remote_url
  if (url.startsWith('file:')) {
    const p = fileURLToPath(url)
    if (!existsSync(p)) return null
    let buf: Buffer = readFileSync(p)
    if (/\.(heic|heif)$/i.test(p)) {
      const { heicToJpeg } = await import('./heic')
      buf = await heicToJpeg(buf)
    }
    return buf
  }
  return fetchBuffer(url, { label: 'thumb' })
}

export async function downloadThumbs(cands: Candidate[], opts: { log?: boolean } = {}): Promise<{ ok: number; skipped: number; failed: string[] }> {
  ensureDir(CACHE_DIR)
  let ok = 0
  let skipped = 0
  const failed: string[] = []
  let i = 0
  for (const c of cands) {
    i++
    const out = thumbPath(c)
    if (existsSync(out)) {
      skipped++
      continue
    }
    try {
      const buf = await loadSource(c)
      if (!buf) throw new Error('not found')
      const jpg = await sharp(buf)
        .rotate()
        .resize({ width: THUMB_MAX, height: THUMB_MAX, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 82, mozjpeg: true })
        .toBuffer()
      writeFileSync(out, jpg)
      ok++
      if (opts.log !== false && ok % 25 === 0) console.log(`  thumbs: ${ok} downloaded (${i}/${cands.length})`)
    } catch (e) {
      failed.push(`${c.source}:${c.source_id} ${(e as Error).message}`)
    }
  }
  return { ok, skipped, failed }
}
