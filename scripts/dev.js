#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const POLL_MS = 600;

const FRONTEND_TARGETS = [
  path.join(root, 'assets', 'js', 'app.js'),
  path.join(root, 'assets', 'js', 'modules'),
];

const BACKEND_TARGETS = [
  path.join(root, 'server.js'),
  path.join(root, 'lib'),
  path.join(root, 'scripts', 'start.js'),
  path.join(root, 'scripts', 'preflight.js'),
];

const ALLOWED_FILE_EXT = new Set(['.js', '.mjs', '.cjs']);

let serverProcess = null;
let pollTimer = null;
let building = false;
let rebuildQueued = false;
let restarting = false;
let restartQueued = false;

function exists(p) {
  try {
    fs.accessSync(p, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function debounce(fn, waitMs) {
  let timer = null;
  return (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, waitMs);
  };
}

function walkFiles(targetPath, out = []) {
  if (!exists(targetPath)) return out;
  const stat = fs.statSync(targetPath);
  if (stat.isFile()) {
    const ext = path.extname(targetPath).toLowerCase();
    if (ALLOWED_FILE_EXT.has(ext)) out.push(targetPath);
    return out;
  }
  const entries = fs.readdirSync(targetPath, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(targetPath, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.git')) continue;
      walkFiles(full, out);
    } else if (entry.isFile()) {
      const ext = path.extname(full).toLowerCase();
      if (ALLOWED_FILE_EXT.has(ext)) out.push(full);
    }
  }
  return out;
}

function snapshotForTargets(targets) {
  const snap = new Map();
  for (const target of targets) {
    const files = walkFiles(target);
    for (const file of files) {
      try {
        const st = fs.statSync(file);
        snap.set(file, `${st.mtimeMs}:${st.size}`);
      } catch {}
    }
  }
  return snap;
}

function diffSnapshots(prev, next) {
  if (!prev || !next) return false;
  if (prev.size !== next.size) return true;
  for (const [file, value] of next) {
    if (prev.get(file) !== value) return true;
  }
  return false;
}

function runFrontendBuild() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'scripts', 'build-frontend-bundle.js')], {
      cwd: root,
      stdio: 'inherit',
      env: process.env,
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`frontend build failed (${code})`));
    });
  });
}

async function rebuildFrontend() {
  if (building) {
    rebuildQueued = true;
    return;
  }
  building = true;
  try {
    console.log('[dev] Rebuilding frontend bundle...');
    await runFrontendBuild();
    console.log('[dev] Frontend bundle updated.');
  } catch (err) {
    console.error(`[dev] ${err?.message || String(err)}`);
  } finally {
    building = false;
    if (rebuildQueued) {
      rebuildQueued = false;
      rebuildFrontend();
    }
  }
}

function startServer() {
  serverProcess = spawn(process.execPath, [path.join(root, 'scripts', 'start.js')], {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  });
  serverProcess.on('exit', (code, signal) => {
    const reason = signal ? `signal ${signal}` : `code ${code}`;
    console.log(`[dev] Server exited (${reason}).`);
    serverProcess = null;
    if (restarting) return;
  });
}

function restartServer() {
  if (restarting) {
    restartQueued = true;
    return;
  }
  restarting = true;
  const finish = () => {
    restarting = false;
    if (restartQueued) {
      restartQueued = false;
      restartServer();
    }
  };
  if (!serverProcess) {
    console.log('[dev] Starting server...');
    startServer();
    finish();
    return;
  }
  console.log('[dev] Restarting server...');
  const old = serverProcess;
  old.once('exit', () => {
    startServer();
    finish();
  });
  old.kill('SIGTERM');
  setTimeout(() => {
    if (serverProcess === old) old.kill('SIGKILL');
  }, 3000);
}

const onFrontendChange = debounce(() => {
  rebuildFrontend();
}, 180);

const onBackendChange = debounce(() => {
  restartServer();
}, 180);

function startPolling() {
  let frontendSnap = snapshotForTargets(FRONTEND_TARGETS);
  let backendSnap = snapshotForTargets(BACKEND_TARGETS);
  pollTimer = setInterval(() => {
    const nextFrontend = snapshotForTargets(FRONTEND_TARGETS);
    const nextBackend = snapshotForTargets(BACKEND_TARGETS);
    if (diffSnapshots(frontendSnap, nextFrontend)) {
      frontendSnap = nextFrontend;
      onFrontendChange();
    }
    if (diffSnapshots(backendSnap, nextBackend)) {
      backendSnap = nextBackend;
      onBackendChange();
    }
  }, POLL_MS);
}

async function main() {
  console.log('[dev] Initial frontend build...');
  await runFrontendBuild();
  console.log('[dev] Starting server (same path as npm start)...');
  startServer();
  startPolling();
  console.log('[dev] Polling for changes in frontend/backend sources.');
}

function shutdown() {
  console.log('\n[dev] Shutting down...');
  if (pollTimer) clearInterval(pollTimer);
  if (serverProcess) {
    serverProcess.kill('SIGTERM');
    setTimeout(() => {
      if (serverProcess) serverProcess.kill('SIGKILL');
      process.exit(0);
    }, 900);
  } else {
    process.exit(0);
  }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch((err) => {
  console.error(`[dev] Failed to start: ${err?.message || String(err)}`);
  process.exit(1);
});
