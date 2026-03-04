# Joblio v1

Joblio is a local-first application tracker with a hardened backend. It is designed to run self-hosted on a single machine or a private host.

## Simple Setup (Recommended)

1. Run one-time setup:

```bash
cd tracker
npm run setup
```

2. Start Joblio:

```bash
npm start
```

Notes:
- Setup writes secure config to `.joblio-data/config.env`.
- Startup does not print credentials or secret values.
- If config is missing, `npm start` runs setup first.

## Production Quick Start (Host Install)

Use non-interactive setup so deployment is reproducible.

1. Generate/update config:

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

2. Validate:

```bash
npm run validate:release
```

3. Launch:

```bash
npm start
```

## Docker Deployment

1. Edit credentials in `docker-compose.yml`:
- `JOBLIO_SETUP_PASSWORD`

2. Start container:

```bash
cd tracker
docker compose up -d --build
```

3. Open:
- `http://127.0.0.1:8787`

Docker notes:
- Persistent data is stored in `tracker/docker-data`.
- Container runs as non-root user.
- First run auto-generates `.joblio-data/config.env` inside the mounted volume.

## Security Defaults

By default, setup writes:
- `JOBLIO_STRICT_MODE=1`
- `JOBLIO_SESSION_BINDING=strict`
- `JOBLIO_HEALTH_VERBOSE=0`
- `JOBLIO_ERROR_VERBOSE=0`
- random `JOBLIO_API_TOKEN`
- random `JOBLIO_AUDIT_KEY`
- hashed Basic Auth password (`scrypt$...`)

## Commands

```bash
npm run setup              # one-time config generation/update
npm start                  # single launch command (setup + preflight + server)
npm run preflight          # config validation
npm run auth:hash -- --password '<password>'
npm run tls:gen            # generate local TLS cert/key (OpenSSL)
npm run test:security      # security unit tests
npm run smoke              # smoke/integration test
npm run validate:release   # preflight + security tests + smoke + backup
npm run backup             # backup .joblio-data
npm run restore -- --file <backup-file> --yes
```

## Data On Disk

Under `.joblio-data/`:
- `config.env`
- `state.json`
- `storage/`
- `storage-trash/`
- `snapshots/`
- `logs/`
- `sessions.enc`

## API Summary

- Auth/session: `/api/auth/session`, `/api/auth/logout`, `/api/auth/revoke-all`
- State/health: `/api/state`, `/api/health`, `/api/integrity/verify`
- Files: `/api/files/upload`, `/api/files/:id/download`, `/api/files/:id`, `/api/files/:id/restore`, `/api/files/:id/purge`
- Data: `/api/export`, `/api/import`, `/api/template/resume`
