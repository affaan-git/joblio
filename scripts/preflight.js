#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { isSafeAllowlistEntry, hasNonLoopbackAllowlistEntry } = require('../lib/ip-allowlist');
const { loadAllowlistFromEnvSync } = require('../lib/allowlist-source');
const { isLoopbackHost, isWildcardHost, isPrivateOrLoopbackHost } = require('../lib/network-policy');
const { validateTemplateConfig } = require('../lib/template-registry');

const root = path.resolve(__dirname, '..');

function evaluatePreflight(env = process.env) {
  const host = env.HOST || '127.0.0.1';
  const allowLan = env.JOBLIO_ALLOW_LAN === '1';
  const token = env.JOBLIO_API_TOKEN || '';
  const basicUser = env.JOBLIO_BASIC_AUTH_USER || '';
  const basicHash = env.JOBLIO_BASIC_AUTH_HASH || '';
  const tlsCert = env.JOBLIO_TLS_CERT_PATH || '';
  const tlsKey = env.JOBLIO_TLS_KEY_PATH || '';
  const rateMaxAuthSession = Number(env.RATE_MAX_AUTH_SESSION || 45);
  const authFailWindowMs = Number(env.AUTH_FAIL_WINDOW_MS || 10 * 60 * 1000);
  const authFailThreshold = Number(env.AUTH_FAIL_THRESHOLD || 5);
  const authLockoutMs = Number(env.AUTH_LOCKOUT_MS || 15 * 60 * 1000);
  const authBackoffBaseMs = Number(env.AUTH_BACKOFF_BASE_MS || 250);
  const authBackoffMaxMs = Number(env.AUTH_BACKOFF_MAX_MS || 2000);
  const authBackoffStartAfter = Number(env.AUTH_BACKOFF_START_AFTER || 2);
  const authGuardMaxEntries = Number(env.AUTH_GUARD_MAX_ENTRIES || 20000);
  const trustProxy = env.JOBLIO_TRUST_PROXY === '1';
  const dataDir = path.resolve(env.JOBLIO_DATA_DIR || path.join(root, '.joblio-data'));
  const templateRoot = path.join(root, 'templates', 'resume');
  const resumeTemplatesRaw = env.JOBLIO_RESUME_TEMPLATES || '';

  const issues = [];
  const warns = [];

  if (!allowLan && !isLoopbackHost(host)) {
    issues.push(`HOST=${host} is not local while JOBLIO_ALLOW_LAN=0. Use HOST=127.0.0.1 or enable JOBLIO_ALLOW_LAN=1.`);
  }
  if (allowLan) {
    if (isWildcardHost(host)) issues.push(`HOST=${host} is wildcard. Use a specific private interface IP in LAN mode.`);
    if (!isPrivateOrLoopbackHost(host)) issues.push(`HOST=${host} is not private/loopback. LAN mode requires a private bind host.`);
  }

  if (!token) issues.push('JOBLIO_API_TOKEN is required.');
  if (!basicUser || !basicHash) issues.push('JOBLIO_BASIC_AUTH_USER and JOBLIO_BASIC_AUTH_HASH are required.');
  if (!tlsCert || !tlsKey) issues.push('HTTPS requires JOBLIO_TLS_CERT_PATH and JOBLIO_TLS_KEY_PATH.');
  if (tlsCert && !fs.existsSync(path.resolve(tlsCert))) issues.push(`TLS cert not found: ${tlsCert}`);
  if (tlsKey && !fs.existsSync(path.resolve(tlsKey))) issues.push(`TLS key not found: ${tlsKey}`);
  if (rateMaxAuthSession <= 0) issues.push('RATE_MAX_AUTH_SESSION must be greater than 0.');
  if (authFailWindowMs <= 0 || authFailThreshold <= 0 || authLockoutMs <= 0) {
    issues.push('AUTH_FAIL_WINDOW_MS, AUTH_FAIL_THRESHOLD, and AUTH_LOCKOUT_MS must be greater than 0.');
  }
  if (authBackoffBaseMs < 0 || authBackoffMaxMs < 0 || authBackoffStartAfter <= 0) {
    issues.push('AUTH_BACKOFF_BASE_MS, AUTH_BACKOFF_MAX_MS, and AUTH_BACKOFF_START_AFTER must be valid positive values.');
  }
  if (authBackoffBaseMs > authBackoffMaxMs) {
    issues.push('AUTH_BACKOFF_BASE_MS must be less than or equal to AUTH_BACKOFF_MAX_MS.');
  }
  if (authGuardMaxEntries <= 0) issues.push('AUTH_GUARD_MAX_ENTRIES must be greater than 0.');

  const loadedAllowlist = loadAllowlistFromEnvSync(env, { baseDir: root });
  loadedAllowlist.issues.forEach((issue) => issues.push(issue));
  loadedAllowlist.warns.forEach((w) => warns.push(w));
  const parsedAllowlist = loadedAllowlist.entries;
  if (!allowLan && parsedAllowlist.length && !trustProxy) {
    warns.push('IP allowlist is enabled while JOBLIO_TRUST_PROXY=0. Only socket remoteAddress will be used for IP checks.');
  }
  if (trustProxy && !parsedAllowlist.length) {
    issues.push('JOBLIO_TRUST_PROXY=1 requires a non-empty allowlist.');
  }
  if (allowLan && !parsedAllowlist.length) {
    issues.push('JOBLIO_ALLOW_LAN=1 requires a non-empty allowlist.');
  }
  if (allowLan && parsedAllowlist.length && !hasNonLoopbackAllowlistEntry(parsedAllowlist)) {
    issues.push('JOBLIO_ALLOW_LAN=1 requires at least one non-loopback allowlist entry.');
  }
  if (allowLan && trustProxy) {
    issues.push('JOBLIO_ALLOW_LAN=1 requires JOBLIO_TRUST_PROXY=0 unless you intentionally redesign for a trusted proxy chain.');
  }
  if (allowLan) {
    const unsafe = parsedAllowlist.find((entry) => !isSafeAllowlistEntry(entry));
    if (unsafe) {
      issues.push(`Unsafe allowlist entry for LAN mode: ${unsafe}`);
    }
  }

  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.accessSync(dataDir, fs.constants.R_OK | fs.constants.W_OK);
  } catch {
    issues.push(`Data directory is not readable/writable: ${dataDir}`);
  }

  const templateCheck = validateTemplateConfig(resumeTemplatesRaw, templateRoot, { requireExisting: true, maxBytes: 10 * 1024 * 1024 });
  if (templateCheck.issues.length) {
    templateCheck.issues.forEach((i) => issues.push(i));
  }

  return { issues, warns };
}

function main() {
  const { issues, warns } = evaluatePreflight(process.env);
  if (!issues.length) {
    console.log('Preflight OK');
    warns.forEach((w) => console.log(`WARN: ${w}`));
    process.exit(0);
  }
  console.error('Preflight failed:');
  issues.forEach((i) => console.error(`- ${i}`));
  warns.forEach((w) => console.error(`WARN: ${w}`));
  process.exit(1);
}

if (require.main === module) {
  main();
}

module.exports = {
  evaluatePreflight,
  main,
};
