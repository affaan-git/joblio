#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');

const root = path.resolve(__dirname, '..');

function runOrThrow(cmd, args) {
  const result = spawnSync(cmd, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${cmd} failed with code ${result.status}`);
}

function usage() {
  // eslint-disable-next-line no-console
  console.log('Usage: node ./scripts/restore.js --file <backup-file> --yes');
}

(async () => {
  const args = process.argv.slice(2);
  const yes = args.includes('--yes');
  const idx = args.indexOf('--file');
  const file = idx >= 0 ? args[idx + 1] : '';

  if (!yes || !file) {
    usage();
    process.exit(1);
  }

  const backupPath = path.isAbsolute(file) ? file : path.join(root, file);
  if (!fs.existsSync(backupPath)) {
    // eslint-disable-next-line no-console
    console.error(`Backup not found: ${backupPath}`);
    process.exit(1);
  }

  if (backupPath.endsWith('.zip')) {
    runOrThrow('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Expand-Archive -Path '${backupPath.replace(/'/g, "''")}' -DestinationPath '${root.replace(/'/g, "''")}' -Force`,
    ]);
    // eslint-disable-next-line no-console
    console.log('Restore complete from zip backup.');
    return;
  }

  if (backupPath.endsWith('.tar.gz') || backupPath.endsWith('.tgz')) {
    runOrThrow('tar', ['-xzf', backupPath, '-C', root]);
    // eslint-disable-next-line no-console
    console.log('Restore complete from tar backup.');
    return;
  }

  // eslint-disable-next-line no-console
  console.error('Unsupported backup extension. Use .zip or .tar.gz');
  process.exit(1);
})();
