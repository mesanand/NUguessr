// Prints candidate coverage: a 6x6 grid over CAMPUS_BOUNDS (north at top) and
// counts per nearest named area; writes data/coverage.txt.
// Run: npm run places:coverage [-- data/selected.json]  (defaults to candidates.json)
import path from 'node:path'
import { writeFileSync } from 'node:fs'
import { CANDIDATES_FILE, dataPath, ensureDir, readJson } from './lib/files'
import { CAMPUS_BOUNDS } from './lib/campus-filter'
import type { Candidate } from './lib/types'

const N = 6

function main() {
  const file = process.argv[2] ? path.resolve(process.argv[2]) : CANDIDATES_FILE
  const list = readJson<Candidate[]>(file, [])
  const { south, west, north, east } = CAMPUS_BOUNDS
  const grid = Array.from({ length: N }, () => new Array<number>(N).fill(0))
  const bySource: Record<string, number> = {}
  const byArea: Record<string, number> = {}
  let outside = 0
  for (const c of list) {
    bySource[c.source] = (bySource[c.source] ?? 0) + 1
    const r = Math.floor(((north - c.lat) / (north - south)) * N)
    const col = Math.floor(((c.lng - west) / (east - west)) * N)
    if (r < 0 || r >= N || col < 0 || col >= N) outside++
    else grid[r][col]++
    const area = c.suggested_name ?? c.nearby_features?.[0]?.name ?? '(no named feature within 80 m)'
    byArea[area] = (byArea[area] ?? 0) + 1
  }
  const lines: string[] = []
  lines.push(`Coverage of ${path.relative(process.cwd(), file)}: ${list.length} items  ${JSON.stringify(bySource)}`)
  lines.push(`Grid ${N}x${N} over CAMPUS_BOUNDS S${south} W${west} N${north} E${east} (north at top, west at left; cell ~${Math.round(((north - south) * 111_320) / N)} m x ${Math.round(((east - west) * 111_320 * Math.cos((42.339 * Math.PI) / 180)) / N)} m)`)
  lines.push('       ' + Array.from({ length: N }, (_, i) => `c${i}`.padStart(5)).join(''))
  grid.forEach((row, i) => {
    const latTop = (north - ((north - south) * i) / N).toFixed(4)
    lines.push(`${latTop} ` + row.map((v) => String(v || '.').padStart(5)).join(''))
  })
  const empty = grid.flat().filter((v) => v === 0).length
  lines.push(`empty cells: ${empty}/${N * N}${outside ? `, outside bounds: ${outside}` : ''}`)
  lines.push('')
  lines.push('By nearest named area (suggested_name, else closest feature <= 80 m):')
  for (const [k, v] of Object.entries(byArea).sort((a, b) => b[1] - a[1])) lines.push(`  ${String(v).padStart(4)}  ${k}`)
  const text = lines.join('\n')
  console.log(text)
  ensureDir(dataPath())
  writeFileSync(dataPath('coverage.txt'), text + '\n', 'utf8')
  console.log(`\nwrote ${dataPath('coverage.txt')}`)
}

main()
