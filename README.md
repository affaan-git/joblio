# Joblio v1 (Local, Hardened)

Joblio is a local-first job application tracker with a secure backend (strict auth, session cookies, CSRF, rate limits, audit chain, snapshots, and optional TLS).

## Quick Start

### Recommended (cross-platform, secure defaults)

```bash
cd tracker
npm run start:secure
```

This command:
- Generates secure defaults if missing:
  - `JOBLIO_API_TOKEN`
  - `JOBLIO_BASIC_AUTH_USER`
  - `JOBLIO_BASIC_AUTH_PASS`
- Forces strict mode defaults
- Runs preflight checks
- Starts the server

Then:
1. Open the printed URL (default `http://127.0.0.1:8787`)
2. Sign in with browser Basic Auth prompt
3. The frontend auto-creates a backend API session (no frontend secret storage required)

### Manual Start

```bash
cd tracker
JOBLIO_API_TOKEN='set-a-long-random-secret' \
JOBLIO_BASIC_AUTH_USER='joblio' \
JOBLIO_BASIC_AUTH_PASS='set-a-strong-password' \
npm start
```

## Authentication Model

### Layer 1: Global Basic Auth
- Required for all routes in strict mode (`JOBLIO_STRICT_MODE=1`, default).
- Protects static UI + API.

### Layer 2: API Session (HttpOnly cookie)
- Frontend calls `POST /api/auth/session` after page load.
- Server sets `joblio_sid` cookie with:
  - `HttpOnly`
  - `SameSite=Strict`
  - `Secure` when HTTPS is enabled
- All API endpoints require valid session.

### Layer 3: CSRF protection
- Mutating methods (`POST/PUT/PATCH/DELETE`) require `X-Joblio-CSRF`.
- CSRF token comes from `POST /api/auth/session` response.

## Transport Security (Optional TLS)

### Enable HTTPS

```bash
JOBLIO_TLS_MODE=on \
JOBLIO_TLS_CERT_PATH=/absolute/path/to/cert.pem \
JOBLIO_TLS_KEY_PATH=/absolute/path/to/key.pem \
npm run start:secure
```

### Enforce HTTPS-only startup

```bash
JOBLIO_TLS_MODE=require \
JOBLIO_TLS_CERT_PATH=/absolute/path/to/cert.pem \
JOBLIO_TLS_KEY_PATH=/absolute/path/to/key.pem \
npm run start:secure
```

When HTTPS is active:
- `Strict-Transport-Security` header is set
- Session cookie includes `Secure`

## NPM Scripts

```bash
npm run preflight     # Validate env + hardening config before start
npm start             # preflight + server start
npm run start:secure  # Cross-platform secure startup helper
npm run smoke         # API smoke checks (auth/session/CSRF/core flows)
npm run backup        # Cross-platform backup
npm run restore -- --file <backup-file> --yes
```

## Environment Variables

### Required in strict mode (default)

| Variable | Default | Required | Purpose |
|---|---:|---:|---|
| `JOBLIO_STRICT_MODE` | `1` (enabled unless set to `0`) | Yes (implicitly) | Enables strict auth/startup policies |
| `JOBLIO_API_TOKEN` | none | Yes | Backend secret used for session signing/HMAC |
| `JOBLIO_BASIC_AUTH_USER` | none | Yes | Browser Basic Auth username |
| `JOBLIO_BASIC_AUTH_PASS` | none | Yes | Browser Basic Auth password |

### Host / transport

| Variable | Default | Purpose |
|---|---:|---|
| `HOST` | `127.0.0.1` | Bind address |
| `PORT` | `8787` | Bind port |
| `JOBLIO_ALLOW_REMOTE` | `0` | Allow non-local bind when set to `1` |
| `JOBLIO_TLS_MODE` | `off` | `off`, `on`, or `require` |
| `JOBLIO_TLS_CERT_PATH` | empty | TLS cert path for HTTPS |
| `JOBLIO_TLS_KEY_PATH` | empty | TLS key path for HTTPS |
| `JOBLIO_COOKIE_SECURE` | `0` | Force `Secure` cookie (normally auto when TLS active) |

### Limits and hardening

| Variable | Default | Purpose |
|---|---:|---|
| `MAX_JSON_BODY_BYTES` | `5242880` | Max JSON request size |
| `MAX_UPLOAD_JSON_BYTES` | `36700160` | Max upload payload JSON size |
| `MAX_FILE_BYTES` | `26214400` | Max decoded uploaded file bytes |
| `MAX_APPS` | `10000` | Max apps allowed per state section |
| `RATE_WINDOW_MS` | `60000` | Rate limit window |
| `RATE_MAX_WRITE` | `180` | Write requests/window |
| `RATE_MAX_UPLOAD` | `24` | Upload requests/window |
| `RATE_MAX_DELETE` | `120` | Delete requests/window |
| `RATE_MAX_IMPORT` | `10` | Import requests/window |
| `PURGE_MIN_AGE_SEC` | `120` | Min trash age before permanent file purge |
| `LOG_ROTATE_BYTES` | `5242880` | Rotate `activity.log` at this size |
| `MAX_SNAPSHOTS` | `20` | Snapshot retention count |
| `SESSION_TTL_MS` | `28800000` | Session idle timeout |
| `SESSION_ABS_TTL_MS` | `86400000` | Absolute max session lifetime |

### Diagnostics and audit

| Variable | Default | Purpose |
|---|---:|---|
| `JOBLIO_AUDIT_KEY` | empty | Optional HMAC key for audit-chain hashes |
| `JOBLIO_HEALTH_VERBOSE` | `0` | Allow verbose health by config |
| `JOBLIO_ERROR_VERBOSE` | `0` | Include server error detail in 500 responses |

### Smoke-test helper vars (test only)

| Variable | Default | Purpose |
|---|---:|---|
| `SMOKE_PORT` | `8799` | Port used by smoke test |
| `SMOKE_TOKEN` | `smoke-token-123` | Backend signing secret for smoke run |
| `SMOKE_BASIC_USER` | `smoke-user` | Basic auth user for smoke run |
| `SMOKE_BASIC_PASS` | `smoke-pass` | Basic auth pass for smoke run |

## API Endpoints

### Auth/session
- `POST /api/auth/session`
  - Creates/refreshes session cookie
  - Returns CSRF token for mutating requests
- `POST /api/auth/logout`
  - Invalidates session and clears cookie

### State and health
- `GET /api/state`
- `PUT /api/state` with `{ "state": { ... } }`
- `GET /api/health`
- `GET /api/health?verbose=1`
- `GET /api/integrity/verify`

### Files
- `POST /api/files/upload` with `{ appId, name, type, size, contentBase64 }`
- `GET /api/files/:fileId/download`
- `DELETE /api/files/:fileId`
- `POST /api/files/:fileId/restore`
- `DELETE /api/files/:fileId/purge`

### Import/export/template
- `GET /api/export`
- `POST /api/import`
- `GET /api/template/resume`

## cURL Example (session + CSRF)

```bash
# 1) Create session (captures cookie and csrf token)
SESSION_JSON=$(curl -s -c cookie.txt -u 'joblio:your-basic-auth-pass' \
  -X POST http://127.0.0.1:8787/api/auth/session \
  -H 'content-type: application/json' \
  --data '{}')

# 2) Extract csrf token (example uses jq)
CSRF=$(echo "$SESSION_JSON" | jq -r '.csrfToken')

# 3) Read state
curl -s -b cookie.txt http://127.0.0.1:8787/api/state

# 4) Write state
curl -s -X PUT http://127.0.0.1:8787/api/state \
  -u 'joblio:your-basic-auth-pass' \
  -b cookie.txt \
  -H "x-joblio-csrf: $CSRF" \
  -H 'content-type: application/json' \
  --data '{"state":{"version":1,"theme":"dark","activeId":null,"apps":[],"trashApps":[],"trashFiles":[]}}'
```

## Data Storage

Stored under `tracker/.joblio-data/`:
- `state.json`
- `storage/`
- `storage-trash/`
- `snapshots/`
- `logs/activity.log`
- `logs/activity.log.1` (rotation)
- `logs/audit-chain.json`

## Backups and Restore

### Backup

```bash
cd tracker
npm run backup
```

Output:
- macOS/Linux: `backups/joblio-data-YYYYMMDD-HHMMSS.tar.gz`
- Windows: `backups/joblio-data-YYYYMMDD-HHMMSS.zip`

### Restore

```bash
cd tracker
npm run restore -- --file backups/joblio-data-YYYYMMDD-HHMMSS.tar.gz --yes
# Windows example:
# npm run restore -- --file backups/joblio-data-YYYYMMDD-HHMMSS.zip --yes
```

## Security Features Implemented

- Strict-by-default startup policy
- Global Basic Auth
- HttpOnly session cookies + CSRF
- Same-origin checks on mutating requests
- Input validation and ID normalization
- Path traversal defenses for file storage paths
- Request size limits and decoded file-size limits
- Per-route/per-IP rate limiting
- Audit logging with chained hashes (+ optional HMAC)
- Rolling state snapshots + recovery path
- Log rotation
- Security headers (CSP, frame deny, nosniff, referrer policy, etc.)
- Optional TLS + HSTS

## UI Notes

- Health indicator is clickable and opens backend health dialog.
- Data menu includes:
  - Resume template download
  - Import/export
- No API secret is stored in frontend localStorage.

## Verification Checklist

Run:

```bash
cd tracker
npm run preflight
npm run smoke
npm run backup
```

Then manually verify in browser:
1. Basic Auth prompt appears and protects access.
2. App loads and backend health becomes Online.
3. Create/edit/delete/restore app flow works.
4. Upload/delete/restore/purge file flow works (respecting purge delay).
5. Health dialog loads and shows expected diagnostics.
6. Resume template download works.
