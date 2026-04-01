#!/usr/bin/env node
'use strict';

const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { readEnvFileSync } = require('../lib/env-file');

const root = path.resolve(__dirname, '..');
const configPath = path.join(root, '.joblio-data', 'config.env');

function loadConfigEnv() {
  return readEnvFileSync(configPath);
}

async function replaceDirAtomic(targetDir, sourceDir) {
  const parent = path.dirname(targetDir);
  const backupOld = path.join(parent, `${path.basename(targetDir)}.pre-restore-${Date.now()}`);
  const hadExisting = fs.existsSync(targetDir);
  await fsp.mkdir(parent, { recursive: true });
  if (hadExisting) {
    await fsp.rename(targetDir, backupOld);
  }
  try {
    await fsp.cp(sourceDir, targetDir, { recursive: true, force: true });
    if (hadExisting) {
      await fsp.rm(backupOld, { recursive: true, force: true });
    }
  } catch (err) {
    try { await fsp.rm(targetDir, { recursive: true, force: true }); } catch {}
    if (hadExisting && fs.existsSync(backupOld)) {
      try { await fsp.rename(backupOld, targetDir); } catch {}
    }
    throw err;
  }
}

async function assertNoSymlinks(rootDir, _topDirName) {
  const stack = [rootDir];
  while (stack.length) {
    const current = stack.pop();
    const entries = await fsp.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error('Backup contains unsupported symbolic link. Remove symlinks from the backup and retry.');
      }
      if (entry.isDirectory()) {
        stack.push(full);
      }
    }
  }
}

function usage() {
  // eslint-disable-next-line no-console
  console.log('Usage: node ./scripts/restore.js --file <backup-directory> --yes');
}

function resolveRestoreSource(backupPath, topDir) {
  if (!fs.existsSync(backupPath)) return null;
  const direct = path.resolve(backupPath);
  if (fs.statSync(direct).isDirectory() && path.basename(direct) === topDir) {
    return direct;
  }
  const nested = path.join(direct, topDir);
  if (fs.existsSync(nested) && fs.statSync(nested).isDirectory()) {
    return nested;
  }
  return null;
}

async function main() {
  const args = process.argv.slice(2);
  const yes = args.includes('--yes');
  const idx = args.indexOf('--file');
  const file = idx >= 0 ? args[idx + 1] : '';

  if (!yes || !file) {
    usage();
    process.exit(1);
  }

  const config = loadConfigEnv();
  const dataDir = path.resolve(config.JOBLIO_DATA_DIR || path.join(root, '.joblio-data'));
  const topDir = path.basename(dataDir);
  const backupPath = path.isAbsolute(file) ? file : path.join(root, file);
  const sourceDir = resolveRestoreSource(backupPath, topDir);
  if (!sourceDir) {
    // eslint-disable-next-line no-console
    console.error('Restore source not found or invalid. Verify the backup path exists and contains valid data.');
    process.exit(1);
  }

  await assertNoSymlinks(sourceDir, topDir);
  await replaceDirAtomic(dataDir, sourceDir);
  // eslint-disable-next-line no-console
  console.log('Restore complete from directory backup.');
}

if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(`Restore failed [${err?.code || err?.name || 'Error'}]. Verify backup path and integrity.`);
    process.exit(1);
  });
}

module.exports = {
  assertNoSymlinks,
  loadConfigEnv,
  resolveRestoreSource,
  main,
};
