// Downloads review thumbnails for every candidate in data/candidates.json and
// prunes cached thumbnails that no longer belong to a candidate.
// Run: npx tsx scripts/places/thumbs.ts [--no-prune]   (fetch scripts also download thumbs)
import { readdirSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import { CACHE_DIR, ensureDir, readCandidates, thumbPath } from './lib/files'
import { downloadThumbs } from './lib/thumbs'

async function main() {
  const cands = readCandidates()
  console.log(`thumbnails for ${cands.length} candidates -> data/cache/`)
  const r = await downloadThumbs(cands)
  console.log(`downloaded ${r.ok}, already cached ${r.skipped}, failed ${r.failed.length}`)
  for (const f of r.failed) console.log(`  FAILED ${f}`)
  if (!process.argv.includes('--no-prune')) {
    ensureDir(CACHE_DIR)
    const wanted = new Set(cands.map((c) => path.basename(thumbPath(c))))
    let pruned = 0
    for (const f of readdirSync(CACHE_DIR)) {
      if (f.endsWith('.jpg') && !wanted.has(f)) {
        unlinkSync(path.join(CACHE_DIR, f))
        pruned++
      }
    }
    if (pruned) console.log(`pruned ${pruned} stale thumbnails`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
