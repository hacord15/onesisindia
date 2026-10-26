// Tiny helper: load a .env file (Node >= 20.12) without printing any values.
import fs from 'node:fs'
import path from 'node:path'

export function loadEnv() {
  const file = process.env.ENV_FILE || '.env'
  if (fs.existsSync(file)) process.loadEnvFile(file)
}

export function requireEnv(...names) {
  const missing = names.filter((n) => !process.env[n])
  if (missing.length) {
    console.error(`Missing required env vars: ${missing.join(', ')}`)
    process.exit(2)
  }
}

export function mediaDir() {
  requireEnv('MEDIA_DIR')
  return path.resolve(process.env.MEDIA_DIR)
}

/** Resolve a bucket key / filename inside dir, refusing path traversal. */
export function safeJoin(dir, name) {
  const target = path.resolve(dir, name)
  if (target !== dir && !target.startsWith(dir + path.sep)) {
    throw new Error(`Refusing path outside media dir: ${name}`)
  }
  return target
}
