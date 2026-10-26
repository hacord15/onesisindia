#!/usr/bin/env node
/**
 * One-off, NON-DESTRUCTIVE copy of every object in the MinIO/S3 bucket into
 * MEDIA_DIR. Nothing is ever deleted or modified in the bucket (read-only calls
 * only: ListObjectsV2 + GetObject). Safe to re-run: files already present with
 * the same size are skipped.
 *
 * Needs S3_* vars (the legacy ones) + MEDIA_DIR, from .env or the environment.
 *   node scripts/migrate-media-from-s3.mjs [--dry-run]
 */
import fs from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3'
import { loadEnv, requireEnv, mediaDir, safeJoin } from './_env.mjs'

loadEnv()
requireEnv('S3_BUCKET', 'S3_ENDPOINT', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY')
const dryRun = process.argv.includes('--dry-run')
const dir = mediaDir()
const prefix = process.env.S3_PREFIX || ''

const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION || 'us-east-1',
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
})

fs.mkdirSync(dir, { recursive: true })

const objects = []
let token
do {
  const res = await s3.send(
    new ListObjectsV2Command({ Bucket: process.env.S3_BUCKET, Prefix: prefix, ContinuationToken: token }),
  )
  for (const o of res.Contents ?? []) if (o.Key && !o.Key.endsWith('/')) objects.push(o)
  token = res.IsTruncated ? res.NextContinuationToken : undefined
} while (token)

console.log(`Bucket "${process.env.S3_BUCKET}": ${objects.length} objects -> ${dir}${dryRun ? ' (dry run)' : ''}`)

const report = { copied: [], skipped: [], failed: [] }
for (const o of objects) {
  const name = prefix ? o.Key.slice(prefix.length).replace(/^\/+/, '') : o.Key
  try {
    const dest = safeJoin(dir, name)
    if (fs.existsSync(dest) && fs.statSync(dest).size === o.Size) {
      report.skipped.push({ key: o.Key, size: o.Size })
      continue
    }
    if (dryRun) {
      report.copied.push({ key: o.Key, size: o.Size })
      continue
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    const tmp = `${dest}.part`
    const got = await s3.send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: o.Key }))
    await pipeline(got.Body, fs.createWriteStream(tmp))
    const written = fs.statSync(tmp).size
    if (written !== o.Size) throw new Error(`size mismatch: expected ${o.Size}, wrote ${written}`)
    fs.renameSync(tmp, dest)
    report.copied.push({ key: o.Key, size: o.Size })
  } catch (err) {
    report.failed.push({ key: o.Key, error: String(err.message || err) })
  }
}

console.log(`copied: ${report.copied.length}  skipped(already present): ${report.skipped.length}  failed: ${report.failed.length}`)
for (const f of report.failed) console.error(`  FAILED ${f.key}: ${f.error}`)

if (!dryRun) {
  fs.mkdirSync('migration-reports', { recursive: true })
  const out = path.join('migration-reports', `s3-to-local-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  fs.writeFileSync(out, JSON.stringify({ bucket: process.env.S3_BUCKET, mediaDir: dir, ...report }, null, 2))
  console.log(`Report: ${out}`)
}
console.log('Bucket was NOT modified. Next: npm run media:verify')
process.exit(report.failed.length ? 1 : 0)
