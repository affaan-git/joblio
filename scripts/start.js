#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { readEnvFile, cleanEnv } = require('../lib/env-file');
const { evaluatePreflight } = require('./preflight');

const root = path.resolve(__dirname, '..');
const configDir = path.join(root, '.joblio-data');
const configPath = path.join(configDir, 'config.env');

async function loadConfigEnv() {
  return readEnvFile(configPath);
}

function applyLockedRuntimeEnv(configEnv) {
  const systemOnly = cleanEnv(process.env);
  for (const k of Object.keys(process.env)) delete process.env[k];
  Object.assign(process.env, systemOnly, configEnv);
}

async function main() {
  await fsp.mkdir(configDir, { recursive: true });
  if (!fs.existsSync(configPath)) {
    console.error('Missing config. Run `npm run setup` first.');
    process.exit(1);
  }

  const configEnv = await loadConfigEnv();
  const runtimeDataDir = path.resolve(configEnv.JOBLIO_DATA_DIR || path.join(root, '.joblio-data'));
  await fsp.mkdir(runtimeDataDir, { recursive: true });

  const preflight = evaluatePreflight(configEnv);
  if (preflight.issues.length) {
    console.error('Preflight failed:');
    preflight.issues.forEach((i) => console.error(`- ${i}`));
    preflight.warns.forEach((w) => console.error(`WARN: ${w}`));
    process.exit(1);
  }
  preflight.warns.forEach((w) => console.warn(`WARN: ${w}`));

  const host = configEnv.HOST || '127.0.0.1';
  const port = configEnv.PORT || '8787';
  console.log(`Starting Joblio on https://${host}:${port}`);
  console.log('Use your configured Basic Auth credentials to sign in.');

  applyLockedRuntimeEnv(configEnv);
  process.env._JOBLIO_ENV_LOCKED = '1';
  // Start server in-process without spawning child commands.
  require(path.join(root, 'server.js'));
}

main().catch((err) => {
  console.error(`Startup failed [${err?.code || err?.name || 'Error'}]. Check configuration and run preflight.`);
  process.exit(1);
});
