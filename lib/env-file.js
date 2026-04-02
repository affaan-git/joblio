'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');

function sanitizeEnvValue(v) {
  return String(v || '').replace(/[\r\n\0]/g, '').trim();
}

function parseEnvText(text) {
  const out = {};
  const lines = String(text || '').split(/\r?\n/);
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const idx = t.indexOf('=');
    if (idx < 1) continue;
    const key = sanitizeEnvValue(t.slice(0, idx));
    const value = sanitizeEnvValue(t.slice(idx + 1));
    if (!key) continue;
    out[key] = value;
  }
  return out;
}

async function readEnvFile(filePath) {
  try {
    const raw = await fsp.readFile(filePath, 'utf8');
    return parseEnvText(raw);
  } catch {
    return {};
  }
}

function readEnvFileSync(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return parseEnvText(raw);
  } catch {
    return {};
  }
}

const APP_CONFIG_KEYS = [
  'HOST', 'PORT',
  'JOBLIO_ALLOW_LAN', 'JOBLIO_TLS_CERT_PATH', 'JOBLIO_TLS_KEY_PATH',
  'JOBLIO_DATA_DIR', 'JOBLIO_RESUME_TEMPLATES', 'JOBLIO_API_TOKEN',
  'JOBLIO_BASIC_AUTH_USER', 'JOBLIO_BASIC_AUTH_HASH', 'JOBLIO_AUDIT_KEY',
  'JOBLIO_TRUST_PROXY', 'JOBLIO_COOKIE_SECURE', 'JOBLIO_IP_ALLOWLIST_PATH',
  'JOBLIO_BACKUP_DIR',
  'MAX_TEMPLATE_BYTES', 'MAX_JSON_BODY_BYTES', 'MAX_UPLOAD_JSON_BYTES',
  'MAX_FILE_BYTES', 'MAX_APPS', 'MAX_SNAPSHOTS',
  'LOG_ROTATE_BYTES', 'PURGE_MIN_AGE_SEC',
  'RATE_WINDOW_MS', 'RATE_MAX_WRITE', 'RATE_MAX_UPLOAD', 'RATE_MAX_DELETE',
  'RATE_MAX_IMPORT', 'RATE_MAX_AUTH_SESSION',
  'AUTH_FAIL_WINDOW_MS', 'AUTH_FAIL_THRESHOLD', 'AUTH_LOCKOUT_MS',
  'AUTH_BACKOFF_BASE_MS', 'AUTH_BACKOFF_MAX_MS', 'AUTH_BACKOFF_START_AFTER',
  'AUTH_GUARD_MAX_ENTRIES',
  'SESSION_TTL_MS', 'SESSION_ABS_TTL_MS',
];

function cleanEnv(baseEnv) {
  const env = {};
  const blocked = new Set(APP_CONFIG_KEYS);
  for (const k of Object.keys(baseEnv)) {
    if (!blocked.has(k)) env[k] = baseEnv[k];
  }
  return env;
}

module.exports = {
  parseEnvText,
  readEnvFile,
  readEnvFileSync,
  cleanEnv,
};
