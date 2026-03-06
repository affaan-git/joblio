#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { buildBundleContent, getBundlePath } = require('./build-frontend-bundle');

const root = path.resolve(__dirname, '..');
const bundlePath = getBundlePath();

let current = '';
try {
  current = fs.readFileSync(bundlePath, 'utf8');
} catch {
  // eslint-disable-next-line no-console
  console.error(`Missing bundle: ${path.relative(root, bundlePath)}. Run npm run build.`);
  process.exit(1);
}

const expected = buildBundleContent();
if (current !== expected) {
  // eslint-disable-next-line no-console
  console.error('Frontend bundle is out of date. Run npm run build.');
  process.exit(1);
}

// eslint-disable-next-line no-console
console.log('Frontend bundle check OK');
