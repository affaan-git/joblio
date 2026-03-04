#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const dataDir = path.join(root, '.joblio-data');
const backupDir = path.join(root, 'backups');

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
      `Compress-Archive -Path '.joblio-data' -DestinationPath '${archive.replace(/'/g, "''")}' -Force`,
    ];
    runOrThrow(cmd, ps);
    // eslint-disable-next-line no-console
    console.log(`Backup created: ${archive}`);
    return;
  }

  const archive = path.join(backupDir, `joblio-data-${ts}.tar.gz`);
  runOrThrow('tar', ['-C', root, '-czf', archive, '.joblio-data']);
  // eslint-disable-next-line no-console
  console.log(`Backup created: ${archive}`);
})();
