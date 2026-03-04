# Joblio v1

Joblio is a local-first job application tracker with a hardened backend, built for single-user self-hosted use.

It provides:
- Application tracking with status workflow and history
- Workspace file storage per application
- Soft-delete and trash recovery for applications and files
- Import/export and backup/restore workflows
- Strict authentication and session security defaults

## Contents

1. Overview
2. How Joblio Works
3. Security Model
4. Fast Start (New Users)
5. Production Deployment
6. Docker Deployment
7. Configuration System
8. Environment Variables (Complete Reference)
9. API Behavior and Endpoints
10. Data Storage Layout
11. Backup, Restore, and Validation
12. Operations and Troubleshooting
13. Limits and Current Scope

## Overview

Joblio is a single-process Node.js application:
- Frontend: `Joblio.html` (served by backend)
- Backend: `server.js` (HTTP/HTTPS API + static serving)
- Data directory: `.joblio-data/`

No external database is required. All app state and files are stored on local disk.

## How Joblio Works

Startup flow:
1. `npm start` runs `scripts/start.js`.
2. `start.js` checks for `.joblio-data/config.env`.
3. If config is missing, setup runs automatically.
4. `start.js` loads config, runs preflight checks, and starts `server.js`.

Runtime flow:
- Browser authenticates with Basic Auth.
- Frontend creates API session (`/api/auth/session`).
- API requests use cookie session + CSRF header for write operations.
- State writes are sanitized, snapshot-backed, and persisted atomically.

## Security Model

### Authentication and session controls
- Global Basic Auth gate for all routes when strict mode is enabled.
- API session cookie (`joblio_sid`) is `HttpOnly`, `SameSite=Strict`, and `Secure` when TLS/cookie-secure is enabled.
- CSRF token required on mutating API methods.
- Session binding policy (`strict|ip|ua|off`) configurable.
- Session store encrypted on disk (`sessions.enc`) using API token-derived key.
- Revoke-all endpoint invalidates all active sessions.

### Request and abuse controls
- Origin/referer checks for write requests.
- Per-route family rate limits.
- Request size limits for JSON and uploads.
- Safe path handling and file ID validation.

### Response hardening
- Strict security headers (CSP, frame deny, nosniff, etc.).
- Generic 500 responses by default.
- Public-safe mapping for thrown 4xx errors.

### Local threat model note
Frontend/browser context is untrusted by design. High-value secrets remain server-side only.

## Fast Start (New Users)

Prerequisites:
- Node.js 20+
- macOS, Linux, or Windows

Commands:

macOS/Linux:

```bash
cd tracker
npm run setup
npm start
```

PowerShell:

```powershell
cd tracker
npm run setup
npm start
```

What setup does:
- Prompts for username/password (password entry is hidden)
- Writes `.joblio-data/config.env` with secure defaults
- Stores only password hash (`scrypt$...`), never plaintext password

What startup does:
- Loads config
- Runs preflight validation
- Starts server
- Prints only URL and non-sensitive startup info

## Production Deployment

Use non-interactive setup for deterministic provisioning.

macOS/Linux:

```bash
cd tracker
JOBLIO_SETUP_NON_INTERACTIVE=1 \
JOBLIO_SETUP_FORCE=1 \
JOBLIO_SETUP_USER='joblio' \
JOBLIO_SETUP_PASSWORD='replace-with-strong-password' \
JOBLIO_SETUP_HOST='127.0.0.1' \
JOBLIO_SETUP_PORT='8787' \
JOBLIO_SETUP_ALLOW_REMOTE='0' \
JOBLIO_SETUP_TLS_MODE='require' \
JOBLIO_SETUP_TLS_CERT_PATH='/absolute/path/to/cert.pem' \
JOBLIO_SETUP_TLS_KEY_PATH='/absolute/path/to/key.pem' \
JOBLIO_SETUP_API_TOKEN='replace-with-long-random-token' \
JOBLIO_SETUP_AUDIT_KEY='replace-with-long-random-audit-key' \
npm run setup
```

Then:

```bash
npm run validate:release
npm start
```

PowerShell:

```powershell
cd tracker
$env:JOBLIO_SETUP_NON_INTERACTIVE = "1"
$env:JOBLIO_SETUP_FORCE = "1"
$env:JOBLIO_SETUP_USER = "joblio"
$env:JOBLIO_SETUP_PASSWORD = "replace-with-strong-password"
$env:JOBLIO_SETUP_HOST = "127.0.0.1"
$env:JOBLIO_SETUP_PORT = "8787"
$env:JOBLIO_SETUP_ALLOW_REMOTE = "0"
$env:JOBLIO_SETUP_TLS_MODE = "require"
$env:JOBLIO_SETUP_TLS_CERT_PATH = "C:\\absolute\\path\\to\\cert.pem"
$env:JOBLIO_SETUP_TLS_KEY_PATH = "C:\\absolute\\path\\to\\key.pem"
$env:JOBLIO_SETUP_API_TOKEN = "replace-with-long-random-token"
$env:JOBLIO_SETUP_AUDIT_KEY = "replace-with-long-random-audit-key"
npm run setup
npm run validate:release
npm start
```

Production recommendations:
- Keep `JOBLIO_STRICT_MODE=1`
- Keep `JOBLIO_SESSION_BINDING=strict`
- Keep `JOBLIO_HEALTH_VERBOSE=0`
- Keep `JOBLIO_ERROR_VERBOSE=0`
- Use TLS (`JOBLIO_TLS_MODE=require`)
- Rotate password, API token, and audit key periodically

## Docker Deployment

Files:
- `Dockerfile`
- `docker-compose.yml`

Quick start:
1. Edit `docker-compose.yml` and set a strong `JOBLIO_SETUP_PASSWORD`.
2. Start:

```bash
cd tracker
docker compose up -d --build
```

```powershell
cd tracker
docker compose up -d --build
```

Defaults in compose:
- Host bind: `127.0.0.1:8787`
- Persistent volume: `./docker-data:/app/.joblio-data`
- Non-interactive setup enabled
- Container runs as non-root

For HTTPS in Docker:
- Mount cert/key into container
- Set `JOBLIO_SETUP_TLS_MODE=require`
- Set `JOBLIO_SETUP_TLS_CERT_PATH` and `JOBLIO_SETUP_TLS_KEY_PATH`
- Re-run setup with `JOBLIO_SETUP_FORCE=1`

## Configuration System

Primary config file:
- `.joblio-data/config.env`

Generated by:
- `npm run setup`

Loaded by:
- `npm start`

Precedence at runtime:
1. Values from `.joblio-data/config.env`
2. Process environment overrides config values when both are present

This allows temporary runtime overrides without rewriting config.

## Environment Variables (Complete Reference)

### Setup-time variables (`npm run setup`)

| Variable | Default | Purpose |
|---|---|---|
| `JOBLIO_SETUP_NON_INTERACTIVE` | `0` | Disable prompts; require env inputs |
| `JOBLIO_SETUP_FORCE` | `0` | Regenerate config even if existing |
| `JOBLIO_SETUP_USER` | `joblio` | Basic Auth username |
| `JOBLIO_SETUP_PASSWORD` | none | Basic Auth password (required for non-interactive) |
| `JOBLIO_SETUP_HOST` | `127.0.0.1` | Server bind host written to config |
| `JOBLIO_SETUP_PORT` | `8787` | Server port written to config |
| `JOBLIO_SETUP_ALLOW_REMOTE` | `0` | Write remote bind allowance (`0` or `1`) |
| `JOBLIO_SETUP_TLS_MODE` | `off` or `require` if local TLS files exist | TLS mode to write (`off|on|require`) |
| `JOBLIO_SETUP_TLS_CERT_PATH` | `.joblio-data/tls/localhost-cert.pem` | TLS cert path written to config |
| `JOBLIO_SETUP_TLS_KEY_PATH` | `.joblio-data/tls/localhost-key.pem` | TLS key path written to config |
| `JOBLIO_SETUP_API_TOKEN` | random 32-byte hex | API/session crypto secret |
| `JOBLIO_SETUP_AUDIT_KEY` | random 32-byte hex | Audit-chain HMAC key |

### Runtime variables (`server.js`)

| Variable | Default | Purpose |
|---|---|---|
| `HOST` | `127.0.0.1` | Bind host |
| `PORT` | `8787` | Bind port |
| `JOBLIO_STRICT_MODE` | `1` | Enable strict auth policy |
| `JOBLIO_ALLOW_REMOTE` | `0` | Allow non-local bind |
| `JOBLIO_API_TOKEN` | none | Session signing + encryption secret |
| `JOBLIO_BASIC_AUTH_USER` | none | Basic Auth username |
| `JOBLIO_BASIC_AUTH_HASH` | none | Basic Auth password hash (`scrypt$...`) |
| `JOBLIO_AUDIT_KEY` | empty | Audit chain HMAC key |
| `JOBLIO_TLS_MODE` | `off` | `off`, `on`, or `require` |
| `JOBLIO_TLS_CERT_PATH` | empty | TLS cert path |
| `JOBLIO_TLS_KEY_PATH` | empty | TLS key path |
| `JOBLIO_COOKIE_SECURE` | `0` | Force `Secure` cookie attribute |
| `JOBLIO_SESSION_BINDING` | `strict` | `strict`, `ip`, `ua`, or `off` |
| `SESSION_TTL_MS` | `28800000` | Session idle timeout |
| `SESSION_ABS_TTL_MS` | `86400000` | Session absolute timeout |
| `MAX_JSON_BODY_BYTES` | `5242880` | Max JSON request size |
| `MAX_UPLOAD_JSON_BYTES` | `36700160` | Max upload request size |
| `MAX_FILE_BYTES` | `26214400` | Max decoded upload file size |
| `MAX_APPS` | `10000` | Max apps per active/trash section |
| `MAX_SNAPSHOTS` | `20` | Snapshot retention count |
| `LOG_ROTATE_BYTES` | `5242880` | Activity log rotation threshold |
| `PURGE_MIN_AGE_SEC` | `120` | Minimum trash age before permanent purge |
| `RATE_WINDOW_MS` | `60000` | Rate-limit window size |
| `RATE_MAX_WRITE` | `180` | Write requests per window |
| `RATE_MAX_UPLOAD` | `24` | Upload requests per window |
| `RATE_MAX_DELETE` | `120` | Delete requests per window |
| `RATE_MAX_IMPORT` | `10` | Import requests per window |
| `JOBLIO_HEALTH_VERBOSE` | `0` | Allow verbose health details by config |
| `JOBLIO_ERROR_VERBOSE` | `0` | Include internal error details on 500 responses |

### Test/validation variables

| Variable | Default | Purpose |
|---|---|---|
| `SMOKE_PORT` | `8799` | Smoke test server port |
| `SMOKE_TOKEN` | `smoke-token-123` | Smoke test API token |
| `SMOKE_BASIC_USER` | `smoke-user` | Smoke test auth username |
| `SMOKE_BASIC_PASS` | `smoke-pass` | Smoke test auth password |

## API Behavior and Endpoints

### Authentication flow
1. Browser sends Basic Auth credentials.
2. Frontend creates API session: `POST /api/auth/session`.
3. Session cookie + CSRF protect API requests.

### Endpoint groups

Auth/session:
- `POST /api/auth/session`
- `POST /api/auth/logout`
- `POST /api/auth/revoke-all`

State/health:
- `GET /api/state`
- `PUT /api/state`
- `GET /api/health`
- `GET /api/health?verbose=1`
- `GET /api/integrity/verify`

Files:
- `POST /api/files/upload`
- `GET /api/files/:fileId/download`
- `DELETE /api/files/:fileId`
- `POST /api/files/:fileId/restore`
- `DELETE /api/files/:fileId/purge`

Data/template:
- `GET /api/export`
- `POST /api/import`
- `GET /api/template/resume`

### Request security rules
- All routes require Basic Auth in strict mode.
- All `/api/*` routes require valid API session cookie.
- Write methods require CSRF token header (`X-Joblio-CSRF`).
- Write methods enforce origin/referer validation.

### Error behavior
- 500 responses: generic unless `JOBLIO_ERROR_VERBOSE=1`.
- 4xx thrown errors: mapped to safe public messages.
- Frontend displays API error messages as plain text (not HTML).

## Data Storage Layout

Under `.joblio-data/`:
- `config.env` (generated runtime config)
- `state.json` (main persisted state)
- `storage/` (live workspace files)
- `storage-trash/` (soft-deleted file content)
- `snapshots/` (state rollback snapshots)
- `logs/activity.log` (event log)
- `logs/activity.log.1` (rotated log)
- `logs/audit-chain.json` (audit chain metadata)
- `sessions.enc` (encrypted session store)

## Backup, Restore, and Validation

Commands:

```bash
npm run backup
npm run restore -- --file <backup-file> --yes
npm run preflight
npm run test:security
npm run smoke
npm run validate:release
```

```powershell
npm run backup
npm run restore -- --file <backup-file> --yes
npm run preflight
npm run test:security
npm run smoke
npm run validate:release
```

`validate:release` runs:
1. preflight
2. security unit tests
3. smoke test
4. backup

## Operations and Troubleshooting

### Setup issues
- If setup already ran and you need to regenerate config:

```bash
JOBLIO_SETUP_FORCE=1 npm run setup
```

```powershell
$env:JOBLIO_SETUP_FORCE = "1"
npm run setup
```

- For CI/container setup, use non-interactive mode and provide required setup env vars.

### TLS issues
- Generate local TLS cert/key:

```bash
npm run tls:gen
```

- Then rerun setup with TLS vars and force.

### Login/session issues
- Clear all active API sessions from UI (Revoke all sessions), or restart after rotating config secrets.
- If session store is corrupt, backend auto-recovers and rotates epoch.

### Smoke test in restricted environments
Some sandboxes block local listen sockets; smoke may be skipped with a clear message.

## Limits and Current Scope

- Single-user, local/self-hosted first.
- No external identity provider integration.
- No multi-tenant isolation model.
- Frontend and browser runtime are not trusted security boundaries.

## Script Index

- `scripts/setup.js`: one-time config generation
- `scripts/start.js`: unified startup orchestration
- `scripts/preflight.js`: startup validation
- `scripts/gen-auth-hash.js`: generate password hash
- `scripts/gen-local-tls.js`: local TLS cert helper
- `scripts/security-tests.js`: auth/hash unit tests
- `scripts/smoke-test.js`: integration checks
- `scripts/backup.js`: backup data
- `scripts/restore.js`: restore backup
- `scripts/validate-release.js`: full release gate runner
