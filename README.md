# Joblio v1 (Local, Maximum Lockdown)

Joblio is a local-first job application tracker with a hardened backend: strict startup policy, global auth, session cookies + CSRF, rate limiting, audit-chain logging, snapshots/recovery, optional TLS, and cross-platform ops scripts.

## Quick Start

### Recommended (cross-platform secure start)

```bash
cd tracker
npm run start:secure
```

What `start:secure` does:
- Generates `JOBLIO_API_TOKEN` if missing.
- Generates Basic Auth password hash (`JOBLIO_BASIC_AUTH_HASH`) if missing.
- Sets strict defaults and runs preflight.
- Starts server and prints browser login credentials.
- If local TLS certs exist under `.joblio-data/tls/`, auto-switches to `JOBLIO_TLS_MODE=require`.

Then:
1. Open the printed URL.
2. Sign in via browser Basic Auth prompt.
3. Frontend auto-creates API session (`/api/auth/session`).

### Manual Start

```bash
cd tracker
JOBLIO_API_TOKEN='set-a-long-random-secret' \
JOBLIO_BASIC_AUTH_USER='joblio' \
JOBLIO_BASIC_AUTH_HASH='scrypt$...' \
npm start
```

Generate Basic Auth hash:

```bash
npm run auth:hash -- --password 'your-strong-password'
```

## Authentication and Session Security

### Layer 1: Global Basic Auth
- Required for all routes in strict mode (default).
- Protects UI + all backend endpoints.

### Layer 2: API Session Cookie
- `POST /api/auth/session` issues `joblio_sid` cookie.
- Cookie attributes:
  - `HttpOnly`
  - `SameSite=Strict`
  - `Secure` when HTTPS active (or `JOBLIO_COOKIE_SECURE=1`)
- All `/api/*` endpoints require valid session.

### Layer 3: CSRF
- Mutating API methods (`POST/PUT/PATCH/DELETE`) require `X-Joblio-CSRF`.
- CSRF token returned by `/api/auth/session`.

### Session controls
- Idle timeout + absolute timeout enforced.
- Configurable binding policy (`JOBLIO_SESSION_BINDING`): `strict|ip|ua|off`.
- Session persistence encrypted on disk (`.joblio-data/sessions.enc`).
- Admin action available: revoke all sessions.

## Transport Security (TLS)

Generate local cert/key (OpenSSL required):

```bash
npm run tls:gen
```

Enable HTTPS:

```bash
JOBLIO_TLS_MODE=on \
JOBLIO_TLS_CERT_PATH=/absolute/path/to/cert.pem \
JOBLIO_TLS_KEY_PATH=/absolute/path/to/key.pem \
npm run start:secure
```

Require HTTPS-only startup:

```bash
JOBLIO_TLS_MODE=require \
JOBLIO_TLS_CERT_PATH=/absolute/path/to/cert.pem \
JOBLIO_TLS_KEY_PATH=/absolute/path/to/key.pem \
npm run start:secure
```

When HTTPS is active:
- HSTS header is set.
- Session cookie uses `Secure`.

## Scripts

```bash
npm run preflight           # config validation
npm start                   # preflight + server
npm run start:secure        # secure helper startup
npm run auth:hash -- --password '<password>'
npm run tls:gen             # generate local TLS cert/key (OpenSSL)
npm run test:security       # deterministic unit security tests
npm run validate:release    # preflight + security tests + smoke + backup
npm run smoke               # integration smoke checks
npm run backup              # cross-platform backup
npm run restore -- --file <backup-file> --yes
```

## Environment Variables

### Required in strict mode (default)

| Variable | Default | Required | Purpose |
|---|---:|---:|---|
| `JOBLIO_STRICT_MODE` | `1` (unless set `0`) | Yes (implicitly) | Enable strict policies |
| `JOBLIO_API_TOKEN` | none | Yes | Backend secret for session signing + crypto |
| `JOBLIO_BASIC_AUTH_USER` | none | Yes | Basic Auth username |
| `JOBLIO_BASIC_AUTH_HASH` | none | Yes | Hashed Basic Auth password (`scrypt$...`) |

Notes:
- `JOBLIO_BASIC_AUTH_PASS` is ignored by server (legacy input only for helper scripts).

### Host / network / TLS

| Variable | Default | Purpose |
|---|---:|---|
| `HOST` | `127.0.0.1` | Bind address |
| `PORT` | `8787` | Bind port |
| `JOBLIO_ALLOW_REMOTE` | `0` | Allow non-local bind (`1` to allow) |
| `JOBLIO_TLS_MODE` | `off` | `off`, `on`, `require` |
| `JOBLIO_TLS_CERT_PATH` | empty | Path to TLS cert |
| `JOBLIO_TLS_KEY_PATH` | empty | Path to TLS key |
| `JOBLIO_COOKIE_SECURE` | `0` | Force secure cookies even without TLS detection |

### Request/session/abuse limits

| Variable | Default | Purpose |
|---|---:|---|
| `MAX_JSON_BODY_BYTES` | `5242880` | Max JSON request body |
| `MAX_UPLOAD_JSON_BYTES` | `36700160` | Max upload JSON request body |
| `MAX_FILE_BYTES` | `26214400` | Max decoded file upload size |
| `MAX_APPS` | `10000` | Max apps in each state section |
| `RATE_WINDOW_MS` | `60000` | Rate limit window |
| `RATE_MAX_WRITE` | `180` | Writes per window |
| `RATE_MAX_UPLOAD` | `24` | Uploads per window |
| `RATE_MAX_DELETE` | `120` | Deletes per window |
| `RATE_MAX_IMPORT` | `10` | Imports per window |
| `PURGE_MIN_AGE_SEC` | `120` | Min trash age before file purge |
| `SESSION_TTL_MS` | `28800000` | Session idle timeout |
| `SESSION_ABS_TTL_MS` | `86400000` | Session absolute lifetime |
| `JOBLIO_SESSION_BINDING` | `strict` | Session binding policy (`strict|ip|ua|off`) |

### Persistence / diagnostics

| Variable | Default | Purpose |
|---|---:|---|
| `MAX_SNAPSHOTS` | `20` | Snapshot retention count |
| `LOG_ROTATE_BYTES` | `5242880` | `activity.log` rotation threshold |
| `JOBLIO_AUDIT_KEY` | empty | Optional HMAC key for audit chain |
| `JOBLIO_HEALTH_VERBOSE` | `0` | Allow verbose health by config |
| `JOBLIO_ERROR_VERBOSE` | `0` | Include internal error details in 500s |

### Smoke test vars (test only)

| Variable | Default | Purpose |
|---|---:|---|
| `SMOKE_PORT` | `8799` | Smoke-test server port |
| `SMOKE_TOKEN` | `smoke-token-123` | Smoke run signing secret |
| `SMOKE_BASIC_USER` | `smoke-user` | Smoke basic auth user |
| `SMOKE_BASIC_PASS` | `smoke-pass` | Smoke basic auth password |

## API Endpoints

### Auth/session
- `POST /api/auth/session`
- `POST /api/auth/logout`
- `POST /api/auth/revoke-all`

### State/health
- `GET /api/state`
- `PUT /api/state`
- `GET /api/health`
- `GET /api/health?verbose=1`
- `GET /api/integrity/verify`

### Files
- `POST /api/files/upload`
- `GET /api/files/:fileId/download`
- `DELETE /api/files/:fileId`
- `POST /api/files/:fileId/restore`
- `DELETE /api/files/:fileId/purge`

### Import/export/template
- `GET /api/export`
- `POST /api/import`
- `GET /api/template/resume`

## cURL Session + CSRF Example

```bash
# 1) Create session (cookie + csrf token)
SESSION_JSON=$(curl -s -c cookie.txt -u 'joblio:your-basic-auth-pass' \
  -X POST http://127.0.0.1:8787/api/auth/session \
  -H 'content-type: application/json' \
  --data '{}')

# 2) Parse csrf token (jq example)
CSRF=$(echo "$SESSION_JSON" | jq -r '.csrfToken')

# 3) Read
curl -s -b cookie.txt http://127.0.0.1:8787/api/state

# 4) Write
curl -s -X PUT http://127.0.0.1:8787/api/state \
  -u 'joblio:your-basic-auth-pass' \
  -b cookie.txt \
  -H "x-joblio-csrf: $CSRF" \
  -H 'content-type: application/json' \
  --data '{"state":{"version":1,"theme":"dark","activeId":null,"apps":[],"trashApps":[],"trashFiles":[]}}'
```

## Data on Disk

Under `tracker/.joblio-data/`:
- `state.json`
- `storage/`
- `storage-trash/`
- `snapshots/`
- `logs/activity.log`
- `logs/activity.log.1`
- `logs/audit-chain.json`
- `sessions.enc` (encrypted session store)

## Backup / Restore

Backup:

```bash
cd tracker
npm run backup
```

Output:
- macOS/Linux: `backups/joblio-data-YYYYMMDD-HHMMSS.tar.gz`
- Windows: `backups/joblio-data-YYYYMMDD-HHMMSS.zip`

Restore:

```bash
cd tracker
npm run restore -- --file backups/joblio-data-YYYYMMDD-HHMMSS.tar.gz --yes
# Windows example:
# npm run restore -- --file backups/joblio-data-YYYYMMDD-HHMMSS.zip --yes
```

## UI Notes

- Health indicator is clickable and opens backend health dialog.
- Data menu includes:
  - Revoke all sessions
  - Resume template download
  - Import/export
- Frontend does not store API secret tokens in localStorage.

## Verification Checklist

```bash
cd tracker
npm run preflight
npm run test:security
npm run smoke
npm run backup
```

Single-command release validation:

```bash
cd tracker
npm run validate:release
```

Manual browser checks:
1. Basic Auth prompt appears and blocks unauthorized access.
2. App reaches Online backend state after login.
3. CRUD flows work (app + file + trash/restore).
4. Revoke-all-sessions forces re-authentication.
5. Health dialog loads and shows expected diagnostics.
6. Resume template download works.
