#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const configPath = path.join(root, '.joblio-data', 'config.env');

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

function fail(msg) {
  // eslint-disable-next-line no-console
  console.error(`FAIL: ${msg}`);
}

function warn(msg) {
  // eslint-disable-next-line no-console
  console.warn(`WARN: ${msg}`);
}

function check() {
  const issues = [];
  const warns = [];
  if (!fs.existsSync(configPath)) {
    issues.push(`Missing config file: ${configPath}`);
    return { issues, warns };
  }

  const raw = fs.readFileSync(configPath, 'utf8');
  const env = parseEnvText(raw);
  const host = String(env.HOST || '').trim().toLowerCase();
  const localhostHosts = new Set(['127.0.0.1', 'localhost', '::1']);
  if (!localhostHosts.has(host)) {
    issues.push(`HOST must be localhost only. Current: ${env.HOST || '(unset)'}`);
  }

  if (!String(env.JOBLIO_API_TOKEN || '').trim()) {
    issues.push('JOBLIO_API_TOKEN is missing.');
  } else if (String(env.JOBLIO_API_TOKEN).trim().length < 24) {
    warns.push('JOBLIO_API_TOKEN appears short; setup-generated long random values are recommended.');
  }

  if (!String(env.JOBLIO_BASIC_AUTH_USER || '').trim()) {
    issues.push('JOBLIO_BASIC_AUTH_USER is missing.');
  }

  const hash = String(env.JOBLIO_BASIC_AUTH_HASH || '');
  if (!hash.startsWith('scrypt$')) {
    issues.push('JOBLIO_BASIC_AUTH_HASH must be in scrypt$... format.');
  }

  const certPathRaw = String(env.JOBLIO_TLS_CERT_PATH || '').trim();
  const keyPathRaw = String(env.JOBLIO_TLS_KEY_PATH || '').trim();
  if (!certPathRaw || !keyPathRaw) {
    issues.push('TLS cert/key paths are required.');
  } else {
    const certPath = path.resolve(certPathRaw);
    const keyPath = path.resolve(keyPathRaw);
    if (!fs.existsSync(certPath)) issues.push(`TLS cert not found: ${certPathRaw}`);
    if (!fs.existsSync(keyPath)) issues.push(`TLS key not found: ${keyPathRaw}`);
  }

  if (String(env.JOBLIO_TRUST_PROXY || '0') === '1' && !String(env.JOBLIO_IP_ALLOWLIST || '').trim()) {
    issues.push('JOBLIO_TRUST_PROXY=1 requires a non-empty JOBLIO_IP_ALLOWLIST.');
  }

  if (String(process.env.NODE_TLS_REJECT_UNAUTHORIZED || '') === '0') {
    issues.push('NODE_TLS_REJECT_UNAUTHORIZED=0 is unsafe and must not be set.');
  }

  if (String(env.JOBLIO_COOKIE_SECURE || '1') !== '1') {
    issues.push('JOBLIO_COOKIE_SECURE must be 1.');
  }

  try {
    const stat = fs.statSync(configPath);
    if (process.platform !== 'win32') {
      const mode = stat.mode & 0o777;
      if ((mode & 0o077) !== 0) {
        warns.push('config.env is readable by group/others; chmod 600 is recommended.');
      }
    }
  } catch {
    warns.push('Could not inspect config.env permissions.');
  }

  return { issues, warns };
}

const { issues, warns } = check();
if (!issues.length) {
  // eslint-disable-next-line no-console
  console.log('Security check OK');
  warns.forEach(warn);
  process.exit(0);
}

issues.forEach(fail);
warns.forEach(warn);
process.exit(1);
