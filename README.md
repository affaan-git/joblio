# Joblio v1 (Local)

## Run

```bash
cd tracker
JOBLIO_API_TOKEN='set-a-long-random-secret' \
JOBLIO_BASIC_AUTH_USER='joblio' \
JOBLIO_BASIC_AUTH_PASS='set-a-strong-password' \
npm start
```

Then open: `http://127.0.0.1:8787`

Sign in via browser basic auth prompt, then set API token in UI: `Data -> Set API token`

## Secure Local Start (Recommended)

```bash
cd tracker
npm run start:secure
```

This script:
- Generates `JOBLIO_API_TOKEN` for the current shell if missing
- Generates `JOBLIO_BASIC_AUTH_USER`/`JOBLIO_BASIC_AUTH_PASS` if missing
- Enforces strict mode defaults
- Runs preflight checks
- Starts server and prints token for UI entry
- Works on macOS, Linux, and Windows

## What v1 backend stores

- Tracker state on disk: `.joblio-data/state.json`
- Uploaded files on disk: `.joblio-data/storage/<appId>/...`
- Activity log: `.joblio-data/logs/activity.log`

## Security Hardening (v1)

- All write endpoints enforce same-origin checks (`Origin`/`Referer` host must match server host when present).
- Optional write auth token:
  - Set `JOBLIO_API_TOKEN=your-secret-token` before `npm start`
  - Client sends token using `localStorage["joblio-api-token"]`
  - All API calls require header `X-Joblio-Token` in strict mode
- HTTP Basic auth (global):
  - Set `JOBLIO_BASIC_AUTH_USER` and `JOBLIO_BASIC_AUTH_PASS`
  - Required for all routes in strict mode (UI + API + static)
- Strict runtime mode is enabled by default:
  - `JOBLIO_STRICT_MODE=1` behavior is default (`JOBLIO_STRICT_MODE=0` disables)
  - Requires `JOBLIO_API_TOKEN`, `JOBLIO_BASIC_AUTH_USER`, and `JOBLIO_BASIC_AUTH_PASS` for startup
  - Server refuses non-local bind host unless `JOBLIO_ALLOW_REMOTE=1`
  - UI can set token locally from Data menu (`Set API token`)
- Request/body limits are enforced server-side:
  - `MAX_JSON_BODY_BYTES` (default 5 MB)
  - `MAX_UPLOAD_JSON_BYTES` (default 35 MB)
  - `MAX_FILE_BYTES` (default 25 MB decoded file bytes)
  - `MAX_APPS` (default 10000)
- Request rate limits are enforced per IP and route bucket:
  - `RATE_WINDOW_MS` (default 60000)
  - `RATE_MAX_WRITE` (default 180)
  - `RATE_MAX_UPLOAD` (default 24)
  - `RATE_MAX_DELETE` (default 120)
  - `RATE_MAX_IMPORT` (default 10)
- Storage safety:
  - IDs are validated
  - File paths are resolved and constrained to app/trash storage roots
- State durability:
  - Rolling snapshots in `.joblio-data/snapshots/` before writes
  - Snapshot recovery attempted if `state.json` is unreadable
  - `MAX_SNAPSHOTS` controls retention (default 20)
- Response hardening headers are set (CSP, frame deny, nosniff, no-referrer, permissions policy).
- Log rotation:
  - `activity.log` rotates to `activity.log.1` at `LOG_ROTATE_BYTES` (default 5 MB).
- Tamper-evident audit chaining:
  - Each audit entry includes a chained hash
  - Optional HMAC signing with `JOBLIO_AUDIT_KEY`
  - Integrity status appears in verbose health
- Health endpoint details are minimal by default; set `JOBLIO_HEALTH_VERBOSE=1` for diagnostics.
- `500` responses are generic by default; set `JOBLIO_ERROR_VERBOSE=1` for local debug details.
- Permanent file purge delay:
  - Files in trash require minimum age before purge (`PURGE_MIN_AGE_SEC`, default 120)
- HTTP server hardening:
  - request timeout 15s, headers timeout 15s, keepalive timeout 5s

## API

- `GET /api/state`
- `PUT /api/state` with `{ "state": { ... } }`
- `GET /api/health`
- `GET /api/health?verbose=1` (requires token in strict mode)
- `GET /api/integrity/verify` (requires token)
- `POST /api/files/upload` with `{ appId, name, type, size, contentBase64 }`
- `DELETE /api/files/:fileId`
- `POST /api/files/:fileId/restore`
- `DELETE /api/files/:fileId/purge`
- `GET /api/files/:fileId/download`
- `GET /api/export`
- `POST /api/import`
- `GET /api/template/resume`

### API Examples

Get state:

```bash
curl -s http://127.0.0.1:8787/api/state \
  -u 'joblio:your-basic-auth-pass' \
  -H 'x-joblio-token: your-api-token'
```

Save state:

```bash
curl -s -X PUT http://127.0.0.1:8787/api/state \\
  -u 'joblio:your-basic-auth-pass' \\
  -H 'x-joblio-token: your-api-token' \\
  -H 'content-type: application/json' \\
  --data '{"state":{"version":1,"theme":"dark","activeId":null,"apps":[],"trashApps":[],"trashFiles":[]}}'
```

Upload file:

```bash
curl -s -X POST http://127.0.0.1:8787/api/files/upload \\
  -u 'joblio:your-basic-auth-pass' \\
  -H 'x-joblio-token: your-api-token' \\
  -H 'content-type: application/json' \\
  --data '{"appId":"app-123","name":"resume.txt","type":"text/plain","size":5,"contentBase64":"aGVsbG8="}'
```

## Notes

- Backend is source of truth for applications, deleted applications, and deleted files.
- Application deletion is soft-delete in UI (Recently deleted dialog).
- File deletion from an application is soft-delete to Recently deleted Files.
- Purging an app permanently purges that app and currently attached files.
- Data menu includes:
  - API token set/clear
  - Health report
  - Resume template download

## Backups

Create a timestamped local backup of state:

```bash
cd tracker
npm run backup
```

## Ops Checks

Preflight:

```bash
cd tracker
npm run preflight
```

Smoke test:

```bash
cd tracker
npm run smoke
```

Backups are written to:

- `tracker/backups/joblio-data-YYYYMMDD-HHMMSS.tar.gz` (macOS/Linux)
- `tracker/backups/joblio-data-YYYYMMDD-HHMMSS.zip` (Windows)

This archive includes:

- `.joblio-data/state.json`
- `.joblio-data/storage/`
- `.joblio-data/storage-trash/`
- `.joblio-data/logs/`

## Restore

1. Stop the running server.
2. Restore from `tracker/`:

```bash
npm run restore -- --file backups/joblio-data-YYYYMMDD-HHMMSS.tar.gz --yes
```

Windows example:

```bash
npm run restore -- --file backups/joblio-data-YYYYMMDD-HHMMSS.zip --yes
```

3. Start the server again:

```bash
npm start
```
