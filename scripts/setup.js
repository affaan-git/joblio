#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const prompts = require('prompts');
const { createPasswordHash } = require('../lib/auth');
const { parseEnvText } = require('../lib/env-file');
const { isLoopbackHost, isPrivateOrLoopbackHost, isWildcardHost } = require('../lib/network-policy');
const { parseAllowlist, isSafeAllowlistEntry, hasNonLoopbackAllowlistEntry } = require('../lib/ip-allowlist');
const { loadAllowlistFromEnvSync } = require('../lib/allowlist-source');
const { validateTemplateConfig } = require('../lib/template-registry');

const root = path.resolve(__dirname, '..');
const dataDir = path.join(root, '.joblio-data');
const configPath = path.join(dataDir, 'config.env');
const resumeTemplateRoot = path.join(root, 'templates', 'resume');

function randHex(bytes) {
  return crypto.randomBytes(bytes).toString('hex');
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

const PROMPT_OPTIONS = {
  onCancel: () => {
    throw new Error('Setup cancelled by user.');
  },
};

async function promptConfirm(message, initial) {
  const answer = await prompts({
    type: 'confirm',
    name: 'value',
    message,
    initial: Boolean(initial),
  }, PROMPT_OPTIONS);
  if (typeof answer?.value !== 'boolean') {
    throw new Error('Setup cancelled by user.');
  }
  return answer.value;
}

async function promptText(message, initial = '') {
  const answer = await prompts({
    type: 'text',
    name: 'value',
    message,
    initial: String(initial || ''),
  }, PROMPT_OPTIONS);
  if (typeof answer?.value !== 'string') {
    throw new Error('Setup cancelled by user.');
  }
  return sanitizeValue(answer.value);
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
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Interactive setup requires a TTY terminal.');
  }
  const message = String(promptText || '').replace(/:\s*$/, '');
  const answer = await prompts({
    type: 'password',
    name: 'value',
    message,
  }, PROMPT_OPTIONS);
  if (!answer || typeof answer.value !== 'string') {
    throw new Error('Setup cancelled by user.');
  }
  return answer.value;
}

function getSuggestedLanIpv4() {
  const interfaces = os.networkInterfaces();
  for (const values of Object.values(interfaces || {})) {
    for (const info of values || []) {
      if (!info || info.family !== 'IPv4') continue;
      const addr = sanitizeValue(info.address || '');
      if (!addr || isLoopbackHost(addr)) continue;
      if (isPrivateOrLoopbackHost(addr)) {
        return addr;
      }
    }
  }
  return '';
}

async function ensureAllowlistFile(pathRaw, context = {}) {
  const trimmed = sanitizeValue(pathRaw).trim();
  if (!trimmed) {
    throw new Error('IP allowlist file path is required.');
  }
  const resolvedPath = path.resolve(trimmed);
  try {
    const stat = await fsp.stat(resolvedPath);
    if (!stat.isFile()) {
      throw new Error(`IP allowlist path is not a file: ${trimmed}`);
    }
    return;
  } catch (err) {
    if (err && err.code !== 'ENOENT') {
      throw err;
    }
  }

  const createFile = await promptConfirm(`IP allowlist file not found. Create it now? (${trimmed})`, true);
  if (!createFile) {
    throw new Error('IP allowlist file is required when LAN mode or trusted proxy mode is enabled.');
  }

  const parent = path.dirname(resolvedPath);
  await fsp.mkdir(parent, { recursive: true, mode: 0o700 });
  const lines = [];
  const lanHost = sanitizeValue(context.lanHost || '');
  if (lanHost) {
    lines.push(`${lanHost}/32`);
  } else {
    lines.push('127.0.0.1');
  }
  const content = `${lines.join('\n')}\n`;
  await fsp.writeFile(resolvedPath, content, { mode: 0o600 });
  await fsp.chmod(resolvedPath, 0o600).catch(() => {});
}

async function writeAllowlistFile(pathRaw, entries) {
  const trimmed = sanitizeValue(pathRaw).trim();
  if (!trimmed) throw new Error('IP allowlist file path is required.');
  const resolvedPath = path.resolve(trimmed);
  const parent = path.dirname(resolvedPath);
  await fsp.mkdir(parent, { recursive: true, mode: 0o700 });
  const content = `${entries.map((v) => sanitizeValue(v).trim()).filter(Boolean).join('\n')}\n`;
  await fsp.writeFile(resolvedPath, content, { mode: 0o600 });
  await fsp.chmod(resolvedPath, 0o600).catch(() => {});
}

async function askInteractive(existing, options = {}) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Interactive setup requires a TTY terminal.');
  }
  const forceEdit = Boolean(options.forceEdit);
  const exists = Boolean(existing && Object.keys(existing).length > 0);
  if (exists && !forceEdit) {
    const shouldUpdate = await promptConfirm('Existing config found. Update it?', false);
    if (!shouldUpdate) return { skip: true };
  }

  const defaultUser = sanitizeValue(existing.JOBLIO_BASIC_AUTH_USER || 'joblio');
  const userInput = await promptText('Basic auth username', defaultUser);
  const user = sanitizeValue(userInput || defaultUser) || 'joblio';

  const hasExistingHash = String(existing.JOBLIO_BASIC_AUTH_HASH || '').startsWith('scrypt$');
  const passLabel = hasExistingHash
    ? 'Basic auth password (leave blank to keep existing)'
    : 'Basic auth password (min 8 chars, include letter + number + symbol)';
  let pass = await promptHidden(passLabel);
  let useExistingHash = false;
  if (!pass && hasExistingHash) {
    useExistingHash = true;
  }

  let passwordHash = sanitizeValue(existing.JOBLIO_BASIC_AUTH_HASH || '');
  if (!useExistingHash) {
    let pass2 = await promptHidden('Confirm password');
    if (pass !== pass2) throw new Error('Password confirmation did not match.');
    validatePasswordStrength(pass);
    passwordHash = createPasswordHash(pass);
    pass2 = '';
  }
  pass = '';

  const defaultAllowLan = sanitizeValue(existing.JOBLIO_ALLOW_LAN || '0') === '1';
  const allowLan = (await promptConfirm('Allow LAN access from other local devices?', defaultAllowLan)) ? '1' : '0';

  let host = '127.0.0.1';
  if (allowLan === '1') {
    const suggestedLanHost = getSuggestedLanIpv4();
    const existingHost = sanitizeValue(existing.HOST || '');
    const defaultLanHost = (existingHost && !isLoopbackHost(existingHost))
      ? existingHost
      : (suggestedLanHost || '');
    const lanHostRaw = await promptText(
      `LAN bind host (private interface IP, example: ${suggestedLanHost || '192.168.1.25'})`,
      defaultLanHost,
    );
    host = sanitizeValue(lanHostRaw || defaultLanHost);
    if (!host) throw new Error('LAN bind host is required when LAN mode is enabled.');
    if (isWildcardHost(host)) throw new Error('Wildcard bind host is not allowed in LAN mode.');
    if (!isPrivateOrLoopbackHost(host)) throw new Error(`LAN bind host must be private/loopback. Got: ${host}`);
    if (isLoopbackHost(host)) {
      throw new Error('LAN mode requires a non-loopback private interface IP to be reachable from other devices.');
    }
  }

  const defaultPort = parsePort(existing.PORT, 8787);
  const portRaw = await promptText('Port', String(defaultPort));
  const port = parsePort(portRaw, defaultPort);

  const defaultDataDir = sanitizeValue(existing.JOBLIO_DATA_DIR || path.join(root, '.joblio-data'));
  const dataDirRaw = await promptText('Storage data directory', defaultDataDir);
  const runtimeDataDir = sanitizeValue(dataDirRaw || defaultDataDir);
  if (!runtimeDataDir) throw new Error('Storage data directory is required.');

  const defaultBackupDir = sanitizeValue(existing.JOBLIO_BACKUP_DIR || path.join(root, 'backups'));
  const backupDirRaw = await promptText('Backup directory', defaultBackupDir);
  const backupDir = sanitizeValue(backupDirRaw || defaultBackupDir);
  if (!backupDir) throw new Error('Backup directory is required.');

  const defaultTlsCertPath = sanitizeValue(existing.JOBLIO_TLS_CERT_PATH || path.join(runtimeDataDir, 'tls', 'localhost-cert.pem'));
  const defaultTlsKeyPath = sanitizeValue(existing.JOBLIO_TLS_KEY_PATH || path.join(runtimeDataDir, 'tls', 'localhost-key.pem'));
  const certPathRaw = await promptText('TLS cert path', defaultTlsCertPath);
  const keyPathRaw = await promptText('TLS key path', defaultTlsKeyPath);
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
  const rateAuthSessionRaw = await promptText('Auth session rate limit per window', String(defaultRateAuthSession));
  const rateMaxAuthSession = parseIntInRange(rateAuthSessionRaw, defaultRateAuthSession, 1, 100000);

  const defaultAuthFailWindowMs = parseIntInRange(existing.AUTH_FAIL_WINDOW_MS, 10 * 60 * 1000, 1000, 24 * 60 * 60 * 1000);
  const authFailWindowRaw = await promptText('Auth failure window (ms)', String(defaultAuthFailWindowMs));
  const authFailWindowMs = parseIntInRange(authFailWindowRaw, defaultAuthFailWindowMs, 1000, 24 * 60 * 60 * 1000);

  const defaultAuthFailThreshold = parseIntInRange(existing.AUTH_FAIL_THRESHOLD, 5, 1, 1000);
  const authFailThresholdRaw = await promptText('Auth failure threshold', String(defaultAuthFailThreshold));
  const authFailThreshold = parseIntInRange(authFailThresholdRaw, defaultAuthFailThreshold, 1, 1000);

  const defaultAuthLockoutMs = parseIntInRange(existing.AUTH_LOCKOUT_MS, 15 * 60 * 1000, 1000, 24 * 60 * 60 * 1000);
  const authLockoutRaw = await promptText('Auth lockout duration (ms)', String(defaultAuthLockoutMs));
  const authLockoutMs = parseIntInRange(authLockoutRaw, defaultAuthLockoutMs, 1000, 24 * 60 * 60 * 1000);

  const defaultAuthBackoffBaseMs = parseIntInRange(existing.AUTH_BACKOFF_BASE_MS, 250, 1, 60000);
  const authBackoffBaseRaw = await promptText('Auth backoff base (ms)', String(defaultAuthBackoffBaseMs));
  const authBackoffBaseMs = parseIntInRange(authBackoffBaseRaw, defaultAuthBackoffBaseMs, 1, 60000);

  const defaultAuthBackoffMaxMs = parseIntInRange(existing.AUTH_BACKOFF_MAX_MS, 2000, 1, 60000);
  const authBackoffMaxRaw = await promptText('Auth backoff max (ms)', String(defaultAuthBackoffMaxMs));
  const authBackoffMaxMs = parseIntInRange(authBackoffMaxRaw, defaultAuthBackoffMaxMs, 1, 60000);

  const defaultAuthBackoffStartAfter = parseIntInRange(existing.AUTH_BACKOFF_START_AFTER, 2, 1, 1000);
  const authBackoffStartAfterRaw = await promptText('Auth backoff start after failures', String(defaultAuthBackoffStartAfter));
  const authBackoffStartAfter = parseIntInRange(authBackoffStartAfterRaw, defaultAuthBackoffStartAfter, 1, 1000);

  if (authBackoffBaseMs > authBackoffMaxMs) {
    throw new Error('Auth backoff base must be less than or equal to auth backoff max.');
  }

  const defaultAuthGuardMaxEntries = parseIntInRange(existing.AUTH_GUARD_MAX_ENTRIES, 20000, 100, 1000000);
  const authGuardMaxEntriesRaw = await promptText('Auth guard max entries', String(defaultAuthGuardMaxEntries));
  const authGuardMaxEntries = parseIntInRange(authGuardMaxEntriesRaw, defaultAuthGuardMaxEntries, 100, 1000000);

  let trustProxy = '0';
  if (allowLan === '1') {
    trustProxy = '0';
  } else {
    const defaultTrustProxy = sanitizeValue(existing.JOBLIO_TRUST_PROXY || '0') === '1';
    trustProxy = (await promptConfirm('Trust proxy headers for client IP?', defaultTrustProxy)) ? '1' : '0';
  }

  let ipAllowlistPath = '';
  let parsedAllowlist = [];
  if (allowLan === '1' || trustProxy === '1') {
    const defaultAllowlistPath = sanitizeValue(existing.JOBLIO_IP_ALLOWLIST_PATH || path.join(runtimeDataDir, 'allowlist', 'ip-allowlist.txt'));
    const allowlistPathRaw = await promptText(
      'IP allowlist file path (one IP/CIDR per line, example: 192.168.1.25 or 192.168.1.0/24)',
      defaultAllowlistPath,
    );
    ipAllowlistPath = sanitizeValue(allowlistPathRaw || defaultAllowlistPath);
    await ensureAllowlistFile(ipAllowlistPath, { lanHost: allowLan === '1' ? host : '' });
    const loaded = loadAllowlistFromEnvSync({
      JOBLIO_IP_ALLOWLIST_PATH: ipAllowlistPath,
    }, { baseDir: root });
    if (loaded.issues.length) {
      throw new Error(loaded.issues.join('; '));
    }
    const allowlistEntriesRaw = await promptText(
      'IP allowlist entries (comma-separated IP/CIDR; /32 = one device, /24 = subnet)',
      loaded.entries.join(', '),
    );
    parsedAllowlist = parseAllowlist(allowlistEntriesRaw);
  }
  if (allowLan === '1' && !parsedAllowlist.length) {
    throw new Error('LAN mode requires a non-empty IP allowlist.');
  }
  if (trustProxy === '1' && !parsedAllowlist.length) {
    throw new Error('Trusted proxy mode requires a non-empty IP allowlist.');
  }
  if (allowLan === '1' && parsedAllowlist.length && !hasNonLoopbackAllowlistEntry(parsedAllowlist)) {
    throw new Error('LAN mode requires at least one non-loopback IP allowlist entry.');
  }
  if (allowLan === '1') {
    const unsafeEntry = parsedAllowlist.find((entry) => !isSafeAllowlistEntry(entry));
    if (unsafeEntry) {
      throw new Error(`Unsafe IP allowlist entry for LAN mode: ${unsafeEntry}`);
    }
  }
  if (allowLan === '1' || trustProxy === '1') {
    await writeAllowlistFile(ipAllowlistPath, parsedAllowlist);
  }

  const defaultResumeTemplates = sanitizeValue(existing.JOBLIO_RESUME_TEMPLATES || '');
  const resumeTemplatesRaw = await promptText('Resume template paths (CSV, relative to templates/resume). Leave blank to disable.', defaultResumeTemplates);
  const resumeTemplates = sanitizeValue(resumeTemplatesRaw);
  const templateCheck = validateTemplateConfig(resumeTemplates, resumeTemplateRoot, { requireExisting: true, maxBytes: 10 * 1024 * 1024 });
  if (templateCheck.issues.length) {
    throw new Error(templateCheck.issues.join('; '));
  }

  return {
    skip: false,
    allowLan,
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
    ipAllowlistPath,
    resumeTemplates,
    apiToken: sanitizeValue(existing.JOBLIO_API_TOKEN || randHex(32)),
    auditKey: sanitizeValue(existing.JOBLIO_AUDIT_KEY || randHex(32)),
  };
}

async function writeConfig(result) {
  await fsp.mkdir(dataDir, { recursive: true, mode: 0o700 });
  const lines = [
    '# Joblio managed configuration file',
    '# Generated by npm run setup (interactive)',
    `JOBLIO_ALLOW_LAN=${sanitizeValue(result.allowLan)}`,
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
    `JOBLIO_IP_ALLOWLIST_PATH=${sanitizeValue(result.ipAllowlistPath)}`,
    `JOBLIO_RESUME_TEMPLATES=${sanitizeValue(result.resumeTemplates)}`,
    '',
  ];
  const tmp = `${configPath}.tmp`;
  await fsp.writeFile(tmp, lines.join('\n'), { mode: 0o600 });
  await fsp.rename(tmp, configPath);
  await fsp.chmod(configPath, 0o600).catch(() => {});
}

function buildConfigEnv(result) {
  return {
    ...process.env,
    JOBLIO_ALLOW_LAN: sanitizeValue(result.allowLan),
    HOST: sanitizeValue(result.host),
    PORT: sanitizeValue(result.port),
    JOBLIO_API_TOKEN: sanitizeValue(result.apiToken),
    JOBLIO_BASIC_AUTH_USER: sanitizeValue(result.user),
    JOBLIO_BASIC_AUTH_HASH: sanitizeValue(result.passwordHash),
    JOBLIO_AUDIT_KEY: sanitizeValue(result.auditKey),
    JOBLIO_TLS_CERT_PATH: sanitizeValue(result.certPath),
    JOBLIO_TLS_KEY_PATH: sanitizeValue(result.keyPath),
    JOBLIO_DATA_DIR: sanitizeValue(result.runtimeDataDir),
    JOBLIO_BACKUP_DIR: sanitizeValue(result.backupDir),
    JOBLIO_COOKIE_SECURE: '1',
    RATE_MAX_AUTH_SESSION: sanitizeValue(result.rateMaxAuthSession),
    AUTH_FAIL_WINDOW_MS: sanitizeValue(result.authFailWindowMs),
    AUTH_FAIL_THRESHOLD: sanitizeValue(result.authFailThreshold),
    AUTH_LOCKOUT_MS: sanitizeValue(result.authLockoutMs),
    AUTH_BACKOFF_BASE_MS: sanitizeValue(result.authBackoffBaseMs),
    AUTH_BACKOFF_MAX_MS: sanitizeValue(result.authBackoffMaxMs),
    AUTH_BACKOFF_START_AFTER: sanitizeValue(result.authBackoffStartAfter),
    AUTH_GUARD_MAX_ENTRIES: sanitizeValue(result.authGuardMaxEntries),
    JOBLIO_TRUST_PROXY: sanitizeValue(result.trustProxy),
    JOBLIO_IP_ALLOWLIST_PATH: sanitizeValue(result.ipAllowlistPath),
    JOBLIO_RESUME_TEMPLATES: sanitizeValue(result.resumeTemplates),
  };
}

function runValidationStep(name, args, env) {
  const run = spawnSync(process.execPath, args, { cwd: root, env, stdio: 'inherit' });
  if (run.error) {
    throw new Error(`${name} failed: ${run.error.message}`);
  }
  if (run.status !== 0) {
    throw new Error(`${name} failed (exit ${run.status}).`);
  }
}

function runPostSetupValidation(result) {
  const env = buildConfigEnv(result);
  runValidationStep('preflight', ['./scripts/preflight.js'], env);
  runValidationStep('security-check', ['./scripts/security-check.js'], env);
}

async function main() {
  const forceEdit = process.argv.includes('--reconfigure');
  await fsp.mkdir(resumeTemplateRoot, { recursive: true });
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
  console.log('Running post-configuration validation...');
  runPostSetupValidation(result);
  console.log('Setup complete: configuration saved to .joblio-data/config.env');
}

main().catch((err) => {
  console.error(`Setup failed: ${err?.message || String(err)}`);
  process.exit(1);
});
