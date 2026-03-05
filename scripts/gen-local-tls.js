#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const dataDir = path.resolve(process.env.JOBLIO_DATA_DIR || path.join(root, '.joblio-data'));
const outDir = path.join(dataDir, 'tls');
const certPath = path.join(outDir, 'localhost-cert.pem');
const keyPath = path.join(outDir, 'localhost-key.pem');

(async () => {
  await fsp.mkdir(outDir, { recursive: true });
  const openssl = spawnSync('openssl', ['version'], { stdio: 'ignore' });
  if (openssl.status !== 0) {
    // eslint-disable-next-line no-console
    console.error('OpenSSL is required for tls:gen and was not found in PATH.');
    process.exit(1);
  }

  const cmd = [
    'req', '-x509', '-nodes', '-newkey', 'rsa:2048',
    '-keyout', keyPath,
    '-out', certPath,
    '-days', '365',
    '-subj', '/CN=localhost',
    '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
  ];

  const run = spawnSync('openssl', cmd, { cwd: root, stdio: 'inherit' });
  if (run.status !== 0) {
    // eslint-disable-next-line no-console
    console.error('Failed generating TLS cert/key.');
    process.exit(run.status || 1);
  }

  // eslint-disable-next-line no-console
  console.log(`Generated cert: ${certPath}`);
  // eslint-disable-next-line no-console
  console.log(`Generated key:  ${keyPath}`);
  // eslint-disable-next-line no-console
  console.log('Then run interactive setup and use those cert/key paths.');
})();
