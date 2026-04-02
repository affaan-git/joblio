#!/usr/bin/env node
'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const dataDir = path.join(root, '.joblio-data');
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

  const run = spawnSync('openssl', cmd, { cwd: root, stdio: 'pipe', encoding: 'utf8' });
  if (run.status !== 0) {
    // eslint-disable-next-line no-console
    console.error('Failed generating TLS cert/key.');
    const errOut = String(run.stderr || run.stdout || '').trim();
    if (errOut) {
      // eslint-disable-next-line no-console
      console.error(errOut);
    }
    process.exit(run.status || 1);
  }

  // eslint-disable-next-line no-console
  console.log('TLS files generated:');
  // eslint-disable-next-line no-console
  console.log(`  cert: ${certPath}`);
  // eslint-disable-next-line no-console
  console.log(`  key:  ${keyPath}`);
  // eslint-disable-next-line no-console
  console.log('Next: run `npm run setup` and use these paths when prompted.');
})();
