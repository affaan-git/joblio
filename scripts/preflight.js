#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const host = process.env.HOST || '127.0.0.1';
const strictMode = process.env.JOBLIO_STRICT_MODE !== '0';
const allowRemote = process.env.JOBLIO_ALLOW_REMOTE === '1';
const token = process.env.JOBLIO_API_TOKEN || '';
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
