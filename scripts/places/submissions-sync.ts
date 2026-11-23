// Close the loop on community submissions after curating + publishing.
//
//   npm run places:submissions:sync              (needs SUPABASE_SERVICE_ROLE_KEY)
//   npm run places:submissions:sync -- --dry-run
//
// 1. APPROVE: every `community` entry in data/publish/published.json that has
//    a place_id -> photo_submissions.status = 'approved', place_id set.
// 2. REJECT: every pending submission whose final curation decision
//    (data/curation/{batch,rescue,review}-*.json, later files win) is
//    'reject' -> status = 'rejected', review_notes = the reason.
// 3. DELETE ORIGINALS: for approved / rejected / withdrawn submissions whose
//    original is still in the private `submissions` bucket, delete it and set
//    original_deleted_at. Originals carry full EXIF (GPS, device, time), so
//    nothing is kept in the cloud once a decision is made.
//    Local copies in data/submissions/ are deleted for rejected/withdrawn ones;
//    approved ones keep their local copy (git-ignored) so a crop/blur can be
//    redone. Pass --purge-local to delete those too.
// 4. ORPHANS: objects in the bucket with no submission row, older than 24 h
//    (an upload whose submit_photo call never happened) are deleted.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { unlink } from 'node:fs/promises'
import path from 'node:path'
import { dataPath } from './lib/files'
import type { CurationDecision } from './lib/types'
import { SUBMISSIONS_BUCKET, SUBMISSIONS_DIR, serviceClient } from './fetch-submissions'

const dryRun = process.argv.includes('--dry-run')
const purgeLocal = process.argv.includes('--purge-local')
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Db = ReturnType<typeof serviceClient>

function readJson<T>(file: string, fallback: T): T {
  if (!existsSync(file)) return fallback
  const text = readFileSync(file, 'utf8')
  return text.trim() ? (JSON.parse(text) as T) : fallback
}

/** Final curation decision per community submission id (later files win). */
export function finalDecisions(curationDir = dataPath('curation')): Map<string, CurationDecision> {
  const out = new Map<string, CurationDecision>()
  if (!existsSync(curationDir)) return out
  const rank = (f: string) => (f.startsWith('batch') ? 0 : f.startsWith('rescue') ? 1 : 2)
  const files = readdirSync(curationDir)
    .filter((f) => /^(batch|rescue|review)-\d+\.json$/.test(f))
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
  for (const f of files) {
    for (const d of readJson<CurationDecision[]>(path.join(curationDir, f), [])) {
      if (d.source === 'community') out.set(d.source_id, d)
    }
  }
  return out
}

function step(msg: string) {
  console.log(`${dryRun ? '[dry run] ' : ''}${msg}`)
}

async function approve(db: Db): Promise<number> {
  const published = readJson<{ source: string; source_id: string; place_id: number | null }[]>(
    dataPath('publish', 'published.json'),
    []
  ).filter((p) => p.source === 'community' && p.place_id != null && UUID.test(p.source_id))
  let n = 0
  for (const p of published) {
    if (dryRun) {
      step(`approve ${p.source_id} -> place ${p.place_id}`)
      n++
      continue
    }
    const { data, error } = await db
      .from('photo_submissions')
      .update({ status: 'approved', place_id: p.place_id, updated_at: new Date().toISOString() })
      .eq('id', p.source_id)
      .in('status', ['pending', 'approved'])
      .select('id')
    if (error) console.warn(`  approve ${p.source_id} failed: ${error.message}`)
    else n += data?.length ?? 0
  }
  return n
}

async function reject(db: Db): Promise<number> {
  const decisions = [...finalDecisions().values()].filter((d) => d.decision === 'reject' && UUID.test(d.source_id))
  let n = 0
  for (const d of decisions) {
    const reason = (d.reason ?? '').slice(0, 300) || 'not selected'
    if (dryRun) {
      step(`reject ${d.source_id}: ${reason}`)
      n++
      continue
    }
    const { data, error } = await db
      .from('photo_submissions')
      .update({ status: 'rejected', review_notes: reason, updated_at: new Date().toISOString() })
      .eq('id', d.source_id)
      .eq('status', 'pending')
      .select('id')
    if (error) console.warn(`  reject ${d.source_id} failed: ${error.message}`)
    else n += data?.length ?? 0
  }
  return n
}

async function deleteLocal(id: string) {
  for (const ext of ['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp']) {
    const f = path.join(SUBMISSIONS_DIR, `${id}.${ext}`)
    if (existsSync(f)) await unlink(f)
  }
}

async function deleteOriginals(db: Db): Promise<number> {
  const { data, error } = await db
    .from('photo_submissions')
    .select('id, storage_path, status')
    .in('status', ['approved', 'rejected', 'withdrawn'])
    .is('original_deleted_at', null)
    .limit(1000)
  if (error) throw new Error(`photo_submissions query failed: ${error.message}`)
  const rows = (data ?? []) as { id: string; storage_path: string; status: string }[]
  let n = 0
  for (const r of rows) {
    if (dryRun) {
      step(`delete original ${r.storage_path} (${r.status})`)
      n++
      continue
    }
    const rm = await db.storage.from(SUBMISSIONS_BUCKET).remove([r.storage_path])
    if (rm.error) {
      console.warn(`  delete ${r.storage_path} failed: ${rm.error.message}`)
      continue
    }
    const upd = await db
      .from('photo_submissions')
      .update({ original_deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', r.id)
    if (upd.error) console.warn(`  mark ${r.id} failed: ${upd.error.message}`)
    if (r.status !== 'approved' || purgeLocal) await deleteLocal(r.id)
    n++
  }
  if (purgeLocal && !dryRun) {
    const { data: done } = await db.from('photo_submissions').select('id').eq('status', 'approved').limit(5000)
    for (const r of done ?? []) await deleteLocal((r as { id: string }).id)
  }
  return n
}

/** Uploads that never got a submit_photo row (closed tab, failed call). */
async function sweepOrphans(db: Db): Promise<number> {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000
  const folders: string[] = []
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db.storage.from(SUBMISSIONS_BUCKET).list('', { limit: 1000, offset })
    if (error) throw new Error(`list bucket failed: ${error.message}`)
    // Folders come back with id === null.
    folders.push(...(data ?? []).filter((o) => o.id === null && UUID.test(o.name)).map((o) => o.name))
    if (!data || data.length < 1000) break
  }
  const objects: { path: string; created: number }[] = []
  for (const folder of folders) {
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await db.storage.from(SUBMISSIONS_BUCKET).list(folder, { limit: 1000, offset })
      if (error) throw new Error(`list ${folder} failed: ${error.message}`)
      for (const o of data ?? []) {
        if (o.id === null) continue
        objects.push({ path: `${folder}/${o.name}`, created: Date.parse(o.created_at ?? '') || 0 })
      }
      if (!data || data.length < 1000) break
    }
  }
  const old = objects.filter((o) => o.created && o.created < cutoff)
  if (old.length === 0) return 0
  const known = new Set<string>()
  for (let i = 0; i < old.length; i += 200) {
    const slice = old.slice(i, i + 200).map((o) => o.path)
    const { data, error } = await db.from('photo_submissions').select('storage_path').in('storage_path', slice)
    if (error) throw new Error(`photo_submissions query failed: ${error.message}`)
    for (const r of data ?? []) known.add((r as { storage_path: string }).storage_path)
  }
  const orphans = old.filter((o) => !known.has(o.path)).map((o) => o.path)
  if (orphans.length && !dryRun) {
    for (let i = 0; i < orphans.length; i += 100) {
      const rm = await db.storage.from(SUBMISSIONS_BUCKET).remove(orphans.slice(i, i + 100))
      if (rm.error) console.warn(`  orphan delete failed: ${rm.error.message}`)
    }
  }
  for (const p of orphans) step(`orphan ${p}`)
  return orphans.length
}

async function main() {
  const db = serviceClient()
  const approved = await approve(db)
  const rejected = await reject(db)
  const deleted = await deleteOriginals(db)
  const orphans = await sweepOrphans(db)
  console.log(
    `Submissions sync${dryRun ? ' (dry run)' : ''}: ${approved} approved, ${rejected} rejected, ` +
      `${deleted} originals deleted, ${orphans} orphaned uploads removed`
  )
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e)
    process.exit(1)
  })
}
