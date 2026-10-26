# Media storage: MinIO/S3 → local filesystem

Payload now stores uploads in `MEDIA_DIR` on the VPS instead of the `onesis-media2` bucket.

## Why URLs and DB rows don't change
Every media URL in the database is relative: `/api/media/file/<filename>`. With the S3 plugin removed,
that same route is served by Payload's built-in file handler, reading `MEDIA_DIR/<filename>`.
So **no SQL changes are needed** as long as the files are copied across **with identical filenames**
(originals + the `-400x300`, `-800x600`, `-1920x800` sizes). `media:verify` proves this against the DB.
Access control is unchanged (`Media.ts`: public read, authenticated create/update/delete).

## What changed in the code
| File | Change |
|---|---|
| `src/payload.config.ts` | removed `s3Storage` plugin |
| `src/payload/collections/Media.ts` | added `staticDir` ← `MEDIA_DIR` |
| `src/app/(payload)/admin/importMap.js` | regenerated (dropped the S3 client upload handler import — the build fails without this) |
| `next.config.ts` | removed the MinIO `127.0.0.1:9000` image pattern |
| `package.json` / lockfile | removed `@payloadcms/storage-s3`; dev-only `@aws-sdk/client-s3`, `pg` for the scripts |
| `docker-compose.yml` | MinIO removed (kept in `docker-compose.legacy-minio.yml` for rollback) |
| `scripts/` | `backup.sh`, `migrate-media-from-s3.mjs`, `verify-media.mjs` |
| `.env.example` | new; documents `MEDIA_DIR`, legacy S3 vars commented out |

## Cutover runbook (VPS)
Keep the OLD app running and MinIO untouched until step 7.

1. **Backup** (DB + env; also snapshot the MinIO data dir):
   `npm run media:backup` and `tar -czf minio-data-$(date +%F).tar.gz -C /path/to/minio/data .`
   Copy both off the server.
2. **Create the persistent directory** (outside the release folder so deploys never wipe it):
   ```bash
   sudo mkdir -p /var/lib/onesis/media
   sudo chown -R <app-user>:<app-user> /var/lib/onesis/media && sudo chmod 750 /var/lib/onesis/media
   ```
3. **Env**: add `MEDIA_DIR=/var/lib/onesis/media` to the server `.env`. Keep the existing `S3_*` lines for now
   (only the migration script reads them). Never commit `.env`.
4. **Install & copy files** (read-only on the bucket, safe to repeat, skips files already present):
   ```bash
   npm install
   npm run media:migrate -- --dry-run    # preview
   npm run media:migrate
   npm run media:verify                  # every DB-referenced file present with the recorded size
   ```
5. **Deploy the new build** (`npm run build`), but before restarting, stop admin uploads for a moment and run
   `npm run media:migrate` once more to pick up anything uploaded since step 4. Then restart the app
   (pm2/systemd/docker — if Docker, bind-mount `/var/lib/onesis/media` to the same path in the container).
6. **Verify live**:
   `npm run media:verify -- --base-url https://<your-domain>`; then in `/admin` check thumbnails in
   Media, upload a new image (confirm the `-400x300/-800x600/-1920x800` files appear in `MEDIA_DIR`), and
   click through the homepage, board, news, case-studies and careers pages.
7. **Observe for a few days.** Only then remove the `S3_*` lines from `.env`. Decommissioning MinIO / deleting the
   bucket is a separate, manual decision — nothing here does it. Keep the step-1 snapshot.

## Rollback
The database schema and rows are never modified, so rollback is just code + env:
1. Redeploy the previous build (with `@payloadcms/storage-s3`) and the previous `.env` (with `S3_*`). MinIO is still up.
2. Files uploaded **after** cutover exist only in `MEDIA_DIR`; push them back so the old app can serve them
   (does not overwrite existing objects):
   `mc mirror --exclude "*.part" /var/lib/onesis/media <alias>/onesis-media2`
   (or `aws s3 sync … --endpoint-url http://127.0.0.1:9000`).
3. Restoring the DB dump from step 1 is only needed if content was damaged; it would discard CMS edits made after the backup.

## Ongoing backups
`MEDIA_DIR` is now the only copy of the media — include it in the VPS backup routine
(e.g. nightly `rsync`/`restic`/`tar` of `/var/lib/onesis/media`, plus `pg_dump`). `npm run media:backup` does both once.

## Notes
- Check your reverse proxy allows your upload size (`client_max_body_size` in nginx) — unchanged from before, but worth a glance.
- Cache headers for `/api/media/file/*` are left as before; add them at nginx if you want longer browser caching.
- `.env` is intentionally **not** in the zip; use `.env.example` as the template.
