#!/usr/bin/env node
'use strict';

const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { parseEnvText, readEnvFileSync } = require('../lib/env-file');

const root = path.resolve(__dirname, '..');
const configPath = path.join(root, '.joblio-data', 'config.env');

function loadConfigEnv() {
  return readEnvFileSync(configPath);
}

function runOrThrow(cmd, args) {
  const result = spawnSync(cmd, args, { cwd: root, stdio: 'pipe', encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const err = String(result.stderr || result.stdout || '').trim();
    throw new Error(`${cmd} failed with code ${result.status}${err ? `: ${err}` : ''}`);
  }
  return String(result.stdout || '');
}

function isSafeArchiveEntry(entry, topDir) {
  const raw = String(entry || '').replace(/\\/g, '/').trim();
  if (!raw) return true;
  if (raw.startsWith('/') || raw.startsWith('\\') || /^[a-zA-Z]:/.test(raw)) return false;
  const parts = raw.split('/').filter((p) => p && p !== '.');
  if (!parts.length) return true;
  if (parts.some((p) => p === '..')) return false;
  return parts[0] === topDir;
}

function validateEntries(entries, topDir) {
  for (const e of entries) {
    if (!isSafeArchiveEntry(e, topDir)) {
      throw new Error(`Unsafe archive path detected: ${String(e).slice(0, 200)}`);
    }
  }
}

function listTarEntries(backupPath) {
  const out = runOrThrow('tar', ['-tzf', backupPath]);
  return out.split(/\r?\n/).map((v) => v.trim()).filter(Boolean);
}

function listZipEntriesWindows(backupPath) {
  const ps = [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `Add-Type -AssemblyName System.IO.Compression.FileSystem; ` +
    `$z=[System.IO.Compression.ZipFile]::OpenRead('${backupPath.replace(/'/g, "''")}'); ` +
    `try { $z.Entries | ForEach-Object { $_.FullName } } finally { $z.Dispose() }`,
  ];
  const out = runOrThrow('powershell.exe', ps);
  return out.split(/\r?\n/).map((v) => v.trim()).filter(Boolean);
}

async function replaceDirAtomic(targetDir, extractedDir) {
  const parent = path.dirname(targetDir);
  const backupOld = path.join(parent, `${path.basename(targetDir)}.pre-restore-${Date.now()}`);
  const hadExisting = fs.existsSync(targetDir);
  await fsp.mkdir(parent, { recursive: true });
  if (hadExisting) {
    await fsp.rename(targetDir, backupOld);
  }
  try {
    await fsp.cp(extractedDir, targetDir, { recursive: true, force: true });
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

async function assertNoSymlinks(rootDir, topDirName) {
  const stack = [rootDir];
  while (stack.length) {
    const current = stack.pop();
    const entries = await fsp.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        const rel = path.relative(rootDir, full).replace(/\\/g, '/');
        throw new Error(`Archive contains unsupported symbolic link: ${topDirName}/${rel}`);
      }
      if (entry.isDirectory()) {
        stack.push(full);
      }
    }
  }
}

function usage() {
  // eslint-disable-next-line no-console
  console.log('Usage: node ./scripts/restore.js --file <backup-file> --yes');
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

  const backupPath = path.isAbsolute(file) ? file : path.join(root, file);
  if (!fs.existsSync(backupPath)) {
    // eslint-disable-next-line no-console
    console.error(`Backup not found: ${backupPath}`);
    process.exit(1);
  }

  const config = loadConfigEnv();
  const dataDir = path.resolve(config.JOBLIO_DATA_DIR || path.join(root, '.joblio-data'));
  const topDir = path.basename(dataDir);
  const tempExtractRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'joblio-restore-'));
  try {
    if (backupPath.endsWith('.zip')) {
      if (process.platform !== 'win32') {
        throw new Error('Zip restore is only supported on Windows for this build. Use .tar.gz on macOS/Linux.');
      }
      const entries = listZipEntriesWindows(backupPath);
      validateEntries(entries, topDir);
      runOrThrow('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Expand-Archive -Path '${backupPath.replace(/'/g, "''")}' -DestinationPath '${tempExtractRoot.replace(/'/g, "''")}' -Force`,
      ]);
      const extractedDir = path.join(tempExtractRoot, topDir);
      if (!fs.existsSync(extractedDir) || !fs.statSync(extractedDir).isDirectory()) {
        throw new Error(`Restore archive missing expected top-level directory: ${topDir}`);
      }
      await assertNoSymlinks(extractedDir, topDir);
      await replaceDirAtomic(dataDir, extractedDir);
      // eslint-disable-next-line no-console
      console.log('Restore complete from zip backup.');
      return;
    }

    if (backupPath.endsWith('.tar.gz') || backupPath.endsWith('.tgz')) {
      const entries = listTarEntries(backupPath);
      validateEntries(entries, topDir);
      runOrThrow('tar', ['-xzf', backupPath, '-C', tempExtractRoot]);
      const extractedDir = path.join(tempExtractRoot, topDir);
      if (!fs.existsSync(extractedDir) || !fs.statSync(extractedDir).isDirectory()) {
        throw new Error(`Restore archive missing expected top-level directory: ${topDir}`);
      }
      await assertNoSymlinks(extractedDir, topDir);
      await replaceDirAtomic(dataDir, extractedDir);
      // eslint-disable-next-line no-console
      console.log('Restore complete from tar backup.');
      return;
    }
  } finally {
    await fsp.rm(tempExtractRoot, { recursive: true, force: true }).catch(() => {});
  }

  // eslint-disable-next-line no-console
  console.error('Unsupported backup extension. Use .zip or .tar.gz');
  process.exit(1);
}

if (require.main === module) {
  main();
}

module.exports = {
  isSafeArchiveEntry,
  validateEntries,
  assertNoSymlinks,
  parseEnvText,
  loadConfigEnv,
  main,
};
