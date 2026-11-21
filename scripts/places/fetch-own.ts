// Imports your own photos from data/own/*.(jpg|jpeg|png|heic|heif).
// GPS (+ GPSImgDirection as heading) and capture time come from EXIF (exifr).
// Photos without GPS are skipped (listed in the output). HEIC is converted to
// JPEG for the review thumbnail; publish.ts reads the original via file://.
//
// Run: npm run places:fetch:own   (OWN_PHOTO_AUTHOR="Your Name" to set the credit)
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import exifr from 'exifr'
import sharp from 'sharp'
import { dataPath, readCandidates, replaceSource, writeCandidates } from './lib/files'
import { onCampus } from './lib/campus-filter'
import { cellId } from './lib/geo'
import { heicToJpeg } from './lib/heic'
import { downloadThumbs } from './lib/thumbs'
import type { Candidate } from './lib/types'

const OWN_DIR = dataPath('own')
const EXT = /\.(jpe?g|png|heic|heif)$/i

async function main() {
  const author = process.env.OWN_PHOTO_AUTHOR?.trim() || 'NUguessr contributors'
  const files = existsSync(OWN_DIR) ? readdirSync(OWN_DIR).filter((f) => EXT.test(f)) : []
  if (!files.length) {
    console.log(`No photos in ${OWN_DIR} (jpg/jpeg/png/heic/heif) — nothing to import.`)
    // Still reconcile: drop 'own' candidates whose files were removed.
    const merged = replaceSource(readCandidates(), 'own', [])
    if (merged.removed) {
      writeCandidates(merged.list)
      console.log(`removed ${merged.removed} stale own candidates`)
    }
    return
  }
  const kept: Candidate[] = []
  const skipped: string[] = []
  for (const f of files) {
    const abs = path.join(OWN_DIR, f)
    const buf = readFileSync(abs)
    const sha = createHash('sha1').update(buf).digest('hex')
    let exif: Record<string, unknown> | undefined
    try {
      exif = await exifr.parse(buf, { gps: true, exif: true, tiff: true, xmp: false, translateValues: true })
    } catch {
      exif = undefined
    }
    const lat = exif?.latitude as number | undefined
    const lng = exif?.longitude as number | undefined
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      skipped.push(`${f}: no GPS in EXIF`)
      continue
    }
    if (!onCampus(lat, lng)) {
      skipped.push(`${f}: GPS ${lat.toFixed(5)},${lng.toFixed(5)} is off campus`)
      continue
    }
    const dir = exif?.GPSImgDirection
    const heading = typeof dir === 'number' && Number.isFinite(dir) ? +(((dir % 360) + 360) % 360).toFixed(1) : null
    const when = (exif?.DateTimeOriginal ?? exif?.CreateDate) as Date | undefined
    const isHeic = /\.(heic|heif)$/i.test(f)
    const meta = await sharp(isHeic ? await heicToJpeg(buf) : buf).rotate().metadata()
    const rotated = meta.orientation && meta.orientation >= 5
    kept.push({
      source: 'own',
      source_id: sha,
      source_url: pathToFileURL(abs).href,
      image_remote_url: pathToFileURL(abs).href,
      lat: +lat.toFixed(7),
      lng: +lng.toFixed(7),
      heading,
      author,
      license: 'owned',
      attribution: `Photo: ${author}`,
      captured_at: when instanceof Date && !Number.isNaN(+when) ? when.toISOString() : null,
      width: (rotated ? meta.height : meta.width) ?? 0,
      height: (rotated ? meta.width : meta.height) ?? 0,
      title: f,
      suggested_name: null,
      cell: cellId(lat, lng),
    })
  }
  const merged = replaceSource(readCandidates(), 'own', kept)
  writeCandidates(merged.list)
  console.log(`Own photos: ${files.length} files -> ${kept.length} kept (+${merged.added} new, -${merged.removed} removed)`)
  for (const s of skipped) console.log(`  skipped ${s}`)
  const t = await downloadThumbs(kept)
  console.log(`thumbs: ${t.ok} written, ${t.skipped} cached, ${t.failed.length} failed`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
