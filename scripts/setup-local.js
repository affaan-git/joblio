#!/usr/bin/env node
'use strict';

const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createPasswordHash } = require('../lib/auth');

const root = path.resolve(__dirname, '..');

function randomHex(bytes) {
  return crypto.randomBytes(bytes).toString('hex');
}

function randomPass(bytes) {
  return crypto.randomBytes(bytes).toString('base64url');
}

const env = {
  ...process.env,
  JOBLIO_API_TOKEN: process.env.JOBLIO_API_TOKEN || randomHex(24),
  JOBLIO_BASIC_AUTH_USER: process.env.JOBLIO_BASIC_AUTH_USER || 'joblio',
  JOBLIO_BASIC_AUTH_HASH: process.env.JOBLIO_BASIC_AUTH_HASH || '',
  JOBLIO_STRICT_MODE: process.env.JOBLIO_STRICT_MODE || '1',
  HOST: process.env.HOST || '127.0.0.1',
  PORT: process.env.PORT || '8787',
};
const plainPass = randomPass(24);
if (!env.JOBLIO_BASIC_AUTH_HASH) {
  env.JOBLIO_BASIC_AUTH_HASH = createPasswordHash(plainPass);
}

const tlsDirCert = path.join(root, '.joblio-data', 'tls', 'localhost-cert.pem');
const tlsDirKey = path.join(root, '.joblio-data', 'tls', 'localhost-key.pem');
if (!process.env.JOBLIO_TLS_MODE && fs.existsSync(tlsDirCert) && fs.existsSync(tlsDirKey)) {
  env.JOBLIO_TLS_MODE = 'require';
  env.JOBLIO_TLS_CERT_PATH = tlsDirCert;
  env.JOBLIO_TLS_KEY_PATH = tlsDirKey;
}

const preflight = spawn(process.execPath, ['./scripts/preflight.js'], {
  cwd: root,
  env,
  stdio: 'inherit',
});

preflight.on('exit', (code) => {
  if (code !== 0) process.exit(code || 1);

  // eslint-disable-next-line no-console
  console.log('');
  // eslint-disable-next-line no-console
  console.log(`Starting Joblio at http://${env.HOST}:${env.PORT}`);
  // eslint-disable-next-line no-console
  console.log(`Browser auth user: ${env.JOBLIO_BASIC_AUTH_USER}`);
  // eslint-disable-next-line no-console
  console.log(`Browser auth pass: ${plainPass}`);
  // eslint-disable-next-line no-console
  console.log('Session authentication is automatic after browser login.');
  if (env.JOBLIO_TLS_MODE === 'require' || env.JOBLIO_TLS_MODE === 'on') {
    // eslint-disable-next-line no-console
    console.log(`TLS mode: ${env.JOBLIO_TLS_MODE}`);
  }
  // eslint-disable-next-line no-console
  console.log('');

  const server = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env,
    stdio: 'inherit',
  });

  const relay = (signal) => {
    try { server.kill(signal); } catch {}
  };

  process.on('SIGINT', () => relay('SIGINT'));
  process.on('SIGTERM', () => relay('SIGTERM'));

  server.on('exit', (serverCode, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(serverCode || 0);
  });
});
