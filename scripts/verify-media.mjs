#!/usr/bin/env node
/**
 * Verifies that every file referenced by the `media` table (original + all
 * generated image sizes) exists in MEDIA_DIR with the recorded size.
 * Optionally also checks it is actually served over HTTP:
 *   node scripts/verify-media.mjs [--base-url http://localhost:3000]
 */
import fs from 'node:fs'
import pg from 'pg'
import { loadEnv, requireEnv, mediaDir, safeJoin } from './_env.mjs'

loadEnv()
requireEnv('DATABASE_URI')
const dir = mediaDir()
const baseIdx = process.argv.indexOf('--base-url')
const baseUrl = baseIdx > -1 ? process.argv[baseIdx + 1]?.replace(/\/$/, '') : null

const client = new pg.Client({ connectionString: process.env.DATABASE_URI })
await client.connect()
const cols = (
  await client.query(
    `select column_name from information_schema.columns
     where table_schema = current_schema() and table_name = 'media'`,
  )
).rows.map((r) => r.column_name)
const sizeNames = cols.filter((c) => /^sizes_.+_filename$/.test(c)).map((c) => c.slice(6, -9))
const { rows } = await client.query('select * from media order by id')
await client.end()

const expected = new Map() // filename -> { size, ids }
const add = (name, size, id) => {
  if (!name) return
  const e = expected.get(name) ?? { size: size == null ? null : Number(size), ids: [] }
  e.ids.push(id)
  expected.set(name, e)
}
for (const r of rows) {
  add(r.filename, r.filesize, r.id)
  for (const s of sizeNames) add(r[`sizes_${s}_filename`], r[`sizes_${s}_filesize`], r.id)
}

const problems = []
for (const [name, e] of expected) {
  const p = safeJoin(dir, name)
  if (!fs.existsSync(p)) problems.push(`MISSING   ${name} (media id ${e.ids.join(',')})`)
  else if (e.size != null && fs.statSync(p).size !== e.size)
    problems.push(`SIZE DIFF ${name}: db=${e.size} disk=${fs.statSync(p).size}`)
}

if (baseUrl) {
  for (const [name] of expected) {
    const res = await fetch(`${baseUrl}/api/media/file/${encodeURIComponent(name)}`).catch((e) => ({ ok: false, status: e.message }))
    if (!res.ok) problems.push(`HTTP ${res.status}  ${name}`)
  }
}

const onDisk = fs.readdirSync(dir).filter((f) => fs.statSync(`${dir}/${f}`).isFile() && !f.endsWith('.part'))
const orphans = onDisk.filter((f) => !expected.has(f))

console.log(`media rows: ${rows.length} | referenced files: ${expected.size} | files on disk: ${onDisk.length}${baseUrl ? ` | HTTP checked at ${baseUrl}` : ''}`)
if (orphans.length) console.log(`note: ${orphans.length} file(s) on disk not referenced by DB (harmless): ${orphans.slice(0, 10).join(', ')}${orphans.length > 10 ? ', …' : ''}`)
if (problems.length) {
  console.error(`\n${problems.length} problem(s):`)
  for (const p of problems.slice(0, 40)) console.error('  ' + p)
  if (problems.length > 40) console.error(`  … and ${problems.length - 40} more`)
  process.exit(1)
}
console.log('OK: every referenced media file is present' + (baseUrl ? ' and served over HTTP.' : '.'))
