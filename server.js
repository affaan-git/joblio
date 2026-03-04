#!/usr/bin/env node
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 8787);
const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, '.joblio-data');
const STORAGE_DIR = path.join(DATA_DIR, 'storage');
const TRASH_STORAGE_DIR = path.join(DATA_DIR, 'storage-trash');
const LOG_DIR = path.join(DATA_DIR, 'logs');
const STATE_PATH = path.join(DATA_DIR, 'state.json');
const APP_HTML = path.join(ROOT_DIR, 'Joblio.html');
const MAX_JSON_BODY_BYTES = Number(process.env.MAX_JSON_BODY_BYTES || 5 * 1024 * 1024);
const MAX_UPLOAD_JSON_BYTES = Number(process.env.MAX_UPLOAD_JSON_BYTES || 35 * 1024 * 1024);
const MAX_FILE_BYTES = Number(process.env.MAX_FILE_BYTES || 25 * 1024 * 1024);
const MAX_APPS = Number(process.env.MAX_APPS || 10000);
const LOG_ROTATE_BYTES = Number(process.env.LOG_ROTATE_BYTES || 5 * 1024 * 1024);
const API_TOKEN = process.env.JOBLIO_API_TOKEN || '';
const AUDIT_KEY = process.env.JOBLIO_AUDIT_KEY || '';
const HEALTH_VERBOSE = process.env.JOBLIO_HEALTH_VERBOSE === '1';
const ERROR_VERBOSE = process.env.JOBLIO_ERROR_VERBOSE === '1';
const STRICT_MODE = process.env.JOBLIO_STRICT_MODE === '1';
const ALLOW_REMOTE = process.env.JOBLIO_ALLOW_REMOTE === '1';
const SNAPSHOT_DIR = path.join(DATA_DIR, 'snapshots');
const MAX_SNAPSHOTS = Number(process.env.MAX_SNAPSHOTS || 20);
const PURGE_MIN_AGE_SEC = Number(process.env.PURGE_MIN_AGE_SEC || 120);
const RATE_WINDOW_MS = Number(process.env.RATE_WINDOW_MS || 60 * 1000);
const RATE_MAX_WRITE = Number(process.env.RATE_MAX_WRITE || 180);
const RATE_MAX_UPLOAD = Number(process.env.RATE_MAX_UPLOAD || 24);
const RATE_MAX_DELETE = Number(process.env.RATE_MAX_DELETE || 120);
const RATE_MAX_IMPORT = Number(process.env.RATE_MAX_IMPORT || 10);
const SAFE_ID_RE = /^[a-zA-Z0-9_-]{6,100}$/;
const ALLOWED_STATUS = new Set(['wishlist', 'in_progress', 'applied', 'interview', 'offer', 'rejected', 'closed']);
const ALLOWED_THEME = new Set(['dark', 'light']);
const STORAGE_DIR_ABS = path.resolve(STORAGE_DIR);
const TRASH_STORAGE_DIR_ABS = path.resolve(TRASH_STORAGE_DIR);
const LOG_PATH = path.join(LOG_DIR, 'activity.log');
const LOG_PREV_PATH = path.join(LOG_DIR, 'activity.log.1');
const AUDIT_CHAIN_PATH = path.join(LOG_DIR, 'audit-chain.json');
const rateBuckets = new Map();

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

async function ensureDirs() {
  validateStartupConfig();
  await fsp.mkdir(DATA_DIR, { recursive: true });
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
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
}

function requireWriteAuth(req, res) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method || '')) return true;
  if (!isTrustedRequestOrigin(req)) {
    json(res, 403, { error: 'Forbidden origin' });
    return false;
  }
  if (!API_TOKEN) return true;
  const supplied = req.headers['x-joblio-token'];
  if (typeof supplied !== 'string' || supplied !== API_TOKEN) {
    json(res, 401, { error: 'Unauthorized' });
    return false;
  }
  return true;
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
  if (!requireWriteAuth(req, res)) return;
  if (!enforceRateLimit(req, res, url.pathname)) return;

  if (req.method === 'GET' && url.pathname === '/api/health') {
    if (Date.now() - lastAuditVerifyMs > 30000) {
      await verifyAuditLog();
    }
    const base = { ok: true, at: new Date().toISOString() };
    if (!HEALTH_VERBOSE) return json(res, 200, base);
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
      },
      audit: auditIntegrity,
    });
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
    await logAction('file.upload', { appId, fileId: id, name: safeName, size: buffer.byteLength });
    return json(res, 200, {
      file: {
        id,
        name: fileName,
        type: str(body.type),
        size: Number.isFinite(body.size) ? body.size : buffer.byteLength,
      },
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

const server = http.createServer(async (req, res) => {
  try {
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
});

ensureDirs()
  .then(() => {
    server.listen(PORT, HOST, () => {
      // eslint-disable-next-line no-console
      console.log(`Joblio server running at http://${HOST}:${PORT}`);
      // eslint-disable-next-line no-console
      console.log(`Data dir: ${DATA_DIR}`);
    });
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
