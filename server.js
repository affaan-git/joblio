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

const DEFAULT_STATE = {
  version: 1,
  theme: 'dark',
  activeId: null,
  apps: [],
  trashApps: [],
  trashFiles: [],
  updatedAt: new Date().toISOString(),
};

async function ensureDirs() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.mkdir(STORAGE_DIR, { recursive: true });
  await fsp.mkdir(TRASH_STORAGE_DIR, { recursive: true });
  await fsp.mkdir(LOG_DIR, { recursive: true });
  if (!fs.existsSync(STATE_PATH)) {
    await writeState(DEFAULT_STATE);
  }
}

async function logAction(action, detail = {}) {
  const line = `${new Date().toISOString()}\t${action}\t${JSON.stringify(detail)}\n`;
  await fsp.appendFile(path.join(LOG_DIR, 'activity.log'), line, 'utf8');
}

async function readState() {
  try {
    const raw = await fsp.readFile(STATE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return sanitizeState(parsed);
  } catch {
    return { ...DEFAULT_STATE };
  }
}

async function writeState(next) {
  const clean = sanitizeState(next);
  clean.updatedAt = new Date().toISOString();
  const tmp = `${STATE_PATH}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(clean, null, 2), 'utf8');
  await fsp.rename(tmp, STATE_PATH);
  return clean;
}

function sanitizeState(input) {
  const base = input && typeof input === 'object' ? input : {};
  const out = {
    version: 1,
    theme: base.theme === 'light' ? 'light' : 'dark',
    activeId: typeof base.activeId === 'string' ? base.activeId : null,
    apps: Array.isArray(base.apps) ? base.apps : [],
    trashApps: Array.isArray(base.trashApps) ? base.trashApps : [],
    trashFiles: Array.isArray(base.trashFiles) ? base.trashFiles : [],
    updatedAt: typeof base.updatedAt === 'string' ? base.updatedAt : new Date().toISOString(),
  };
  out.apps = out.apps.map(sanitizeApp).filter(Boolean);
  out.trashApps = out.trashApps.map(sanitizeApp).filter(Boolean);
  out.trashFiles = out.trashFiles.map(sanitizeTrashFile).filter(Boolean);
  return out;
}

function sanitizeApp(app) {
  if (!app || typeof app !== 'object') return null;
  const id = typeof app.id === 'string' && app.id ? app.id : crypto.randomUUID();
  return {
    id,
    company: str(app.company),
    title: str(app.title),
    location: str(app.location),
    workMode: str(app.workMode || 'Unknown'),
    status: str(app.status || 'wishlist'),
    statusHistory: Array.isArray(app.statusHistory) ? app.statusHistory.map((h) => ({ status: str(h?.status), at: str(h?.at) })).filter((h) => h.status) : [],
    statusUpdatedAt: str(app.statusUpdatedAt),
    appliedAt: str(app.appliedAt),
    nextFollowUpAt: str(app.nextFollowUpAt),
    jobUrl: str(app.jobUrl),
    applicationUrl: str(app.applicationUrl),
    note: str(app.note),
    descriptionText: str(app.descriptionText || app.intakeText),
    workspaceFiles: Array.isArray(app.workspaceFiles)
      ? app.workspaceFiles
          .map((f) => {
            if (typeof f === 'string') return { id: crypto.randomUUID(), name: f, size: null, type: '' };
            if (!f || typeof f !== 'object') return null;
            return {
              id: str(f.id) || crypto.randomUUID(),
              name: str(f.name),
              size: Number.isFinite(f.size) ? f.size : null,
              type: str(f.type),
            };
          })
          .filter(Boolean)
      : [],
    createdAt: str(app.createdAt),
    updatedAt: str(app.updatedAt),
    deletedAt: str(app.deletedAt),
  };
}

function sanitizeTrashFile(file) {
  if (!file || typeof file !== 'object') return null;
  return {
    id: str(file.id) || crypto.randomUUID(),
    appId: str(file.appId),
    name: str(file.name),
    type: str(file.type),
    size: Number.isFinite(file.size) ? file.size : null,
    deletedAt: str(file.deletedAt) || new Date().toISOString(),
  };
}

function str(v) {
  return typeof v === 'string' ? v : '';
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
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
  json(res, 500, { error: 'Server error', detail: err?.message || String(err) });
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('Invalid JSON body');
  }
}

function safeFilename(name) {
  return String(name || 'file').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 140) || 'file';
}

async function ensureAppStorageDir(appId) {
  const dir = path.join(STORAGE_DIR, appId);
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}

async function findStoredFilePath(appId, fileId) {
  const dir = path.join(STORAGE_DIR, appId);
  try {
    const files = await fsp.readdir(dir);
    const found = files.find((name) => name.startsWith(`${fileId}-`));
    return found ? path.join(dir, found) : null;
  } catch {
    return null;
  }
}

async function moveFileToTrashStorage(appId, fileId) {
  const fullPath = await findStoredFilePath(appId, fileId);
  if (!fullPath) return null;
  const base = path.basename(fullPath);
  const trashPath = path.join(TRASH_STORAGE_DIR, `${appId}__${base}`);
  await fsp.rename(fullPath, trashPath);
  return trashPath;
}

async function findTrashedFilePath(appId, fileId) {
  const prefix = `${appId}__${fileId}-`;
  try {
    const files = await fsp.readdir(TRASH_STORAGE_DIR);
    const found = files.find((name) => name.startsWith(prefix));
    return found ? path.join(TRASH_STORAGE_DIR, found) : null;
  } catch {
    return null;
  }
}

async function handleApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/health') {
    return json(res, 200, { ok: true, at: new Date().toISOString() });
  }

  if (req.method === 'GET' && url.pathname === '/api/state') {
    const state = await readState();
    return json(res, 200, { state });
  }

  if (req.method === 'PUT' && url.pathname === '/api/state') {
    const body = await readBody(req);
    if (!body || typeof body !== 'object' || !body.state || typeof body.state !== 'object') {
      return json(res, 400, { error: 'Expected { state } payload' });
    }
    const next = await writeState(body.state);
    await logAction('state.put', { apps: next.apps.length, trashApps: next.trashApps.length, trashFiles: next.trashFiles.length });
    return json(res, 200, { state: next });
  }

  if (req.method === 'POST' && url.pathname === '/api/files/upload') {
    const body = await readBody(req);
    const appId = str(body.appId);
    const fileName = str(body.name);
    const base64 = str(body.contentBase64);
    if (!appId || !fileName || !base64) {
      return json(res, 400, { error: 'appId, name, contentBase64 are required' });
    }
    const id = crypto.randomUUID();
    const safeName = safeFilename(fileName);
    const dir = await ensureAppStorageDir(appId);
    const filePath = path.join(dir, `${id}-${safeName}`);
    const buffer = Buffer.from(base64, 'base64');
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
    const state = await readState();
    let app = state.apps.find((a) => a.workspaceFiles.some((f) => f.id === fileId));
    if (!app) app = state.trashApps.find((a) => a.workspaceFiles.some((f) => f.id === fileId));
    const trashFile = !app ? state.trashFiles.find((f) => f.id === fileId) : null;
    if (!app && !trashFile) return notFound(res);
    const file = app ? app.workspaceFiles.find((f) => f.id === fileId) : trashFile;
    const fullPath = app ? await findStoredFilePath(app.id, fileId) : await findTrashedFilePath(trashFile.appId, fileId);
    if (!fullPath || !fs.existsSync(fullPath)) return notFound(res);
    const stat = await fsp.stat(fullPath);
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
      await logAction('file.delete', { appId: app.id, fileId, name: deleted?.name || '' });
      return json(res, 200, { ok: true, state: next });
    }
    return notFound(res);
  }

  const restoreFileMatch = url.pathname.match(/^\/api\/files\/([^/]+)\/restore$/);
  if (req.method === 'POST' && restoreFileMatch) {
    const fileId = restoreFileMatch[1];
    const body = await readBody(req);
    const targetAppId = str(body.appId);
    const state = await readState();
    const idx = state.trashFiles.findIndex((f) => f.id === fileId);
    if (idx === -1) return notFound(res);
    const file = state.trashFiles[idx];
    const appId = targetAppId || file.appId;
    const app = state.apps.find((a) => a.id === appId) || state.trashApps.find((a) => a.id === appId);
    if (!app) return json(res, 400, { error: 'Target app not found for restore' });
    const trashedPath = await findTrashedFilePath(file.appId, file.id);
    if (!trashedPath || !fs.existsSync(trashedPath)) return json(res, 404, { error: 'Trashed file content not found' });
    const dir = await ensureAppStorageDir(app.id);
    const restoredPath = path.join(dir, `${file.id}-${safeFilename(file.name)}`);
    await fsp.rename(trashedPath, restoredPath);
    app.workspaceFiles.push({ id: file.id, name: file.name, type: file.type, size: file.size });
    state.trashFiles.splice(idx, 1);
    const next = await writeState(state);
    await logAction('file.restore', { appId: app.id, fileId: file.id, name: file.name });
    return json(res, 200, { ok: true, state: next });
  }

  const purgeFileMatch = url.pathname.match(/^\/api\/files\/([^/]+)\/purge$/);
  if (req.method === 'DELETE' && purgeFileMatch) {
    const fileId = purgeFileMatch[1];
    const state = await readState();

    const tIdx = state.trashFiles.findIndex((f) => f.id === fileId);
    if (tIdx !== -1) {
      const file = state.trashFiles[tIdx];
      const trashedPath = await findTrashedFilePath(file.appId, file.id);
      if (trashedPath && fs.existsSync(trashedPath)) {
        await fsp.unlink(trashedPath);
      }
      state.trashFiles.splice(tIdx, 1);
      const next = await writeState(state);
      await logAction('file.purge.trash', { appId: file.appId, fileId: file.id, name: file.name });
      return json(res, 200, { ok: true, state: next });
    }

    for (const app of [...state.apps, ...state.trashApps]) {
      const idx = app.workspaceFiles.findIndex((f) => f.id === fileId);
      if (idx === -1) continue;
      const [deleted] = app.workspaceFiles.splice(idx, 1);
      const fullPath = await findStoredFilePath(app.id, fileId);
      if (fullPath && fs.existsSync(fullPath)) await fsp.unlink(fullPath);
      const next = await writeState(state);
      await logAction('file.purge', { appId: app.id, fileId, name: deleted?.name || '' });
      return json(res, 200, { ok: true, state: next });
    }
    return notFound(res);
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
    const body = await readBody(req);
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
    const next = await writeState(imported);
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
