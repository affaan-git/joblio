#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const configDir = path.join(root, '.joblio-data');
const configPath = path.join(configDir, 'config.env');

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

async function loadConfigEnv() {
  const raw = await fsp.readFile(configPath, 'utf8');
  return parseEnvText(raw);
}

function runWithEnv(cmd, args, env) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: root, env, stdio: 'inherit' });
    child.on('exit', (code, signal) => resolve({ code, signal }));
    child.on('error', (error) => resolve({ code: 1, signal: null, error }));
  });
}

async function ensureSetup() {
  if (fs.existsSync(configPath)) return true;
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error('Missing config and no interactive terminal available. Run `npm run setup` in a terminal first.');
    return false;
  }
  const result = await runWithEnv(process.execPath, ['./scripts/setup.js'], process.env);
  return result.code === 0 && fs.existsSync(configPath);
}

function buildLockedRuntimeEnv(configEnv) {
  const locked = {
    ...process.env,
  };
  for (const k of Object.keys(configEnv)) {
    delete locked[k];
  }
  return {
    ...locked,
    ...configEnv,
  };
}

async function main() {
  await fsp.mkdir(configDir, { recursive: true });
  const setupOk = await ensureSetup();
  if (!setupOk) process.exit(1);

  const configEnv = await loadConfigEnv();
  const runtimeDataDir = path.resolve(configEnv.JOBLIO_DATA_DIR || path.join(root, '.joblio-data'));
  await fsp.mkdir(runtimeDataDir, { recursive: true });
  const env = buildLockedRuntimeEnv(configEnv);

  const buildFrontend = await runWithEnv(process.execPath, ['./scripts/build-frontend-bundle.js'], env);
  if (buildFrontend.code !== 0) process.exit(buildFrontend.code || 1);

  const preflight = await runWithEnv(process.execPath, ['./scripts/preflight.js'], env);
  if (preflight.code !== 0) process.exit(preflight.code || 1);

  const host = configEnv.HOST || '127.0.0.1';
  const port = configEnv.PORT || '8787';
  console.log(`Starting Joblio on https://${host}:${port}`);
  console.log('Use your configured Basic Auth credentials to sign in.');

  const server = spawn(process.execPath, ['server.js'], { cwd: root, env, stdio: 'inherit' });
  const relay = (signal) => {
    try { server.kill(signal); } catch {}
  };
  process.on('SIGINT', () => relay('SIGINT'));
  process.on('SIGTERM', () => relay('SIGTERM'));
  server.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code || 0);
  });
}

main().catch((err) => {
  console.error(`Startup failed: ${err?.message || String(err)}`);
  process.exit(1);
});
