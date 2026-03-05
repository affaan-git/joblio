#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const configPath = path.join(root, '.joblio-data', 'config.env');

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

function loadConfigEnv() {
  try {
    return parseEnvText(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return {};
  }
}

function stamp() {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}

function runOrThrow(cmd, args) {
  const result = spawnSync(cmd, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${cmd} failed with code ${result.status}`);
}

(async () => {
  const config = loadConfigEnv();
  const dataDir = path.resolve(config.JOBLIO_DATA_DIR || path.join(root, '.joblio-data'));
  const backupDir = path.resolve(config.JOBLIO_BACKUP_DIR || path.join(root, 'backups'));
  const dataDirName = path.basename(dataDir);
  if (!fs.existsSync(dataDir)) {
    // eslint-disable-next-line no-console
    console.error(`No data directory found at ${dataDir}`);
    process.exit(1);
  }

  await fsp.mkdir(backupDir, { recursive: true });

  const ts = stamp();
  if (process.platform === 'win32') {
    const archive = path.join(backupDir, `joblio-data-${ts}.zip`);
    const cmd = 'powershell.exe';
    const ps = [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Compress-Archive -Path '${dataDir.replace(/'/g, "''")}' -DestinationPath '${archive.replace(/'/g, "''")}' -Force`,
    ];
    runOrThrow(cmd, ps);
    // eslint-disable-next-line no-console
    console.log(`Backup created: ${archive}`);
    return;
  }

  const archive = path.join(backupDir, `joblio-data-${ts}.tar.gz`);
  runOrThrow('tar', ['-C', path.dirname(dataDir), '-czf', archive, dataDirName]);
  // eslint-disable-next-line no-console
  console.log(`Backup created: ${archive}`);
})();
