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
const tlsDirCert = path.join(dataDir, 'tls', 'localhost-cert.pem');
const tlsDirKey = path.join(dataDir, 'tls', 'localhost-key.pem');

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

function isValidTlsMode(v) {
  return new Set(['off', 'on', 'require']).has(v);
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
      : 'Basic auth password (min 12 chars): ';
    const pass = await promptHidden(passLabel);
    let useExistingHash = false;
    if (!pass && hasExistingHash) {
      useExistingHash = true;
    }

    let passwordHash = sanitizeValue(existing.JOBLIO_BASIC_AUTH_HASH || '');
    if (!useExistingHash) {
      const pass2 = await promptHidden('Confirm password: ');
      if (pass !== pass2) throw new Error('Password confirmation did not match.');
      if (pass.length < 12) throw new Error('Password must be at least 12 characters.');
      passwordHash = createPasswordHash(pass);
    }

    const defaultHost = sanitizeValue(existing.HOST || '127.0.0.1') || '127.0.0.1';
    const hostRaw = await rl.question(`Host [${defaultHost}]: `);
    const host = sanitizeValue(hostRaw || defaultHost) || '127.0.0.1';

    const defaultPort = parsePort(existing.PORT, 8787);
    const portRaw = await rl.question(`Port [${defaultPort}]: `);
    const port = parsePort(portRaw, defaultPort);

    const defaultAllowRemote = sanitizeValue(existing.JOBLIO_ALLOW_REMOTE || '0') === '1';
    const allowRemoteRaw = await rl.question(`Allow remote binding? (${defaultAllowRemote ? 'Y/n' : 'y/N'}): `);
    const allowRemote = parseBoolText(allowRemoteRaw, defaultAllowRemote) ? '1' : '0';

    const hasLocalTls = fs.existsSync(tlsDirCert) && fs.existsSync(tlsDirKey);
    const defaultTlsMode = sanitizeValue(existing.JOBLIO_TLS_MODE || (hasLocalTls ? 'require' : 'off')).toLowerCase();
    const tlsModeRaw = await rl.question(`TLS mode [${defaultTlsMode}] (off/on/require): `);
    const tlsMode = sanitizeValue(tlsModeRaw || defaultTlsMode).toLowerCase();
    if (!isValidTlsMode(tlsMode)) throw new Error('TLS mode must be off, on, or require.');

    const defaultTlsCertPath = sanitizeValue(existing.JOBLIO_TLS_CERT_PATH || tlsDirCert);
    const defaultTlsKeyPath = sanitizeValue(existing.JOBLIO_TLS_KEY_PATH || tlsDirKey);
    const certPathRaw = await rl.question(`TLS cert path [${defaultTlsCertPath}]: `);
    const keyPathRaw = await rl.question(`TLS key path [${defaultTlsKeyPath}]: `);
    const certPath = sanitizeValue(certPathRaw || defaultTlsCertPath);
    const keyPath = sanitizeValue(keyPathRaw || defaultTlsKeyPath);

    if (tlsMode !== 'off') {
      if (!certPath || !keyPath) {
        throw new Error('TLS mode on/require needs both cert and key paths.');
      }
      if (!fs.existsSync(path.resolve(certPath))) {
        throw new Error(`TLS cert not found: ${certPath}`);
      }
      if (!fs.existsSync(path.resolve(keyPath))) {
        throw new Error(`TLS key not found: ${keyPath}`);
      }
    }

    return {
      skip: false,
      host,
      port,
      allowRemote,
      user,
      passwordHash,
      tlsMode,
      certPath,
      keyPath,
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
    `JOBLIO_ALLOW_REMOTE=${sanitizeValue(result.allowRemote)}`,
    'JOBLIO_STRICT_MODE=1',
    `JOBLIO_API_TOKEN=${sanitizeValue(result.apiToken)}`,
    `JOBLIO_BASIC_AUTH_USER=${sanitizeValue(result.user)}`,
    `JOBLIO_BASIC_AUTH_HASH=${sanitizeValue(result.passwordHash)}`,
    `JOBLIO_AUDIT_KEY=${sanitizeValue(result.auditKey)}`,
    `JOBLIO_TLS_MODE=${sanitizeValue(result.tlsMode)}`,
    `JOBLIO_TLS_CERT_PATH=${sanitizeValue(result.certPath)}`,
    `JOBLIO_TLS_KEY_PATH=${sanitizeValue(result.keyPath)}`,
    `JOBLIO_COOKIE_SECURE=${result.tlsMode === 'off' ? '0' : '1'}`,
    'JOBLIO_SESSION_BINDING=strict',
    'JOBLIO_HEALTH_VERBOSE=0',
    'JOBLIO_ERROR_VERBOSE=0',
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
