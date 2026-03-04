# Joblio v1 (Local)

## Run

```bash
cd tracker
npm start
```

Then open: `http://127.0.0.1:8787`

## What v1 backend stores

- Tracker state on disk: `.joblio-data/state.json`
- Uploaded files on disk: `.joblio-data/storage/<appId>/...`
- Activity log: `.joblio-data/logs/activity.log`

## Security Hardening (v1)

- All write endpoints enforce same-origin checks (`Origin`/`Referer` host must match server host when present).
- Optional write auth token:
  - Set `JOBLIO_API_TOKEN=your-secret-token` before `npm start`
  - Client sends token using `localStorage["joblio-api-token"]`
  - Mutating API calls (`POST`/`PUT`/`DELETE`) require header `X-Joblio-Token`
- Request/body limits are enforced server-side:
  - `MAX_JSON_BODY_BYTES` (default 5 MB)
  - `MAX_UPLOAD_JSON_BYTES` (default 35 MB)
  - `MAX_FILE_BYTES` (default 25 MB decoded file bytes)
  - `MAX_APPS` (default 10000)
- Storage safety:
  - IDs are validated
  - File paths are resolved and constrained to app/trash storage roots
- Response hardening headers are set (CSP, frame deny, nosniff, no-referrer, permissions policy).
- Log rotation:
  - `activity.log` rotates to `activity.log.1` at `LOG_ROTATE_BYTES` (default 5 MB).
- Health endpoint details are minimal by default; set `JOBLIO_HEALTH_VERBOSE=1` for diagnostics.
- `500` responses are generic by default; set `JOBLIO_ERROR_VERBOSE=1` for local debug details.

## API

- `GET /api/state`
- `PUT /api/state` with `{ "state": { ... } }`
- `GET /api/health`
- `POST /api/files/upload` with `{ appId, name, type, size, contentBase64 }`
- `DELETE /api/files/:fileId`
- `POST /api/files/:fileId/restore`
- `DELETE /api/files/:fileId/purge`
- `GET /api/files/:fileId/download`
- `GET /api/export`
- `POST /api/import`

### API Examples

Get state:

```bash
curl -s http://127.0.0.1:8787/api/state
```

Save state:

```bash
curl -s -X PUT http://127.0.0.1:8787/api/state \\
  -H 'content-type: application/json' \\
  --data '{"state":{"version":1,"theme":"dark","activeId":null,"apps":[],"trashApps":[],"trashFiles":[]}}'
```

Upload file:

```bash
curl -s -X POST http://127.0.0.1:8787/api/files/upload \\
  -H 'content-type: application/json' \\
  --data '{"appId":"app-123","name":"resume.txt","type":"text/plain","size":5,"contentBase64":"aGVsbG8="}'
```

## Notes

- Backend is source of truth for applications, deleted applications, and deleted files.
- Application deletion is soft-delete in UI (Recently deleted dialog).
- File deletion from an application is soft-delete to Recently deleted Files.
- Purging an app permanently purges that app and currently attached files.

## Backups

Create a timestamped local backup of state:

```bash
cd tracker
npm run backup
```

Backups are written to:

- `tracker/backups/joblio-data-YYYYMMDD-HHMMSS.tar.gz`

This archive includes:

- `.joblio-data/state.json`
- `.joblio-data/storage/`
- `.joblio-data/storage-trash/`
- `.joblio-data/logs/`

## Restore

1. Stop the running server.
2. From `tracker/`, extract a backup:

```bash
tar -xzf backups/joblio-data-YYYYMMDD-HHMMSS.tar.gz
```

3. Start the server again:

```bash
npm start
```
