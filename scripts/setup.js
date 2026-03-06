#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const readline = require('node:readline/promises');
const { stdin, stdout } = require('node:process');
const { createPasswordHash } = require('../lib/auth');

const root = path.resolve(__dirname, '..');
const dataDir = path.join(root, '.joblio-data');
const configPath = path.join(dataDir, 'config.env');

function randHex(bytes) {
  return crypto.randomBytes(bytes).toString('hex');
}

function parseBoolText(v, fallback = false) {
  if (v == null || v === '') return fallback;
  return ['1', 'true', 'yes', 'y', 'on'].includes(String(v).trim().toLowerCase());
}

function parsePort(v, fallback = 8787) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 65535) return fallback;
  return n;
}

function parseIntInRange(v, fallback, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return fallback;
  if (n < min || n > max) return fallback;
  return n;
}

function parseEnvText(text) {
  const out = {};
  const lines = String(text || '').split(/\r?\n/);
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const idx = t.indexOf('=');
    if (idx < 1) continue;
    const key = t.slice(0, idx).trim();
    const value = t.slice(idx + 1).trim();
    if (!key) continue;
    out[key] = value;
  }
  return out;
}

async function loadExistingConfig() {
  try {
    const raw = await fsp.readFile(configPath, 'utf8');
    return parseEnvText(raw);
  } catch {
    return {};
  }
}

function sanitizeValue(v) {
  return String(v || '').replace(/\r/g, '').replace(/\n/g, '');
}

function validatePasswordStrength(pass) {
  if (pass.length < 8) {
    throw new Error('Password must be at least 8 characters.');
  }
  if (!/[A-Za-z]/.test(pass)) {
    throw new Error('Password must include at least one letter.');
  }
  if (!/\d/.test(pass)) {
    throw new Error('Password must include at least one number.');
  }
  if (!/[^A-Za-z0-9]/.test(pass)) {
    throw new Error('Password must include at least one symbol.');
  }
}

async function promptHidden(promptText) {
  if (!stdin.isTTY || !stdout.isTTY) {
    throw new Error('Interactive setup requires a TTY terminal.');
  }
  return new Promise((resolve) => {
    const input = stdin;
    const output = stdout;
    let value = '';
    output.write(promptText);
    input.setRawMode(true);
    input.resume();
    input.setEncoding('utf8');

    const onData = (char) => {
      if (char === '\u0003') {
        output.write('\n');
        process.exit(130);
      }
      if (char === '\r' || char === '\n') {
        input.setRawMode(false);
        input.pause();
        input.removeListener('data', onData);
        output.write('\n');
        resolve(value);
        return;
      }
      if (char === '\u007f' || char === '\b' || char === '\u0008') {
        value = value.slice(0, -1);
        return;
      }
      value += char;
    };

    input.on('data', onData);
  });
}

async function askInteractive(existing, options = {}) {
  if (!stdin.isTTY || !stdout.isTTY) {
    throw new Error('Interactive setup requires a TTY terminal.');
  }
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    const forceEdit = Boolean(options.forceEdit);
    const exists = Boolean(existing && Object.keys(existing).length > 0);
    if (exists && !forceEdit) {
      const updateRaw = await rl.question('Existing config found. Update it? (y/N): ');
      if (!parseBoolText(updateRaw, false)) {
        return { skip: true };
      }
    }

    const defaultUser = sanitizeValue(existing.JOBLIO_BASIC_AUTH_USER || 'joblio');
    const userRaw = await rl.question(`Basic auth username [${defaultUser}]: `);
    const user = sanitizeValue(userRaw || defaultUser) || 'joblio';

    const hasExistingHash = String(existing.JOBLIO_BASIC_AUTH_HASH || '').startsWith('scrypt$');
    const passLabel = hasExistingHash
      ? 'Basic auth password (leave blank to keep existing): '
      : 'Basic auth password (min 8 chars, include letter + number + symbol): ';
    const pass = await promptHidden(passLabel);
    let useExistingHash = false;
    if (!pass && hasExistingHash) {
      useExistingHash = true;
    }

    let passwordHash = sanitizeValue(existing.JOBLIO_BASIC_AUTH_HASH || '');
    if (!useExistingHash) {
      const pass2 = await promptHidden('Confirm password: ');
      if (pass !== pass2) throw new Error('Password confirmation did not match.');
      validatePasswordStrength(pass);
      passwordHash = createPasswordHash(pass);
    }

    const host = '127.0.0.1';

    const defaultPort = parsePort(existing.PORT, 8787);
    const portRaw = await rl.question(`Port [${defaultPort}]: `);
    const port = parsePort(portRaw, defaultPort);

    const defaultDataDir = sanitizeValue(existing.JOBLIO_DATA_DIR || path.join(root, '.joblio-data'));
    const dataDirRaw = await rl.question(`Storage data directory [${defaultDataDir}]: `);
    const runtimeDataDir = sanitizeValue(dataDirRaw || defaultDataDir);
    if (!runtimeDataDir) throw new Error('Storage data directory is required.');

    const defaultBackupDir = sanitizeValue(existing.JOBLIO_BACKUP_DIR || path.join(root, 'backups'));
    const backupDirRaw = await rl.question(`Backup directory [${defaultBackupDir}]: `);
    const backupDir = sanitizeValue(backupDirRaw || defaultBackupDir);
    if (!backupDir) throw new Error('Backup directory is required.');

    const defaultTlsCertPath = sanitizeValue(existing.JOBLIO_TLS_CERT_PATH || path.join(runtimeDataDir, 'tls', 'localhost-cert.pem'));
    const defaultTlsKeyPath = sanitizeValue(existing.JOBLIO_TLS_KEY_PATH || path.join(runtimeDataDir, 'tls', 'localhost-key.pem'));
    const certPathRaw = await rl.question(`TLS cert path [${defaultTlsCertPath}]: `);
    const keyPathRaw = await rl.question(`TLS key path [${defaultTlsKeyPath}]: `);
    const certPath = sanitizeValue(certPathRaw || defaultTlsCertPath);
    const keyPath = sanitizeValue(keyPathRaw || defaultTlsKeyPath);

    if (!certPath || !keyPath) {
      throw new Error('TLS cert and key paths are required.');
    }
    if (!fs.existsSync(path.resolve(certPath))) {
      throw new Error(`TLS cert not found: ${certPath}`);
    }
    if (!fs.existsSync(path.resolve(keyPath))) {
      throw new Error(`TLS key not found: ${keyPath}`);
    }

    const defaultRateAuthSession = parseIntInRange(existing.RATE_MAX_AUTH_SESSION, 45, 1, 100000);
    const rateAuthSessionRaw = await rl.question(`Auth session rate limit per window [${defaultRateAuthSession}]: `);
    const rateMaxAuthSession = parseIntInRange(rateAuthSessionRaw, defaultRateAuthSession, 1, 100000);

    const defaultAuthFailWindowMs = parseIntInRange(existing.AUTH_FAIL_WINDOW_MS, 10 * 60 * 1000, 1000, 24 * 60 * 60 * 1000);
    const authFailWindowRaw = await rl.question(`Auth failure window (ms) [${defaultAuthFailWindowMs}]: `);
    const authFailWindowMs = parseIntInRange(authFailWindowRaw, defaultAuthFailWindowMs, 1000, 24 * 60 * 60 * 1000);

    const defaultAuthFailThreshold = parseIntInRange(existing.AUTH_FAIL_THRESHOLD, 5, 1, 1000);
    const authFailThresholdRaw = await rl.question(`Auth failure threshold [${defaultAuthFailThreshold}]: `);
    const authFailThreshold = parseIntInRange(authFailThresholdRaw, defaultAuthFailThreshold, 1, 1000);

    const defaultAuthLockoutMs = parseIntInRange(existing.AUTH_LOCKOUT_MS, 15 * 60 * 1000, 1000, 24 * 60 * 60 * 1000);
    const authLockoutRaw = await rl.question(`Auth lockout duration (ms) [${defaultAuthLockoutMs}]: `);
    const authLockoutMs = parseIntInRange(authLockoutRaw, defaultAuthLockoutMs, 1000, 24 * 60 * 60 * 1000);

    const defaultAuthBackoffBaseMs = parseIntInRange(existing.AUTH_BACKOFF_BASE_MS, 250, 0, 60000);
    const authBackoffBaseRaw = await rl.question(`Auth backoff base (ms) [${defaultAuthBackoffBaseMs}]: `);
    const authBackoffBaseMs = parseIntInRange(authBackoffBaseRaw, defaultAuthBackoffBaseMs, 0, 60000);

    const defaultAuthBackoffMaxMs = parseIntInRange(existing.AUTH_BACKOFF_MAX_MS, 2000, 0, 60000);
    const authBackoffMaxRaw = await rl.question(`Auth backoff max (ms) [${defaultAuthBackoffMaxMs}]: `);
    const authBackoffMaxMs = parseIntInRange(authBackoffMaxRaw, defaultAuthBackoffMaxMs, 0, 60000);

    const defaultAuthBackoffStartAfter = parseIntInRange(existing.AUTH_BACKOFF_START_AFTER, 2, 1, 1000);
    const authBackoffStartAfterRaw = await rl.question(`Auth backoff start after failures [${defaultAuthBackoffStartAfter}]: `);
    const authBackoffStartAfter = parseIntInRange(authBackoffStartAfterRaw, defaultAuthBackoffStartAfter, 1, 1000);

    if (authBackoffBaseMs > authBackoffMaxMs) {
      throw new Error('Auth backoff base must be less than or equal to auth backoff max.');
    }

    const defaultAuthGuardMaxEntries = parseIntInRange(existing.AUTH_GUARD_MAX_ENTRIES, 20000, 100, 1000000);
    const authGuardMaxEntriesRaw = await rl.question(`Auth guard max entries [${defaultAuthGuardMaxEntries}]: `);
    const authGuardMaxEntries = parseIntInRange(authGuardMaxEntriesRaw, defaultAuthGuardMaxEntries, 100, 1000000);

    const defaultTrustProxy = sanitizeValue(existing.JOBLIO_TRUST_PROXY || '0') === '1';
    const trustProxyRaw = await rl.question(`Trust proxy headers for client IP? (${defaultTrustProxy ? 'Y/n' : 'y/N'}): `);
    const trustProxy = parseBoolText(trustProxyRaw, defaultTrustProxy) ? '1' : '0';

    const defaultAllowlist = sanitizeValue(existing.JOBLIO_IP_ALLOWLIST || '');
    const allowlistRaw = await rl.question(`IP allowlist CSV (blank to disable) [${defaultAllowlist || 'disabled'}]: `);
    const ipAllowlist = sanitizeValue(allowlistRaw || defaultAllowlist);

    return {
      skip: false,
      host,
      port,
      user,
      passwordHash,
      runtimeDataDir,
      backupDir,
      certPath,
      keyPath,
      rateMaxAuthSession,
      authFailWindowMs,
      authFailThreshold,
      authLockoutMs,
      authBackoffBaseMs,
      authBackoffMaxMs,
      authBackoffStartAfter,
      authGuardMaxEntries,
      trustProxy,
      ipAllowlist,
      apiToken: sanitizeValue(existing.JOBLIO_API_TOKEN || randHex(32)),
      auditKey: sanitizeValue(existing.JOBLIO_AUDIT_KEY || randHex(32)),
    };
  } finally {
    rl.close();
  }
}

async function writeConfig(result) {
  await fsp.mkdir(dataDir, { recursive: true, mode: 0o700 });
  const lines = [
    '# Joblio managed configuration file',
    '# Generated by npm run setup (interactive)',
    `HOST=${sanitizeValue(result.host)}`,
    `PORT=${sanitizeValue(result.port)}`,
    `JOBLIO_API_TOKEN=${sanitizeValue(result.apiToken)}`,
    `JOBLIO_BASIC_AUTH_USER=${sanitizeValue(result.user)}`,
    `JOBLIO_BASIC_AUTH_HASH=${sanitizeValue(result.passwordHash)}`,
    `JOBLIO_AUDIT_KEY=${sanitizeValue(result.auditKey)}`,
    `JOBLIO_TLS_CERT_PATH=${sanitizeValue(result.certPath)}`,
    `JOBLIO_TLS_KEY_PATH=${sanitizeValue(result.keyPath)}`,
    `JOBLIO_DATA_DIR=${sanitizeValue(result.runtimeDataDir)}`,
    `JOBLIO_BACKUP_DIR=${sanitizeValue(result.backupDir)}`,
    'JOBLIO_COOKIE_SECURE=1',
    `RATE_MAX_AUTH_SESSION=${sanitizeValue(result.rateMaxAuthSession)}`,
    `AUTH_FAIL_WINDOW_MS=${sanitizeValue(result.authFailWindowMs)}`,
    `AUTH_FAIL_THRESHOLD=${sanitizeValue(result.authFailThreshold)}`,
    `AUTH_LOCKOUT_MS=${sanitizeValue(result.authLockoutMs)}`,
    `AUTH_BACKOFF_BASE_MS=${sanitizeValue(result.authBackoffBaseMs)}`,
    `AUTH_BACKOFF_MAX_MS=${sanitizeValue(result.authBackoffMaxMs)}`,
    `AUTH_BACKOFF_START_AFTER=${sanitizeValue(result.authBackoffStartAfter)}`,
    `AUTH_GUARD_MAX_ENTRIES=${sanitizeValue(result.authGuardMaxEntries)}`,
    `JOBLIO_TRUST_PROXY=${sanitizeValue(result.trustProxy)}`,
    `JOBLIO_IP_ALLOWLIST=${sanitizeValue(result.ipAllowlist)}`,
    '',
  ];
  const tmp = `${configPath}.tmp`;
  await fsp.writeFile(tmp, lines.join('\n'), { mode: 0o600 });
  await fsp.rename(tmp, configPath);
  await fsp.chmod(configPath, 0o600).catch(() => {});
}

async function main() {
  const forceEdit = process.argv.includes('--reconfigure');
  const existing = await loadExistingConfig();
  if (forceEdit && (!existing || Object.keys(existing).length === 0)) {
    throw new Error('No existing configuration found to reconfigure. Run `npm run setup` first.');
  }
  const result = await askInteractive(existing, { forceEdit });
  if (result.skip) {
    console.log('Setup skipped. Existing configuration unchanged.');
    process.exit(0);
  }
  await writeConfig(result);
  console.log('Setup complete: configuration saved to .joblio-data/config.env');
}

main().catch((err) => {
  console.error(`Setup failed: ${err?.message || String(err)}`);
  process.exit(1);
});
