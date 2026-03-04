#!/usr/bin/env node
'use strict';

const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { verifyPassword } = require('./lib/auth');

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 8787);
const TLS_MODE = process.env.JOBLIO_TLS_MODE || 'off'; // off | on | require
const TLS_CERT_PATH = process.env.JOBLIO_TLS_CERT_PATH || '';
const TLS_KEY_PATH = process.env.JOBLIO_TLS_KEY_PATH || '';
const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, '.joblio-data');
const TEMPLATE_DIR = path.join(ROOT_DIR, 'templates');
const STORAGE_DIR = path.join(DATA_DIR, 'storage');
const TRASH_STORAGE_DIR = path.join(DATA_DIR, 'storage-trash');
const LOG_DIR = path.join(DATA_DIR, 'logs');
const STATE_PATH = path.join(DATA_DIR, 'state.json');
const APP_HTML = path.join(ROOT_DIR, 'Joblio.html');
const RESUME_TEMPLATE_PATH = path.join(TEMPLATE_DIR, 'resume-template.md');
const MAX_JSON_BODY_BYTES = Number(process.env.MAX_JSON_BODY_BYTES || 5 * 1024 * 1024);
const MAX_UPLOAD_JSON_BYTES = Number(process.env.MAX_UPLOAD_JSON_BYTES || 35 * 1024 * 1024);
const MAX_FILE_BYTES = Number(process.env.MAX_FILE_BYTES || 25 * 1024 * 1024);
const MAX_APPS = Number(process.env.MAX_APPS || 10000);
const LOG_ROTATE_BYTES = Number(process.env.LOG_ROTATE_BYTES || 5 * 1024 * 1024);
const API_TOKEN = process.env.JOBLIO_API_TOKEN || '';
const BASIC_AUTH_USER = process.env.JOBLIO_BASIC_AUTH_USER || '';
const BASIC_AUTH_HASH = process.env.JOBLIO_BASIC_AUTH_HASH || '';
const AUDIT_KEY = process.env.JOBLIO_AUDIT_KEY || '';
const HEALTH_VERBOSE = process.env.JOBLIO_HEALTH_VERBOSE === '1';
const ERROR_VERBOSE = process.env.JOBLIO_ERROR_VERBOSE === '1';
const STRICT_MODE = process.env.JOBLIO_STRICT_MODE !== '0';
const ALLOW_REMOTE = process.env.JOBLIO_ALLOW_REMOTE === '1';
const SNAPSHOT_DIR = path.join(DATA_DIR, 'snapshots');
const MAX_SNAPSHOTS = Number(process.env.MAX_SNAPSHOTS || 20);
const PURGE_MIN_AGE_SEC = Number(process.env.PURGE_MIN_AGE_SEC || 120);
const RATE_WINDOW_MS = Number(process.env.RATE_WINDOW_MS || 60 * 1000);
const RATE_MAX_WRITE = Number(process.env.RATE_MAX_WRITE || 180);
const RATE_MAX_UPLOAD = Number(process.env.RATE_MAX_UPLOAD || 24);
const RATE_MAX_DELETE = Number(process.env.RATE_MAX_DELETE || 120);
const RATE_MAX_IMPORT = Number(process.env.RATE_MAX_IMPORT || 10);
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS || 8 * 60 * 60 * 1000);
const SESSION_ABS_TTL_MS = Number(process.env.SESSION_ABS_TTL_MS || 24 * 60 * 60 * 1000);
const SESSION_COOKIE_NAME = 'joblio_sid';
const SESSION_BINDING = process.env.JOBLIO_SESSION_BINDING || 'strict'; // strict | ip | ua | off
const SAFE_ID_RE = /^[a-zA-Z0-9_-]{6,100}$/;
const ALLOWED_STATUS = new Set(['wishlist', 'in_progress', 'applied', 'interview', 'offer', 'rejected', 'closed']);
const ALLOWED_THEME = new Set(['dark', 'light']);
const STORAGE_DIR_ABS = path.resolve(STORAGE_DIR);
const TRASH_STORAGE_DIR_ABS = path.resolve(TRASH_STORAGE_DIR);
const LOG_PATH = path.join(LOG_DIR, 'activity.log');
const LOG_PREV_PATH = path.join(LOG_DIR, 'activity.log.1');
const AUDIT_CHAIN_PATH = path.join(LOG_DIR, 'audit-chain.json');
const SESSION_STORE_PATH = path.join(DATA_DIR, 'sessions.enc');
const rateBuckets = new Map();
const sessions = new Map();

const DEFAULT_STATE = {
  version: 1,
  theme: 'dark',
  activeId: null,
  apps: [],
  trashApps: [],
  trashFiles: [],
  updatedAt: new Date().toISOString(),
};

let writeQueue = Promise.resolve();
let lastErrorMessage = '';
let lastErrorAt = '';
let auditIntegrity = {
  ok: true,
  checkedAt: '',
  message: '',
  entries: 0,
};
let lastAuditVerifyMs = 0;
let transportIsTls = false;
let sessionEpoch = 0;

async function ensureDirs() {
  validateStartupConfig();
  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.mkdir(TEMPLATE_DIR, { recursive: true });
  await fsp.mkdir(STORAGE_DIR, { recursive: true });
  await fsp.mkdir(TRASH_STORAGE_DIR, { recursive: true });
  await fsp.mkdir(LOG_DIR, { recursive: true });
  await fsp.mkdir(SNAPSHOT_DIR, { recursive: true });
  await applyPathPerms(DATA_DIR, 0o700);
  await applyPathPerms(STORAGE_DIR, 0o700);
  await applyPathPerms(TRASH_STORAGE_DIR, 0o700);
  await applyPathPerms(LOG_DIR, 0o700);
  await applyPathPerms(SNAPSHOT_DIR, 0o700);
  await verifyAuditLog();
  await loadSessionStore();
  if (!fs.existsSync(STATE_PATH)) {
    await writeState(DEFAULT_STATE);
  }
}

async function logAction(action, detail = {}) {
  await rotateLogIfNeeded();
  const chain = await readAuditChain();
  const ts = new Date().toISOString();
  const payload = { ts, action, detail };
  const hash = computeAuditHash(chain.lastHash || '', payload);
  const line = `${ts}\t${action}\t${JSON.stringify(detail)}\t${hash}\n`;
  await fsp.appendFile(LOG_PATH, line, 'utf8');
  await applyPathPerms(LOG_PATH, 0o600);
  await writeAuditChain({ lastHash: hash, entries: Number(chain.entries || 0) + 1, lastAt: ts });
}

async function securityEvent(type, detail = {}, level = 'warn') {
  try {
    await logAction(`security.${type}`, detail);
  } catch {}
  const line = `[security:${level}] ${type} ${JSON.stringify(detail)}`;
  if (level === 'error') {
    // eslint-disable-next-line no-console
    console.error(line);
  } else {
    // eslint-disable-next-line no-console
    console.warn(line);
  }
}

async function rotateLogIfNeeded() {
  try {
    const stat = await fsp.stat(LOG_PATH);
    if (stat.size < LOG_ROTATE_BYTES) return;
    try {
      await fsp.unlink(LOG_PREV_PATH);
    } catch {}
    await fsp.rename(LOG_PATH, LOG_PREV_PATH);
    await writeAuditChain({ lastHash: '', entries: 0, lastAt: '' });
  } catch {}
}

function validateStartupConfig() {
  const hostLower = String(HOST || '').trim().toLowerCase();
  const localhostHosts = new Set(['127.0.0.1', 'localhost', '::1']);
  if (!ALLOW_REMOTE && !localhostHosts.has(hostLower)) {
    throw new Error('Refusing non-local bind host. Set HOST=127.0.0.1 or JOBLIO_ALLOW_REMOTE=1.');
  }
  if (STRICT_MODE && !API_TOKEN) {
    throw new Error('JOBLIO_STRICT_MODE=1 requires JOBLIO_API_TOKEN.');
  }
  if (STRICT_MODE && (!BASIC_AUTH_USER || !BASIC_AUTH_HASH)) {
    throw new Error('JOBLIO_STRICT_MODE=1 requires JOBLIO_BASIC_AUTH_USER and JOBLIO_BASIC_AUTH_HASH.');
  }
  if (BASIC_AUTH_HASH && !String(BASIC_AUTH_HASH).startsWith('scrypt$')) {
    throw new Error('JOBLIO_BASIC_AUTH_HASH must be in scrypt$... format. Use: npm run auth:hash -- --password <pass>');
  }
  if (!new Set(['strict', 'ip', 'ua', 'off']).has(SESSION_BINDING)) {
    throw new Error('JOBLIO_SESSION_BINDING must be one of: strict, ip, ua, off');
  }
  if (!new Set(['off', 'on', 'require']).has(TLS_MODE)) {
    throw new Error('JOBLIO_TLS_MODE must be one of: off, on, require');
  }
  if ((TLS_MODE === 'on' || TLS_MODE === 'require') && (!TLS_CERT_PATH || !TLS_KEY_PATH)) {
    throw new Error('TLS enabled but JOBLIO_TLS_CERT_PATH or JOBLIO_TLS_KEY_PATH is missing.');
  }
  if ((TLS_MODE === 'on' || TLS_MODE === 'require') && (TLS_CERT_PATH || TLS_KEY_PATH)) {
    if (!TLS_CERT_PATH || !TLS_KEY_PATH) {
      throw new Error('TLS cert and key must both be provided.');
    }
  }
}

async function applyPathPerms(targetPath, mode) {
  try {
    await fsp.chmod(targetPath, mode);
  } catch {}
}

function computeAuditHash(prevHash, payload) {
  const base = `${prevHash}|${JSON.stringify(payload)}`;
  if (AUDIT_KEY) {
    return crypto.createHmac('sha256', AUDIT_KEY).update(base).digest('hex');
  }
  return crypto.createHash('sha256').update(base).digest('hex');
}

async function readAuditChain() {
  try {
    const raw = await fsp.readFile(AUDIT_CHAIN_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      lastHash: str(parsed?.lastHash, 128),
      entries: Number.isFinite(parsed?.entries) ? parsed.entries : 0,
      lastAt: str(parsed?.lastAt, 64),
    };
  } catch {
    return { lastHash: '', entries: 0, lastAt: '' };
  }
}

async function writeAuditChain(next) {
  const tmp = `${AUDIT_CHAIN_PATH}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(next, null, 2), 'utf8');
  await fsp.rename(tmp, AUDIT_CHAIN_PATH);
  await applyPathPerms(AUDIT_CHAIN_PATH, 0o600);
}

async function verifyAuditLog() {
  try {
    if (!fs.existsSync(LOG_PATH)) {
      auditIntegrity = { ok: true, checkedAt: new Date().toISOString(), message: 'No log yet', entries: 0 };
      return;
    }
    const raw = await fsp.readFile(LOG_PATH, 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    let prevHash = '';
    let entries = 0;
    for (const line of lines) {
      const parts = line.split('\t');
      if (parts.length < 4) throw new Error('Invalid audit line format');
      const ts = parts[0];
      const action = parts[1];
      const detailRaw = parts.slice(2, parts.length - 1).join('\t');
      const hash = parts[parts.length - 1];
      const detail = JSON.parse(detailRaw);
      const computed = computeAuditHash(prevHash, { ts, action, detail });
      if (hash !== computed) throw new Error('Audit hash mismatch');
      prevHash = hash;
      entries += 1;
    }
    const chain = await readAuditChain();
    if (chain.lastHash && chain.lastHash !== prevHash) {
      throw new Error('Audit chain pointer mismatch');
    }
    auditIntegrity = { ok: true, checkedAt: new Date().toISOString(), message: '', entries };
    lastAuditVerifyMs = Date.now();
  } catch (err) {
    auditIntegrity = { ok: false, checkedAt: new Date().toISOString(), message: err?.message || String(err), entries: 0 };
    lastErrorMessage = auditIntegrity.message;
    lastErrorAt = new Date().toISOString();
    lastAuditVerifyMs = Date.now();
  }
}

function sessionStoreKey() {
  return crypto.createHash('sha256').update(`${API_TOKEN}:session-store`).digest();
}

function encryptSessionStore(payloadObj) {
  const key = sessionStoreKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(payloadObj), 'utf8');
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    v: 1,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: enc.toString('base64'),
  });
}

function decryptSessionStore(raw) {
  const parsed = JSON.parse(raw);
  if (parsed?.v !== 1) throw new Error('Unsupported session store version');
  const key = sessionStoreKey();
  const iv = Buffer.from(String(parsed.iv || ''), 'base64');
  const tag = Buffer.from(String(parsed.tag || ''), 'base64');
  const data = Buffer.from(String(parsed.data || ''), 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  return JSON.parse(dec);
}

async function loadSessionStore() {
  try {
    if (!fs.existsSync(SESSION_STORE_PATH)) return;
    const raw = await fsp.readFile(SESSION_STORE_PATH, 'utf8');
    const parsed = decryptSessionStore(raw);
    sessionEpoch = Number.isFinite(parsed?.epoch) ? parsed.epoch : 0;
    sessions.clear();
    const arr = Array.isArray(parsed?.sessions) ? parsed.sessions : [];
    for (const entry of arr) {
      if (!entry || typeof entry !== 'object') continue;
      if (!entry.sid || typeof entry.sid !== 'string') continue;
      sessions.set(entry.sid, entry);
    }
    pruneExpiredSessions();
  } catch (err) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    try {
      if (fs.existsSync(SESSION_STORE_PATH)) {
        await fsp.rename(SESSION_STORE_PATH, `${SESSION_STORE_PATH}.corrupt-${stamp}`);
      }
    } catch {}
    sessions.clear();
    sessionEpoch += 1;
    await persistSessionStore();
    await securityEvent('session_store_load_failed_recovered', { message: err?.message || String(err) }, 'warn');
  }
}

async function persistSessionStore() {
  try {
    const payload = {
      epoch: sessionEpoch,
      sessions: [...sessions.values()],
      updatedAt: new Date().toISOString(),
    };
    const enc = encryptSessionStore(payload);
    const tmp = `${SESSION_STORE_PATH}.tmp`;
    await fsp.writeFile(tmp, enc, 'utf8');
    await applyPathPerms(tmp, 0o600);
    await fsp.rename(tmp, SESSION_STORE_PATH);
    await applyPathPerms(SESSION_STORE_PATH, 0o600);
  } catch (err) {
    await securityEvent('session_store_persist_failed', { message: err?.message || String(err) }, 'error');
  }
}

async function readState() {
  try {
    const raw = await fsp.readFile(STATE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return sanitizeState(parsed);
  } catch {
    const recovered = await recoverStateFromSnapshots();
    if (recovered) {
      await writeState(recovered, { skipSnapshot: true });
      await logAction('state.recovered', { source: 'snapshot' });
      return recovered;
    }
    return { ...DEFAULT_STATE };
  }
}

async function writeState(next, options = {}) {
  const clean = sanitizeState(next);
  clean.updatedAt = new Date().toISOString();
  if (!options.skipSnapshot) {
    await snapshotCurrentState();
  }
  const tmp = `${STATE_PATH}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(clean, null, 2), 'utf8');
  await applyPathPerms(tmp, 0o600);
  await fsp.rename(tmp, STATE_PATH);
  await applyPathPerms(STATE_PATH, 0o600);
  return clean;
}

function snapshotStamp() {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}

async function snapshotCurrentState() {
  try {
    if (!fs.existsSync(STATE_PATH)) return;
    const name = `state-${snapshotStamp()}.json`;
    const outPath = path.join(SNAPSHOT_DIR, name);
    await fsp.copyFile(STATE_PATH, outPath);
    await applyPathPerms(outPath, 0o600);
    await pruneSnapshots();
  } catch {}
}

async function pruneSnapshots() {
  try {
    const files = (await fsp.readdir(SNAPSHOT_DIR))
      .filter((f) => /^state-\d{8}-\d{6}\.json$/.test(f))
      .sort();
    if (files.length <= MAX_SNAPSHOTS) return;
    const toDelete = files.slice(0, files.length - MAX_SNAPSHOTS);
    await Promise.all(toDelete.map((f) => fsp.unlink(path.join(SNAPSHOT_DIR, f)).catch(() => {})));
  } catch {}
}

async function recoverStateFromSnapshots() {
  try {
    const files = (await fsp.readdir(SNAPSHOT_DIR))
      .filter((f) => /^state-\d{8}-\d{6}\.json$/.test(f))
      .sort()
      .reverse();
    for (const file of files) {
      try {
        const raw = await fsp.readFile(path.join(SNAPSHOT_DIR, file), 'utf8');
        const parsed = JSON.parse(raw);
        const clean = sanitizeState(parsed);
        if (Array.isArray(clean.apps) && Array.isArray(clean.trashApps)) return clean;
      } catch {}
    }
    return null;
  } catch {
    return null;
  }
}

function queueMutation(fn) {
  const run = writeQueue.then(() => fn());
  writeQueue = run.catch(() => {});
  return run;
}

function sanitizeState(input) {
  const base = input && typeof input === 'object' ? input : {};
  const out = {
    version: 1,
    theme: ALLOWED_THEME.has(base.theme) ? base.theme : 'dark',
    activeId: isSafeId(base.activeId) ? base.activeId : null,
    apps: Array.isArray(base.apps) ? base.apps : [],
    trashApps: Array.isArray(base.trashApps) ? base.trashApps : [],
    trashFiles: Array.isArray(base.trashFiles) ? base.trashFiles : [],
    updatedAt: typeof base.updatedAt === 'string' ? base.updatedAt : new Date().toISOString(),
  };
  out.apps = out.apps.map(sanitizeApp).filter(Boolean);
  out.trashApps = out.trashApps.map(sanitizeApp).filter(Boolean);
  out.trashFiles = out.trashFiles.map(sanitizeTrashFile).filter(Boolean);
  out.apps = dedupeById(out.apps);
  out.trashApps = dedupeById(out.trashApps);
  out.trashFiles = dedupeById(out.trashFiles);
  out.apps.forEach((app) => {
    app.workspaceFiles = dedupeById(Array.isArray(app.workspaceFiles) ? app.workspaceFiles : []);
  });
  out.trashApps.forEach((app) => {
    app.workspaceFiles = dedupeById(Array.isArray(app.workspaceFiles) ? app.workspaceFiles : []);
  });
  out.trashFiles = out.trashFiles.filter((f) => f.appId);
  return out;
}

function sanitizeApp(app) {
  if (!app || typeof app !== 'object') return null;
  const id = isSafeId(app.id) ? app.id : crypto.randomUUID();
  return {
    id,
    company: str(app.company, 180),
    title: str(app.title, 180),
    location: str(app.location, 180),
    workMode: str(app.workMode || 'Unknown', 40),
    status: normalizeStatus(app.status),
    statusHistory: Array.isArray(app.statusHistory)
      ? app.statusHistory
          .map((h) => ({ status: normalizeStatus(h?.status), at: str(h?.at, 64) }))
          .filter((h) => h.status)
          .slice(0, 200)
      : [],
    statusUpdatedAt: str(app.statusUpdatedAt, 64),
    appliedAt: str(app.appliedAt, 32),
    nextFollowUpAt: str(app.nextFollowUpAt, 32),
    jobUrl: str(app.jobUrl, 500),
    applicationUrl: str(app.applicationUrl, 500),
    note: str(app.note, 20000),
    descriptionText: str(app.descriptionText || app.intakeText, 200000),
    workspaceFiles: Array.isArray(app.workspaceFiles)
      ? app.workspaceFiles
          .map((f) => {
            if (typeof f === 'string') return { id: crypto.randomUUID(), name: f, size: null, type: '' };
            if (!f || typeof f !== 'object') return null;
            return {
              id: isSafeId(f.id) ? f.id : crypto.randomUUID(),
              name: str(f.name, 255),
              size: Number.isFinite(f.size) ? f.size : null,
              type: str(f.type, 120),
            };
          })
          .filter(Boolean)
          .slice(0, 200)
      : [],
    createdAt: str(app.createdAt, 64),
    updatedAt: str(app.updatedAt, 64),
    deletedAt: str(app.deletedAt, 64),
  };
}

function sanitizeTrashFile(file) {
  if (!file || typeof file !== 'object') return null;
  return {
    id: isSafeId(file.id) ? file.id : crypto.randomUUID(),
    appId: isSafeId(file.appId) ? file.appId : '',
    name: str(file.name, 255),
    type: str(file.type, 120),
    size: Number.isFinite(file.size) ? file.size : null,
    deletedAt: str(file.deletedAt, 64) || new Date().toISOString(),
  };
}

function str(v, maxLen = 4000) {
  if (typeof v !== 'string') return '';
  return v.length > maxLen ? v.slice(0, maxLen) : v;
}

function isSafeId(v) {
  return typeof v === 'string' && SAFE_ID_RE.test(v);
}

function normalizeStatus(v) {
  return ALLOWED_STATUS.has(v) ? v : 'wishlist';
}

function dedupeById(items) {
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(items) ? items : []) {
    const id = typeof item?.id === 'string' ? item.id : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(item);
  }
  return out;
}

function ageSeconds(iso) {
  const d = new Date(str(iso, 64));
  if (Number.isNaN(d.getTime())) return Number.MAX_SAFE_INTEGER;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
}

function storagePathForApp(appId) {
  if (!isSafeId(appId)) {
    const err = new Error('Invalid app id');
    err.statusCode = 400;
    throw err;
  }
  const resolved = path.resolve(path.join(STORAGE_DIR_ABS, appId));
  if (!(resolved === STORAGE_DIR_ABS || resolved.startsWith(`${STORAGE_DIR_ABS}${path.sep}`))) {
    const err = new Error('Invalid storage path');
    err.statusCode = 400;
    throw err;
  }
  return resolved;
}

function filePathInDir(dir, filename) {
  const resolved = path.resolve(path.join(dir, filename));
  if (!(resolved === dir || resolved.startsWith(`${dir}${path.sep}`))) {
    const err = new Error('Invalid file path');
    err.statusCode = 400;
    throw err;
  }
  return resolved;
}

function applySecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (transportIsTls) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
}

function requireWriteAuth(req, res) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method || '')) return true;
  if (!isTrustedRequestOrigin(req)) {
    json(res, 403, { error: 'Forbidden origin' });
    return false;
  }
  return true;
}

function hasValidBasicAuth(req) {
  if (!STRICT_MODE) return true;
  if (!BASIC_AUTH_USER || !BASIC_AUTH_HASH) return false;
  const auth = String(req.headers.authorization || '');
  if (!auth.startsWith('Basic ')) return false;
  try {
    const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
    const idx = decoded.indexOf(':');
    if (idx < 0) return false;
    const user = decoded.slice(0, idx);
    const pass = decoded.slice(idx + 1);
    if (user !== BASIC_AUTH_USER) return false;
    return verifyPassword(pass, BASIC_AUTH_HASH);
  } catch {
    return false;
  }
}

function requireBasicAuth(req, res) {
  if (hasValidBasicAuth(req)) return true;
  const hasHeader = Boolean(String(req.headers.authorization || '').trim());
  if (hasHeader) {
    securityEvent('basic_auth_failed', { ip: getClientIp(req), path: req.url || '', method: req.method || '' }, 'warn');
  }
  applySecurityHeaders(res);
  res.setHeader('WWW-Authenticate', 'Basic realm="Joblio", charset="UTF-8"');
  res.writeHead(401, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify({ error: 'Unauthorized' }));
  return false;
}

function isTrustedRequestOrigin(req) {
  const host = String(req.headers.host || '');
  if (!host) return false;
  const origin = String(req.headers.origin || '');
  if (origin) {
    try {
      const u = new URL(origin);
      return u.host === host;
    } catch {
      return false;
    }
  }
  const referer = String(req.headers.referer || '');
  if (referer) {
    try {
      const u = new URL(referer);
      return u.host === host;
    } catch {
      return false;
    }
  }
  // Allow non-browser clients (curl/scripts) with no origin headers.
  return true;
}

function parseCookies(req) {
  const raw = String(req.headers.cookie || '');
  if (!raw) return {};
  const out = {};
  raw.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx <= 0) return;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!key) return;
    out[key] = decodeURIComponent(value);
  });
  return out;
}

function hashSessionParts(...parts) {
  return crypto.createHmac('sha256', API_TOKEN).update(parts.join('|')).digest('hex');
}

function sessionBindingMaterial(req) {
  const ua = str(req.headers['user-agent'], 300);
  const ip = getClientIp(req);
  if (SESSION_BINDING === 'off') return '';
  if (SESSION_BINDING === 'ip') return `ip:${ip}`;
  if (SESSION_BINDING === 'ua') return `ua:${ua}`;
  return `ua:${ua}|ip:${ip}`;
}

function makeSetCookie(value, maxAgeSec) {
  const attrs = [`${SESSION_COOKIE_NAME}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${maxAgeSec}`];
  if (reqIsTlsExpected()) attrs.push('Secure');
  return attrs.join('; ');
}

function reqIsTlsExpected() {
  return process.env.JOBLIO_COOKIE_SECURE === '1' || transportIsTls;
}

function createSessionRecord(req) {
  const sid = crypto.randomUUID();
  const now = Date.now();
  const createdAt = new Date(now).toISOString();
  const binding = sessionBindingMaterial(req);
  const sig = hashSessionParts(sid, createdAt, binding);
  const csrfToken = hashSessionParts('csrf', sid, createdAt, binding).slice(0, 48);
  const record = {
    sid,
    sig,
    csrfToken,
    createdAt,
    lastSeenAt: createdAt,
    binding,
    epoch: sessionEpoch,
  };
  sessions.set(sid, record);
  pruneExpiredSessions();
  persistSessionStore();
  return record;
}

function pruneExpiredSessions() {
  const now = Date.now();
  let changed = false;
  for (const [sid, session] of sessions.entries()) {
    const createdMs = Date.parse(session.createdAt);
    const lastMs = Date.parse(session.lastSeenAt);
    if (!Number.isFinite(createdMs) || !Number.isFinite(lastMs)) {
      sessions.delete(sid);
      changed = true;
      continue;
    }
    if (now - createdMs > SESSION_ABS_TTL_MS || now - lastMs > SESSION_TTL_MS) {
      sessions.delete(sid);
      changed = true;
    }
  }
  if (changed) persistSessionStore();
}

function getSessionFromRequest(req) {
  pruneExpiredSessions();
  const cookies = parseCookies(req);
  const sid = str(cookies[SESSION_COOKIE_NAME], 120);
  if (!sid) return null;
  const rec = sessions.get(sid);
  if (!rec) return null;
  if (Number(rec.epoch || 0) !== sessionEpoch) {
    sessions.delete(sid);
    securityEvent('session_epoch_mismatch', { sid }, 'warn');
    return null;
  }
  const binding = sessionBindingMaterial(req);
  const expectedSig = hashSessionParts(rec.sid, rec.createdAt, binding);
  if (rec.sig !== expectedSig) {
    sessions.delete(sid);
    securityEvent('session_signature_mismatch', { sid }, 'warn');
    return null;
  }
  rec.lastSeenAt = new Date().toISOString();
  rec.binding = binding;
  sessions.set(sid, rec);
  return rec;
}

function requireApiSession(req, res) {
  const session = getSessionFromRequest(req);
  if (session) return session;
  securityEvent('api_session_missing_or_invalid', { ip: getClientIp(req), path: req.url || '', method: req.method || '' }, 'warn');
  json(res, 401, { error: 'Unauthorized' });
  return null;
}

function requireCsrf(req, res, session) {
  const header = str(req.headers['x-joblio-csrf'], 120);
  if (header && header === session.csrfToken) return true;
  securityEvent('csrf_invalid', { ip: getClientIp(req), path: req.url || '', method: req.method || '' }, 'warn');
  json(res, 403, { error: 'Invalid CSRF token' });
  return false;
}

function getClientIp(req) {
  const xff = String(req.headers['x-forwarded-for'] || '').trim();
  if (xff) return xff.split(',')[0].trim();
  return String(req.socket?.remoteAddress || 'unknown');
}

function routeBucket(pathname, method) {
  if (pathname === '/api/files/upload' && method === 'POST') return { key: 'upload', max: RATE_MAX_UPLOAD };
  if (pathname === '/api/import' && method === 'POST') return { key: 'import', max: RATE_MAX_IMPORT };
  if (pathname.startsWith('/api/files/') && method === 'DELETE') return { key: 'delete', max: RATE_MAX_DELETE };
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method || '')) return { key: 'write', max: RATE_MAX_WRITE };
  return null;
}

function enforceRateLimit(req, res, pathname) {
  const bucket = routeBucket(pathname, req.method || '');
  if (!bucket) return true;
  const now = Date.now();
  if (rateBuckets.size > 5000) {
    for (const [k, v] of rateBuckets.entries()) {
      if (!v || now >= v.resetAt) rateBuckets.delete(k);
    }
  }
  const ip = getClientIp(req);
  const key = `${ip}:${bucket.key}`;
  let entry = rateBuckets.get(key);
  if (!entry || now >= entry.resetAt) {
    entry = { count: 0, resetAt: now + RATE_WINDOW_MS };
  }
  entry.count += 1;
  rateBuckets.set(key, entry);
  if (entry.count > bucket.max) {
    const retryAfterSec = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    securityEvent('rate_limit_exceeded', { ip, bucket: bucket.key, count: entry.count, max: bucket.max }, 'warn');
    res.setHeader('Retry-After', String(retryAfterSec));
    json(res, 429, { error: 'Too many requests', retryAfterSec });
    return false;
  }
  return true;
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  applySecurityHeaders(res);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function notFound(res) {
  json(res, 404, { error: 'Not found' });
}

function serverError(res, err) {
  lastErrorMessage = err?.message || String(err);
  lastErrorAt = new Date().toISOString();
  json(res, 500, ERROR_VERBOSE ? { error: 'Server error', detail: err?.message || String(err) } : { error: 'Server error' });
}

async function readBody(req, maxBytes = MAX_JSON_BODY_BYTES) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) {
      req.destroy();
      const err = new Error(`Payload too large (${total} bytes)`);
      err.statusCode = 413;
      throw err;
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    const err = new Error('Invalid JSON body');
    err.statusCode = 400;
    throw err;
  }
}

function safeFilename(name) {
  return String(name || 'file').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 140) || 'file';
}

async function ensureAppStorageDir(appId) {
  const dir = storagePathForApp(appId);
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}

async function findStoredFilePath(appId, fileId) {
  if (!isSafeId(fileId)) return null;
  const dir = storagePathForApp(appId);
  try {
    const files = await fsp.readdir(dir);
    const found = files.find((name) => name.startsWith(`${fileId}-`));
    return found ? filePathInDir(dir, found) : null;
  } catch {
    return null;
  }
}

async function moveFileToTrashStorage(appId, fileId) {
  const fullPath = await findStoredFilePath(appId, fileId);
  if (!fullPath) return null;
  const base = path.basename(fullPath);
  const trashPath = filePathInDir(TRASH_STORAGE_DIR_ABS, `${appId}__${base}`);
  await fsp.rename(fullPath, trashPath);
  return trashPath;
}

async function findTrashedFilePath(appId, fileId) {
  if (!isSafeId(appId) || !isSafeId(fileId)) return null;
  const prefix = `${appId}__${fileId}-`;
  try {
    const files = await fsp.readdir(TRASH_STORAGE_DIR_ABS);
    const found = files.find((name) => name.startsWith(prefix));
    return found ? filePathInDir(TRASH_STORAGE_DIR_ABS, found) : null;
  } catch {
    return null;
  }
}

async function handleApi(req, res, url) {
  if (req.method === 'POST' && url.pathname === '/api/auth/session') {
    if (!requireWriteAuth(req, res)) return;
    if (!enforceRateLimit(req, res, url.pathname)) return;
    const session = createSessionRecord(req);
    res.setHeader('Set-Cookie', makeSetCookie(session.sid, Math.floor(SESSION_TTL_MS / 1000)));
    return json(res, 200, {
      ok: true,
      csrfToken: session.csrfToken,
      expiresInSec: Math.floor(SESSION_TTL_MS / 1000),
      at: new Date().toISOString(),
    });
  }

  const session = requireApiSession(req, res);
  if (!session) return;
  if (!requireWriteAuth(req, res)) return;
  if (!enforceRateLimit(req, res, url.pathname)) return;
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method || '') && url.pathname !== '/api/auth/session') {
    if (!requireCsrf(req, res, session)) return;
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
    sessions.delete(session.sid);
    persistSessionStore();
    res.setHeader('Set-Cookie', makeSetCookie('', 0));
    return json(res, 200, { ok: true, at: new Date().toISOString() });
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/revoke-all') {
    sessionEpoch += 1;
    sessions.clear();
    await persistSessionStore();
    res.setHeader('Set-Cookie', makeSetCookie('', 0));
    await securityEvent('sessions_revoked_all', { bySid: session.sid, epoch: sessionEpoch }, 'warn');
    return json(res, 200, { ok: true, epoch: sessionEpoch, at: new Date().toISOString() });
  }

  if (req.method === 'GET' && url.pathname === '/api/health') {
    if (Date.now() - lastAuditVerifyMs > 30000) {
      await verifyAuditLog();
    }
    const wantsVerbose = url.searchParams.get('verbose') === '1';
    const canViewVerbose = HEALTH_VERBOSE || Boolean(session);
    const base = { ok: true, at: new Date().toISOString() };
    if (!(wantsVerbose && canViewVerbose)) return json(res, 200, base);
    return json(res, 200, {
      ...base,
      uptimeSec: Math.floor(process.uptime()),
      hasError: Boolean(lastErrorMessage),
      lastError: lastErrorMessage || null,
      lastErrorAt: lastErrorAt || null,
      limits: {
        maxJsonBodyBytes: MAX_JSON_BODY_BYTES,
        maxUploadJsonBytes: MAX_UPLOAD_JSON_BYTES,
        maxFileBytes: MAX_FILE_BYTES,
        purgeMinAgeSec: PURGE_MIN_AGE_SEC,
        rateWindowMs: RATE_WINDOW_MS,
        rateMaxWrite: RATE_MAX_WRITE,
        rateMaxUpload: RATE_MAX_UPLOAD,
        rateMaxDelete: RATE_MAX_DELETE,
        rateMaxImport: RATE_MAX_IMPORT,
        sessionTtlMs: SESSION_TTL_MS,
        sessionAbsTtlMs: SESSION_ABS_TTL_MS,
        sessionBinding: SESSION_BINDING,
      },
      audit: auditIntegrity,
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/integrity/verify') {
    await verifyAuditLog();
    return json(res, 200, { ok: auditIntegrity.ok, audit: auditIntegrity, at: new Date().toISOString() });
  }

  if (req.method === 'GET' && url.pathname === '/api/template/resume') {
    let content = '';
    try {
      content = await fsp.readFile(RESUME_TEMPLATE_PATH, 'utf8');
    } catch {
      content = '# Joblio Resume Template\n\n## Header\n- Name\n- Email\n- Location\n- LinkedIn / Portfolio\n\n## Summary\n2-4 lines tailored to the role.\n\n## Experience\n- Role, Company, Dates\n- Impact bullets (metrics)\n\n## Skills\n- Languages\n- Frameworks\n- Tools\n';
    }
    applySecurityHeaders(res);
    res.writeHead(200, {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': 'attachment; filename="joblio-resume-template.md"',
      'Cache-Control': 'no-store',
    });
    res.end(content);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/state') {
    const state = await readState();
    return json(res, 200, { state });
  }

  if (req.method === 'PUT' && url.pathname === '/api/state') {
    const body = await readBody(req, MAX_JSON_BODY_BYTES);
    if (!body || typeof body !== 'object' || !body.state || typeof body.state !== 'object') {
      return json(res, 400, { error: 'Expected { state } payload' });
    }
    const next = await queueMutation(async () => {
      const current = await readState();
      const incoming = sanitizeState({
        version: 1,
        theme: body.state.theme,
        activeId: body.state.activeId,
        apps: Array.isArray(body.state.apps) ? body.state.apps : current.apps,
        trashApps: Array.isArray(body.state.trashApps) ? body.state.trashApps : current.trashApps,
        trashFiles: Array.isArray(body.state.trashFiles) ? body.state.trashFiles : current.trashFiles,
      });
      if (incoming.apps.length > MAX_APPS || incoming.trashApps.length > MAX_APPS) {
        throw new Error(`Too many applications (limit ${MAX_APPS})`);
      }
      return writeState(incoming);
    });
    await logAction('state.put', { apps: next.apps.length, trashApps: next.trashApps.length, trashFiles: next.trashFiles.length });
    return json(res, 200, { state: next });
  }

  if (req.method === 'POST' && url.pathname === '/api/files/upload') {
    const body = await readBody(req, MAX_UPLOAD_JSON_BYTES);
    const appId = str(body.appId);
    const fileName = str(body.name);
    const base64 = str(body.contentBase64);
    if (!appId || !fileName || !base64) {
      return json(res, 400, { error: 'appId, name, contentBase64 are required' });
    }
    if (!isSafeId(appId)) {
      return json(res, 400, { error: 'Invalid appId' });
    }
    const state = await readState();
    if (!state.apps.some((a) => a.id === appId) && !state.trashApps.some((a) => a.id === appId)) {
      return json(res, 400, { error: 'App not found for upload' });
    }
    const id = crypto.randomUUID();
    const safeName = safeFilename(fileName);
    const dir = await ensureAppStorageDir(appId);
    const filePath = filePathInDir(dir, `${id}-${safeName}`);
    if (!/^[a-zA-Z0-9+/=\r\n]+$/.test(base64)) {
      return json(res, 400, { error: 'Invalid base64 file content' });
    }
    const buffer = Buffer.from(base64, 'base64');
    if (buffer.byteLength > MAX_FILE_BYTES) {
      return json(res, 413, { error: `File too large (${buffer.byteLength} bytes). Limit: ${MAX_FILE_BYTES}` });
    }
    await fsp.writeFile(filePath, buffer);
    const registered = await queueMutation(async () => {
      const nextState = await readState();
      const app = nextState.apps.find((a) => a.id === appId) || nextState.trashApps.find((a) => a.id === appId);
      if (!app) return null;
      if (!Array.isArray(app.workspaceFiles)) app.workspaceFiles = [];
      if (!app.workspaceFiles.some((f) => f.id === id)) {
        app.workspaceFiles.push({
          id,
          name: fileName,
          type: str(body.type),
          size: Number.isFinite(body.size) ? body.size : buffer.byteLength,
        });
      }
      return writeState(nextState);
    });
    if (!registered) {
      try { await fsp.unlink(filePath); } catch {}
      return json(res, 400, { error: 'App not found when registering uploaded file' });
    }
    await logAction('file.upload', { appId, fileId: id, name: safeName, size: buffer.byteLength });
    return json(res, 200, {
      file: {
        id,
        name: fileName,
        type: str(body.type),
        size: Number.isFinite(body.size) ? body.size : buffer.byteLength,
      },
      state: registered,
    });
  }

  const downloadMatch = url.pathname.match(/^\/api\/files\/([^/]+)\/download$/);
  if (req.method === 'GET' && downloadMatch) {
    const fileId = downloadMatch[1];
    if (!isSafeId(fileId)) return json(res, 400, { error: 'Invalid file id' });
    const state = await readState();
    let app = state.apps.find((a) => a.workspaceFiles.some((f) => f.id === fileId));
    if (!app) app = state.trashApps.find((a) => a.workspaceFiles.some((f) => f.id === fileId));
    const trashFile = !app ? state.trashFiles.find((f) => f.id === fileId) : null;
    if (!app && !trashFile) return notFound(res);
    const file = app ? app.workspaceFiles.find((f) => f.id === fileId) : trashFile;
    const fullPath = app ? await findStoredFilePath(app.id, fileId) : await findTrashedFilePath(trashFile.appId, fileId);
    if (!fullPath || !fs.existsSync(fullPath)) return notFound(res);
    const stat = await fsp.stat(fullPath);
    applySecurityHeaders(res);
    res.writeHead(200, {
      'Content-Type': file.type || 'application/octet-stream',
      'Content-Length': stat.size,
      'Content-Disposition': `attachment; filename="${safeFilename(file.name || 'file')}"`,
      'Cache-Control': 'no-store',
    });
    fs.createReadStream(fullPath).pipe(res);
    return;
  }

  const deleteFileMatch = url.pathname.match(/^\/api\/files\/([^/]+)$/);
  if (req.method === 'DELETE' && deleteFileMatch) {
    const fileId = deleteFileMatch[1];
    if (!isSafeId(fileId)) return json(res, 400, { error: 'Invalid file id' });
    const outcome = await queueMutation(async () => {
      const state = await readState();
      for (const app of [...state.apps, ...state.trashApps]) {
        const idx = app.workspaceFiles.findIndex((f) => f.id === fileId);
        if (idx === -1) continue;
        const [deleted] = app.workspaceFiles.splice(idx, 1);
        await moveFileToTrashStorage(app.id, fileId);
        state.trashFiles.unshift({
          id: deleted.id,
          appId: app.id,
          name: deleted.name,
          type: deleted.type || '',
          size: Number.isFinite(deleted.size) ? deleted.size : null,
          deletedAt: new Date().toISOString(),
        });
        const next = await writeState(state);
        return { next, appId: app.id, deleted };
      }
      return null;
    });
    if (!outcome) return notFound(res);
    await logAction('file.delete', { appId: outcome.appId, fileId, name: outcome.deleted?.name || '' });
    return json(res, 200, { ok: true, state: outcome.next });
  }

  const restoreFileMatch = url.pathname.match(/^\/api\/files\/([^/]+)\/restore$/);
  if (req.method === 'POST' && restoreFileMatch) {
    const fileId = restoreFileMatch[1];
    if (!isSafeId(fileId)) return json(res, 400, { error: 'Invalid file id' });
    const body = await readBody(req, MAX_JSON_BODY_BYTES);
    const targetAppId = str(body.appId);
    const outcome = await queueMutation(async () => {
      const state = await readState();
      const idx = state.trashFiles.findIndex((f) => f.id === fileId);
      if (idx === -1) return { error: 404, message: 'Not found' };
      const file = state.trashFiles[idx];
      const appId = targetAppId || file.appId;
      if (!isSafeId(appId)) return { error: 400, message: 'Invalid target app id' };
      const app = state.apps.find((a) => a.id === appId) || state.trashApps.find((a) => a.id === appId);
      if (!app) return { error: 400, message: 'Target app not found for restore' };
      const trashedPath = await findTrashedFilePath(file.appId, file.id);
      if (!trashedPath || !fs.existsSync(trashedPath)) return { error: 404, message: 'Trashed file content not found' };
      const dir = await ensureAppStorageDir(app.id);
      const restoredPath = filePathInDir(dir, `${file.id}-${safeFilename(file.name)}`);
      await fsp.rename(trashedPath, restoredPath);
      app.workspaceFiles.push({ id: file.id, name: file.name, type: file.type, size: file.size });
      state.trashFiles.splice(idx, 1);
      const next = await writeState(state);
      return { next, appId: app.id, file };
    });
    if (outcome?.error) return json(res, outcome.error, { error: outcome.message });
    await logAction('file.restore', { appId: outcome.appId, fileId: outcome.file.id, name: outcome.file.name });
    return json(res, 200, { ok: true, state: outcome.next });
  }

  const purgeFileMatch = url.pathname.match(/^\/api\/files\/([^/]+)\/purge$/);
  if (req.method === 'DELETE' && purgeFileMatch) {
    const fileId = purgeFileMatch[1];
    if (!isSafeId(fileId)) return json(res, 400, { error: 'Invalid file id' });
    const outcome = await queueMutation(async () => {
      const state = await readState();
      const tIdx = state.trashFiles.findIndex((f) => f.id === fileId);
      if (tIdx !== -1) {
        const file = state.trashFiles[tIdx];
        const ageSec = ageSeconds(file.deletedAt);
        if (ageSec < PURGE_MIN_AGE_SEC) {
          return { error: 409, message: `File can be permanently deleted in ${PURGE_MIN_AGE_SEC - ageSec}s` };
        }
        const trashedPath = await findTrashedFilePath(file.appId, file.id);
        if (trashedPath && fs.existsSync(trashedPath)) {
          await fsp.unlink(trashedPath);
        }
        state.trashFiles.splice(tIdx, 1);
        const next = await writeState(state);
        return { next, type: 'trash', appId: file.appId, name: file.name, id: file.id };
      }

      for (const app of [...state.apps, ...state.trashApps]) {
        const idx = app.workspaceFiles.findIndex((f) => f.id === fileId);
        if (idx === -1) continue;
        const [deleted] = app.workspaceFiles.splice(idx, 1);
        const fullPath = await findStoredFilePath(app.id, fileId);
        if (fullPath && fs.existsSync(fullPath)) await fsp.unlink(fullPath);
        const next = await writeState(state);
        return { next, type: 'live', appId: app.id, name: deleted?.name || '', id: fileId };
      }
      return null;
    });
    if (!outcome) return notFound(res);
    if (outcome?.error) return json(res, outcome.error, { error: outcome.message });
    await logAction(outcome.type === 'trash' ? 'file.purge.trash' : 'file.purge', { appId: outcome.appId, fileId: outcome.id, name: outcome.name });
    return json(res, 200, { ok: true, state: outcome.next });
  }

  if (req.method === 'GET' && url.pathname === '/api/export') {
    const state = await readState();
    return json(res, 200, {
      exportedAt: new Date().toISOString(),
      version: 1,
      ...state,
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/import') {
    const body = await readBody(req, MAX_JSON_BODY_BYTES);
    if (!body || typeof body !== 'object') {
      return json(res, 400, { error: 'Invalid import payload' });
    }
    const imported = sanitizeState({
      version: 1,
      theme: body.theme,
      activeId: body.activeId,
      apps: Array.isArray(body.apps) ? body.apps : [],
      trashApps: Array.isArray(body.trashApps) ? body.trashApps : [],
      trashFiles: Array.isArray(body.trashFiles) ? body.trashFiles : [],
    });
    if (imported.apps.length > MAX_APPS || imported.trashApps.length > MAX_APPS) {
      return json(res, 400, { error: `Import too large (max ${MAX_APPS} apps per section)` });
    }
    const next = await queueMutation(async () => writeState(imported));
    await logAction('state.import', { apps: next.apps.length, trashApps: next.trashApps.length, trashFiles: next.trashFiles.length });
    return json(res, 200, { state: next });
  }

  return notFound(res);
}

async function serveStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return notFound(res);
  }
  if (url.pathname === '/' || url.pathname === '/Joblio.html') {
    const html = await fsp.readFile(APP_HTML, 'utf8');
    applySecurityHeaders(res);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }
  notFound(res);
}

const requestHandler = async (req, res) => {
  try {
    if (!requireBasicAuth(req, res)) return;
    const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
    if (url.pathname.startsWith('/api/')) {
      return await handleApi(req, res, url);
    }
    return await serveStatic(req, res, url);
  } catch (err) {
    if (Number.isInteger(err?.statusCode) && err.statusCode >= 400 && err.statusCode < 500) {
      return json(res, err.statusCode, { error: err.message || 'Request error' });
    }
    return serverError(res, err);
  }
};

function createServerWithTransport() {
  const tlsRequested = (TLS_MODE === 'on' || TLS_MODE === 'require') && TLS_CERT_PATH && TLS_KEY_PATH;
  if (tlsRequested) {
    const cert = fs.readFileSync(path.resolve(TLS_CERT_PATH));
    const key = fs.readFileSync(path.resolve(TLS_KEY_PATH));
    transportIsTls = true;
    return https.createServer({ cert, key }, requestHandler);
  }
  if (TLS_MODE === 'require') {
    throw new Error('JOBLIO_TLS_MODE=require but TLS cert/key are unavailable.');
  }
  transportIsTls = false;
  return http.createServer(requestHandler);
}

const server = createServerWithTransport();
server.requestTimeout = 15000;
server.headersTimeout = 15000;
server.keepAliveTimeout = 5000;
server.maxHeadersCount = 100;

ensureDirs()
  .then(() => {
    server.listen(PORT, HOST, () => {
      // eslint-disable-next-line no-console
      console.log(`Joblio server running at ${transportIsTls ? 'https' : 'http'}://${HOST}:${PORT}`);
      // eslint-disable-next-line no-console
      console.log(`Data dir: ${DATA_DIR}`);
    });
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
