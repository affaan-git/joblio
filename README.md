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

- `tracker/backups/state-YYYYMMDD-HHMMSS.json`
