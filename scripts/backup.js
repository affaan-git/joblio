#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { readEnvFileSync } = require('../lib/env-file');

const root = path.resolve(__dirname, '..');
const configPath = path.join(root, '.joblio-data', 'config.env');

function loadConfigEnv() {
  return readEnvFileSync(configPath);
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

async function main() {
  const config = loadConfigEnv();
  const dataDir = path.resolve(config.JOBLIO_DATA_DIR || path.join(root, '.joblio-data'));
  const backupDir = path.resolve(config.JOBLIO_BACKUP_DIR || path.join(root, 'backups'));

  if (!fs.existsSync(dataDir) || !fs.statSync(dataDir).isDirectory()) {
    // eslint-disable-next-line no-console
    console.error('No data directory found. Run `npm run setup` first.');
    process.exit(1);
  }

  await fsp.mkdir(backupDir, { recursive: true });
  const outputDir = path.join(backupDir, `joblio-data-${stamp()}`);
  await fsp.cp(dataDir, outputDir, { recursive: true, force: true });
  // eslint-disable-next-line no-console
  console.log(`Backup created: ${outputDir}`);
}

if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(`Backup failed [${err?.code || err?.name || 'Error'}]. Check data directory and permissions.`);
    process.exit(1);
  });
}

module.exports = {
  loadConfigEnv,
  main,
};
