#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parseAllowlist } = require('../lib/ip-allowlist');

const root = path.resolve(__dirname, '..');
const host = process.env.HOST || '127.0.0.1';
const token = process.env.JOBLIO_API_TOKEN || '';
const basicUser = process.env.JOBLIO_BASIC_AUTH_USER || '';
const basicHash = process.env.JOBLIO_BASIC_AUTH_HASH || '';
const tlsCert = process.env.JOBLIO_TLS_CERT_PATH || '';
const tlsKey = process.env.JOBLIO_TLS_KEY_PATH || '';
const rateMaxAuthSession = Number(process.env.RATE_MAX_AUTH_SESSION || 45);
const authFailWindowMs = Number(process.env.AUTH_FAIL_WINDOW_MS || 10 * 60 * 1000);
const authFailThreshold = Number(process.env.AUTH_FAIL_THRESHOLD || 5);
const authLockoutMs = Number(process.env.AUTH_LOCKOUT_MS || 15 * 60 * 1000);
const authBackoffBaseMs = Number(process.env.AUTH_BACKOFF_BASE_MS || 250);
const authBackoffMaxMs = Number(process.env.AUTH_BACKOFF_MAX_MS || 2000);
const authBackoffStartAfter = Number(process.env.AUTH_BACKOFF_START_AFTER || 2);
const authGuardMaxEntries = Number(process.env.AUTH_GUARD_MAX_ENTRIES || 20000);
const ipAllowlistRaw = process.env.JOBLIO_IP_ALLOWLIST || '';
const trustProxy = process.env.JOBLIO_TRUST_PROXY === '1';
const dataDir = path.resolve(process.env.JOBLIO_DATA_DIR || path.join(root, '.joblio-data'));
const templatePath = path.join(root, 'templates', 'resume-template.md');

const issues = [];
const warns = [];

const localhostHosts = new Set(['127.0.0.1', 'localhost', '::1']);
if (!localhostHosts.has(String(host).trim().toLowerCase())) {
  issues.push(`HOST=${host} is not local. Use HOST=127.0.0.1.`);
}

if (!token) {
  issues.push('JOBLIO_API_TOKEN is required.');
}
if (!basicUser || !basicHash) {
  issues.push('JOBLIO_BASIC_AUTH_USER and JOBLIO_BASIC_AUTH_HASH are required.');
}

if (!tlsCert || !tlsKey) {
  issues.push('HTTPS requires JOBLIO_TLS_CERT_PATH and JOBLIO_TLS_KEY_PATH.');
}
if (tlsCert && !fs.existsSync(path.resolve(tlsCert))) {
  issues.push(`TLS cert not found: ${tlsCert}`);
}
if (tlsKey && !fs.existsSync(path.resolve(tlsKey))) {
  issues.push(`TLS key not found: ${tlsKey}`);
}
if (rateMaxAuthSession <= 0) {
  issues.push('RATE_MAX_AUTH_SESSION must be greater than 0.');
}
if (authFailWindowMs <= 0 || authFailThreshold <= 0 || authLockoutMs <= 0) {
  issues.push('AUTH_FAIL_WINDOW_MS, AUTH_FAIL_THRESHOLD, and AUTH_LOCKOUT_MS must be greater than 0.');
}
if (authBackoffBaseMs < 0 || authBackoffMaxMs < 0 || authBackoffStartAfter <= 0) {
  issues.push('AUTH_BACKOFF_BASE_MS, AUTH_BACKOFF_MAX_MS, and AUTH_BACKOFF_START_AFTER must be valid positive values.');
}
if (authBackoffBaseMs > authBackoffMaxMs) {
  issues.push('AUTH_BACKOFF_BASE_MS must be less than or equal to AUTH_BACKOFF_MAX_MS.');
}
if (authGuardMaxEntries <= 0) {
  issues.push('AUTH_GUARD_MAX_ENTRIES must be greater than 0.');
}
const parsedAllowlist = parseAllowlist(ipAllowlistRaw);
if (ipAllowlistRaw.trim() && !parsedAllowlist.length) {
  issues.push('JOBLIO_IP_ALLOWLIST is set but contains no valid entries.');
}
if (parsedAllowlist.length && !trustProxy) {
  warns.push('JOBLIO_IP_ALLOWLIST is enabled while JOBLIO_TRUST_PROXY=0. Only socket remoteAddress will be used for IP checks.');
}

try {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.accessSync(dataDir, fs.constants.R_OK | fs.constants.W_OK);
} catch {
  issues.push(`Data directory is not readable/writable: ${dataDir}`);
}

if (!fs.existsSync(templatePath)) {
  warns.push(`Resume template missing; fallback template will be served: ${templatePath}`);
}

if (!issues.length) {
  console.log('Preflight OK');
  if (warns.length) {
    warns.forEach((w) => console.log(`WARN: ${w}`));
  }
  process.exit(0);
}

console.error('Preflight failed:');
issues.forEach((i) => console.error(`- ${i}`));
warns.forEach((w) => console.error(`WARN: ${w}`));
process.exit(1);
