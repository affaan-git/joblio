#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const host = process.env.HOST || '127.0.0.1';
const strictMode = process.env.JOBLIO_STRICT_MODE !== '0';
const allowRemote = process.env.JOBLIO_ALLOW_REMOTE === '1';
const token = process.env.JOBLIO_API_TOKEN || '';
const basicUser = process.env.JOBLIO_BASIC_AUTH_USER || '';
const basicHash = process.env.JOBLIO_BASIC_AUTH_HASH || '';
const tlsMode = process.env.JOBLIO_TLS_MODE || 'off';
const tlsCert = process.env.JOBLIO_TLS_CERT_PATH || '';
const tlsKey = process.env.JOBLIO_TLS_KEY_PATH || '';
const dataDir = path.join(root, '.joblio-data');
const templatePath = path.join(root, 'templates', 'resume-template.md');

const issues = [];
const warns = [];

const localhostHosts = new Set(['127.0.0.1', 'localhost', '::1']);
if (!allowRemote && !localhostHosts.has(String(host).trim().toLowerCase())) {
  issues.push(`HOST=${host} is not local. Use HOST=127.0.0.1 or JOBLIO_ALLOW_REMOTE=1.`);
}

if (strictMode && !token) {
  issues.push('JOBLIO_API_TOKEN is required when strict mode is enabled (default).');
}
if (strictMode && (!basicUser || !basicHash)) {
  issues.push('JOBLIO_BASIC_AUTH_USER and JOBLIO_BASIC_AUTH_HASH are required when strict mode is enabled (default).');
}
if (process.env.JOBLIO_BASIC_AUTH_PASS) {
  warns.push('JOBLIO_BASIC_AUTH_PASS is ignored by server; use JOBLIO_BASIC_AUTH_HASH.');
}

if (!new Set(['off', 'on', 'require']).has(tlsMode)) {
  issues.push('JOBLIO_TLS_MODE must be one of: off, on, require.');
}
if ((tlsMode === 'on' || tlsMode === 'require') && (!tlsCert || !tlsKey)) {
  issues.push('TLS mode requires JOBLIO_TLS_CERT_PATH and JOBLIO_TLS_KEY_PATH.');
}
if (tlsCert && !fs.existsSync(path.resolve(tlsCert))) {
  issues.push(`TLS cert not found: ${tlsCert}`);
}
if (tlsKey && !fs.existsSync(path.resolve(tlsKey))) {
  issues.push(`TLS key not found: ${tlsKey}`);
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
