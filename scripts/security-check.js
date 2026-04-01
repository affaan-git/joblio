#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parseEnvText } = require('../lib/env-file');
const { loadAllowlistFromEnvSync } = require('../lib/allowlist-source');
const { validateNetworkPolicy } = require('../lib/validate-network');
const { validateTemplateConfig, DEFAULT_MAX_TEMPLATE_BYTES } = require('../lib/template-registry');

const root = path.resolve(__dirname, '..');
const configPath = path.join(root, '.joblio-data', 'config.env');

function fail(msg) {
  // eslint-disable-next-line no-console
  console.error(`FAIL: ${msg}`);
}

function warn(msg) {
  // eslint-disable-next-line no-console
  console.warn(`WARN: ${msg}`);
}

function evaluateSecurityCheck(envOverride = null) {
  const issues = [];
  const warns = [];
  let env = envOverride;
  if (!env) {
    if (!fs.existsSync(configPath)) {
      issues.push(`Missing config file: ${configPath}`);
      return { issues, warns };
    }
    const raw = fs.readFileSync(configPath, 'utf8');
    env = parseEnvText(raw);
  }
  const host = String(env.HOST || '').trim().toLowerCase();
  const allowLan = String(env.JOBLIO_ALLOW_LAN || '0') === '1';
  const trustProxy = String(env.JOBLIO_TRUST_PROXY || '0') === '1';

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

  const loadedAllowlist = loadAllowlistFromEnvSync(env, { baseDir: root });
  loadedAllowlist.issues.forEach((issue) => issues.push(issue));
  loadedAllowlist.warns.forEach((w) => warns.push(w));
  const parsedAllowlist = loadedAllowlist.entries;

  const netCheck = validateNetworkPolicy({ host, allowLan, trustProxy, allowlist: parsedAllowlist });
  netCheck.issues.forEach((i) => issues.push(i));
  netCheck.warns.forEach((w) => warns.push(w));

  if (String((envOverride ? env.NODE_TLS_REJECT_UNAUTHORIZED : process.env.NODE_TLS_REJECT_UNAUTHORIZED) || '') === '0') {
    issues.push('NODE_TLS_REJECT_UNAUTHORIZED=0 is unsafe and must not be set.');
  }

  if (String(env.JOBLIO_COOKIE_SECURE || '1') !== '1') {
    issues.push('JOBLIO_COOKIE_SECURE must be 1.');
  }

  const templateRoot = path.join(root, 'templates', 'resume');
  const templateCheck = validateTemplateConfig(String(env.JOBLIO_RESUME_TEMPLATES || ''), templateRoot, { requireExisting: true, maxBytes: DEFAULT_MAX_TEMPLATE_BYTES });
  if (templateCheck.issues.length) {
    templateCheck.issues.forEach((i) => issues.push(i));
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

function main() {
  const { issues, warns } = evaluateSecurityCheck();
  if (!issues.length) {
    // eslint-disable-next-line no-console
    console.log('Security check OK');
    warns.forEach(warn);
    process.exit(0);
  }

  issues.forEach(fail);
  warns.forEach(warn);
  process.exit(1);
}

if (require.main === module) {
  main();
}

module.exports = {
  evaluateSecurityCheck,
  main,
};
