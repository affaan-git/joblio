# Joblio v1

Joblio is a local-first, single-user job application tracker with a hardened backend and local disk persistence.

## Quick Copy-Paste

### macOS/Linux

```bash
cd tracker
npm run setup
npm start
```

### Windows PowerShell

```powershell
cd tracker
npm run setup
npm start
```

Reconfigure later (both platforms):

```bash
npm run reconfigure
```

Docker (all platforms, first-time setup + run):

```bash
cd tracker
docker compose build
docker compose run --rm -it joblio npm run setup
docker compose up -d
```

## What Joblio Does

- Tracks job applications and status updates
- Stores per-application workspace files
- Supports trash/restore/purge flows for apps and files
- Supports import/export of tracker state
- Supports backup/restore of on-disk data
- Enforces strict auth/session/CSRF/security headers/rate limits

## Architecture

- Frontend: `Joblio.html`
- Backend: `server.js` (serves UI and API)
- Scripts: `scripts/`
- Data directory: `.joblio-data/`

Single-process Node.js app. No external database required.

## Startup Model

1. `npm run setup` (interactive only)
2. `npm start`

`npm start` behavior:
- Loads `.joblio-data/config.env`
- Runs preflight validation
- Starts backend server

If config is missing and startup is interactive, setup is launched automatically.
If config is missing and startup is non-interactive, startup fails with guidance.

## Security Model

### Authentication

- Global Basic Auth (strict mode)
- API session cookie (`joblio_sid`) required for `/api/*`
- Session cookie attributes:
  - `HttpOnly`
  - `SameSite=Strict`
  - `Secure` when TLS/cookie-secure enabled

### CSRF

- Required on all write methods (`POST`, `PUT`, `PATCH`, `DELETE`)
- Header: `X-Joblio-CSRF`

### Session hardening

- Idle timeout + absolute timeout
- Session binding mode (`strict`, `ip`, `ua`, `off`)
- Encrypted on-disk session store (`sessions.enc`)
- Global revoke-all sessions endpoint

### Request hardening

- Origin/referer checks on writes
- Rate limiting by route family
- Request size limits
- Safe file/path/id validation

### Response hardening

- Security headers (CSP, frame deny, nosniff, etc.)
- Generic 500 errors unless verbose mode explicitly enabled
- Public-safe mapping of thrown 4xx errors

### Trust boundary

Anything in browser memory/UI is untrusted. High-value secrets remain server-side.

## Interactive Setup (Detailed)

Run:

```bash
npm run setup
```

Setup prompts for:
- Basic Auth username
- Basic Auth password (hidden; confirmation required)
- Host
- Port
- Allow remote binding (yes/no)
- TLS mode (`off`, `on`, `require`)
- TLS cert path
- TLS key path

Setup output:
- Writes `.joblio-data/config.env`
- Stores password hash only (`scrypt$...`), never plaintext
- Generates strong random values for:
  - `JOBLIO_API_TOKEN`
  - `JOBLIO_AUDIT_KEY`

Setup file permissions:
- Attempts restrictive permissions (`0600`) on config file

Updating existing config:
- Running setup again prompts whether to update existing config
- `npm run reconfigure` opens edit flow directly for existing config

## Production Deployment

### Host install

1. Ensure TLS cert/key paths are available.
2. Run interactive setup and choose secure values.
3. Start service.
4. Run validation suite.

Commands (same on macOS/Linux/Windows PowerShell):

```bash
cd tracker
npm run setup
npm start
npm run validate:release
```

Recommended production choices during setup:
- Host: `127.0.0.1` (or explicit private interface if required)
- Allow remote binding: `No` unless required
- TLS mode: `require`
- Strong password (12+ chars minimum; longer recommended)

## Docker Deployment

Files:
- `Dockerfile`
- `docker-compose.yml`

First-time container setup:

```bash
cd tracker
docker compose build
docker compose run --rm -it joblio npm run setup
```

Important for Docker setup prompts:
- Set host to `0.0.0.0`
- Set allow remote binding to `Yes`
- Use TLS settings appropriate for containerized cert paths if enabling HTTPS

Start service:

```bash
docker compose up -d
```

Persistent data:
- Mounted at `tracker/docker-data` -> `/app/.joblio-data`

Container security:
- Runs as non-root user
- Only loopback host port is exposed by default in compose (`127.0.0.1:8787:8787`)

## Configuration Reference (`.joblio-data/config.env`)

These keys are written by setup and used at runtime.

| Key | Default | Purpose |
|---|---|---|
| `HOST` | `127.0.0.1` | Bind host |
| `PORT` | `8787` | Bind port |
| `JOBLIO_ALLOW_REMOTE` | `0` | Allow non-local bind |
| `JOBLIO_STRICT_MODE` | `1` | Enforce strict auth |
| `JOBLIO_API_TOKEN` | random | Session signing/encryption secret |
| `JOBLIO_BASIC_AUTH_USER` | `joblio` | Basic Auth username |
| `JOBLIO_BASIC_AUTH_HASH` | generated | `scrypt$...` password hash |
| `JOBLIO_AUDIT_KEY` | random | Audit-chain HMAC key |
| `JOBLIO_TLS_MODE` | `off` (or selected) | `off`, `on`, `require` |
| `JOBLIO_TLS_CERT_PATH` | `.joblio-data/tls/localhost-cert.pem` | TLS cert path |
| `JOBLIO_TLS_KEY_PATH` | `.joblio-data/tls/localhost-key.pem` | TLS key path |
| `JOBLIO_COOKIE_SECURE` | `0` when TLS off, else `1` | Force `Secure` cookie attribute |
| `JOBLIO_SESSION_BINDING` | `strict` | Session binding policy |
| `JOBLIO_HEALTH_VERBOSE` | `0` | Verbose health policy |
| `JOBLIO_ERROR_VERBOSE` | `0` | Internal error detail policy |

Runtime override policy:
- Joblio locks these config keys from runtime environment overrides in `npm start`.
- Source of truth is the config file.

## Runtime Limits and Tunables

These are server-supported keys (advanced operations). They are not currently prompted in setup.

| Key | Default | Purpose |
|---|---|---|
| `MAX_JSON_BODY_BYTES` | `5242880` | Max JSON body size |
| `MAX_UPLOAD_JSON_BYTES` | `36700160` | Max upload payload size |
| `MAX_FILE_BYTES` | `26214400` | Max decoded file upload size |
| `MAX_APPS` | `10000` | Max app count per section |
| `MAX_SNAPSHOTS` | `20` | Snapshot retention count |
| `LOG_ROTATE_BYTES` | `5242880` | Activity log rotate threshold |
| `PURGE_MIN_AGE_SEC` | `120` | Minimum trash age before purge |
| `RATE_WINDOW_MS` | `60000` | Rate-limit window |
| `RATE_MAX_WRITE` | `180` | Write limit per window |
| `RATE_MAX_UPLOAD` | `24` | Upload limit per window |
| `RATE_MAX_DELETE` | `120` | Delete limit per window |
| `RATE_MAX_IMPORT` | `10` | Import limit per window |
| `SESSION_TTL_MS` | `28800000` | Session idle timeout |
| `SESSION_ABS_TTL_MS` | `86400000` | Session absolute timeout |

## API Endpoints

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

## Data Layout

Under `.joblio-data/`:
- `config.env`
- `state.json`
- `storage/`
- `storage-trash/`
- `snapshots/`
- `logs/activity.log`
- `logs/activity.log.1`
- `logs/audit-chain.json`
- `sessions.enc`

## Commands

Core:

```bash
npm run setup
npm run reconfigure
npm start
```

Validation/ops:

```bash
npm run preflight
npm run test:security
npm run smoke
npm run validate:release
npm run backup
npm run restore -- --file <backup-file> --yes
npm run tls:gen
```

## Troubleshooting

Setup needs interactive terminal:
- If setup fails with TTY error, run `npm run setup` directly in an interactive terminal.

Missing config at startup:
- Run `npm run setup` first.

TLS startup failure:
- Verify cert/key files exist and paths are correct in setup.

Session invalid behavior:
- Use UI “Revoke all sessions” and sign in again.

Smoke test skipped:
- Some restricted environments do not allow local listen sockets.

## Scope and Non-Goals (v1)

- Single-user, local/self-hosted design
- No multi-tenant isolation model
- No external identity provider integration
- No cloud-managed deployment stack included

## Script Index

- `scripts/setup.js` - interactive configuration
- `scripts/start.js` - unified startup path
- `scripts/preflight.js` - startup checks
- `scripts/gen-local-tls.js` - local TLS cert generation helper
- `scripts/security-tests.js` - auth/hash unit tests
- `scripts/smoke-test.js` - integration checks
- `scripts/backup.js` - data backup
- `scripts/restore.js` - data restore
- `scripts/validate-release.js` - release gate runner
