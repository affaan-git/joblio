# Joblio

A local, single-user job application tracker.

![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js)
![JavaScript](https://img.shields.io/badge/JavaScript-ES6%2B-F7DF1E?logo=javascript)

> NOTE: Joblio is early-stage software and is used at your own risk. Do not expose it beyond your local/private network.

## What Joblio Does

- Tracks job applications and status updates
- Stores per-application workspace files
- Supports trash/restore/purge flows for apps and files
- Supports import/export of tracker state
- Supports backup/restore of on-disk data
- Uses auth/session/CSRF/security headers/rate limits

## Getting Started

Issues during setup? Jump to [Troubleshooting](#troubleshooting).

### Prerequisites

- [`Node.js 20+`](https://nodejs.org/) ([download](https://nodejs.org/en/download))
- [`OpenSSL`](https://www.openssl.org/) (only if you want to generate local TLS certs with `npm run tls:gen`)

### Installation

Clone the repository

```sh
git clone https://github.com/affaan-git/joblio.git
cd joblio
```

Create TLS cert/key paths

```sh
npm run tls:gen
```

Start setup

```sh
npm run setup
```

Recommended choices during setup:

- Host: `127.0.0.1` (or explicit private interface if required)
- Allow remote binding: `No` unless required
- TLS mode: `require`
- Strong password (12+ chars minimum; longer recommended)
- Avoid `0.0.0.0` and public interface binding unless you are intentionally operating behind strict network controls.

Start Joblio

```sh
npm start
```

## Usage

After installation, use the same startup command from [Getting Started](#getting-started):

- `npm start`

`npm start` will:

- Load `.joblio-data/config.env`
- Run preflight validation
- Start backend server

> The UI URL is printed to the terminal at startup.

Recommended after setup or major changes:

```sh
npm run validate:release
```

## Reconfiguration

- Run `npm run reconfigure` to edit an existing configuration directly.
- Run `npm run setup` if you want the same setup flow with update prompt behavior.

> Recommended: run `npm run validate:release` from [Usage](#usage) after config changes.

## Docker support

Files:

- `Dockerfile`
- `docker-compose.yml`

First-time container setup:

```sh
cd joblio
docker compose build
docker compose run --rm -it joblio npm run setup
```

Important for Docker setup prompts:

- Keep host and remote-binding choices as restrictive as your deployment allows.
- Prefer loopback-only host publishing from Docker (default: `127.0.0.1:8787:8787`) and avoid public exposure.
- Use TLS settings appropriate for containerized cert paths if enabling HTTPS

Start service:

```sh
docker compose up -d
```

Persistent data is mounted at `./docker-data` -> `/app/.joblio-data`

## Architecture

- JavaScript Frontend: `Joblio.html`
- Node.js Backend: `server.js` (serves UI and API)
- JavaScript Scripts: `scripts/`
- Data directory: `.joblio-data/`

Single-process Node.js app. No external database required.

## Connection Model

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

### Session

- Idle timeout + absolute timeout
- Session binding mode (`strict`, `ip`, `ua`, `off`)
- Encrypted on-disk session store (`sessions.enc`)
- Global revoke-all sessions endpoint

### Request

- Origin/referer checks on writes
- Rate limiting by route family
- Request size limits
- File/path/id validation
- Basic Auth lockout and progressive backoff on repeated failures
- Optional IP allowlist gate

### Response

- Security headers (CSP, frame deny, nosniff, etc.)
- Generic 500 errors unless verbose mode explicitly enabled
- Public-safe mapping of thrown 4xx errors

### Network exposure risk

- Do not bind Joblio to `0.0.0.0` or a public interface unless you explicitly need remote access and have network protections in place.
- Default-safe posture is loopback-only (`127.0.0.1`) with remote binding disabled.
- Exposing Joblio directly to public networks increases attack surface and is not recommended.

## Technical Reference

### Interactive Setup

`npm run setup`

Setup prompts for:

- Basic Auth username
- Basic Auth password (hidden; confirmation required)
- Host
- Port
- Allow remote binding (yes/no)
- TLS mode (`off`, `on`, `require`)
- TLS cert path
- TLS key path
- Auth session rate limit
- Auth failure window/threshold/lockout
- Auth backoff base/max/start-after
- Auth guard max entries
- Trust proxy headers for client IP
- IP allowlist CSV

Setup output:

- Writes `.joblio-data/config.env`
- Stores password hash only (`scrypt$...`), never plaintext
- Generates random values for:
  - `JOBLIO_API_TOKEN`
  - `JOBLIO_AUDIT_KEY`

Setup file permissions:

- Attempts restrictive permissions (`0600`) on config file

Updating existing config:

- Running setup again prompts whether to update existing config
- `npm run reconfigure` opens edit flow directly for existing config

### Configuration Reference (`.joblio-data/config.env`)

These keys are written by setup and used at runtime.

| Key | Default | Purpose |
| --- | --- | --- |
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
| `RATE_MAX_AUTH_SESSION` | `45` | Auth session requests per rate window |
| `AUTH_FAIL_WINDOW_MS` | `600000` | Failure window for lockout counter |
| `AUTH_FAIL_THRESHOLD` | `5` | Failures before lockout |
| `AUTH_LOCKOUT_MS` | `900000` | Lockout duration |
| `AUTH_BACKOFF_BASE_MS` | `250` | Initial auth failure backoff |
| `AUTH_BACKOFF_MAX_MS` | `2000` | Maximum auth failure backoff |
| `AUTH_BACKOFF_START_AFTER` | `2` | Failure count when backoff starts |
| `AUTH_GUARD_MAX_ENTRIES` | `20000` | In-memory auth guard entry cap |
| `JOBLIO_TRUST_PROXY` | `0` | Trust `X-Forwarded-For` for client IP |
| `JOBLIO_IP_ALLOWLIST` | empty | CSV allowlist of source IPs/CIDRs |

Runtime override policy:

- Joblio locks these config keys from runtime environment overrides in `npm start`.
- Source of truth is the config file.

### Runtime Limits and Tunables

These are server-supported keys (advanced operations) that are not currently prompted in setup.

| Key | Default | Purpose |
| --- | --- | --- |
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
| `RATE_MAX_AUTH_SESSION` | `45` | Auth session limit per window |
| `AUTH_FAIL_WINDOW_MS` | `600000` | Auth failure window |
| `AUTH_FAIL_THRESHOLD` | `5` | Lockout failure threshold |
| `AUTH_LOCKOUT_MS` | `900000` | Lockout duration |
| `AUTH_BACKOFF_BASE_MS` | `250` | Backoff base delay |
| `AUTH_BACKOFF_MAX_MS` | `2000` | Backoff max delay |
| `AUTH_BACKOFF_START_AFTER` | `2` | Backoff starts after this many failures |
| `AUTH_GUARD_MAX_ENTRIES` | `20000` | Auth guard entry cap |
| `JOBLIO_TRUST_PROXY` | `0` | Trust `X-Forwarded-For` |
| `JOBLIO_IP_ALLOWLIST` | empty | Allowed IPs/CIDRs (CSV) |
| `SESSION_TTL_MS` | `28800000` | Session idle timeout |
| `SESSION_ABS_TTL_MS` | `86400000` | Session absolute timeout |

### API Endpoints

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

### Data Layout

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

### Commands

Core:

- `npm run setup`
- `npm run reconfigure`
- `npm start`

Validation/ops:

- `npm run preflight`
- `npm run test:security`
- `npm run smoke`
- `npm run validate:release`
- `npm run backup`
- `npm run restore -- --file <backup-file> --yes`
- `npm run tls:gen`

### Script Index

- `scripts/setup.js` - interactive configuration
- `scripts/start.js` - unified startup path
- `scripts/preflight.js` - startup checks
- `scripts/gen-local-tls.js` - local TLS cert generation helper
- `scripts/security-tests.js` - auth/hash unit tests
- `scripts/smoke-test.js` - integration checks
- `scripts/backup.js` - data backup
- `scripts/restore.js` - data restore
- `scripts/validate-release.js` - release gate runner

## Scope and Non-Goals (for now)

- Single-user, local/self-hosted
- No multi-tenant isolation model
- No external identity provider integration
- No cloud-managed deployment stack included

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

## Incident Runbook

Credential attack suspected:

1. Revoke all sessions from UI.
2. Run `npm run reconfigure` and rotate password.
3. Keep strict host/binding choices (`127.0.0.1`, remote binding off) unless operationally required.
4. Tighten auth controls in setup:
   - Lower `AUTH_FAIL_THRESHOLD`
   - Increase `AUTH_LOCKOUT_MS`
   - Reduce `RATE_MAX_AUTH_SESSION`
5. If running behind proxy, configure and verify `JOBLIO_IP_ALLOWLIST` and only then enable `JOBLIO_TRUST_PROXY`.
6. Run `npm run validate:release`.

Suspected unauthorized source IP:

1. Add/adjust `JOBLIO_IP_ALLOWLIST` in reconfigure flow.
2. Keep Docker publish loopback-only.
3. Restart with `npm start`.
