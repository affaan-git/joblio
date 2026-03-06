#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const parts = [
  'assets/js/modules/constants.js',
  'assets/js/modules/dom.js',
  'assets/js/modules/time.js',
  'assets/js/modules/text.js',
  'assets/js/modules/search-filters.js',
  'assets/js/modules/trash.js',
  'assets/js/modules/status-dialog.js',
  'assets/js/modules/joblio-core.js',
];

function buildBundleContent() {
  let out = '';
  for (const rel of parts) {
    const file = path.join(root, rel);
    let src = fs.readFileSync(file, 'utf8');
    src = src.replace(/^import\s+[^;]+;\n/gm, '');
    src = src.replace(/^export\s+/gm, '');
    out += `\n/* ${rel} */\n${src}\n`;
  }
  out += '\ninitJoblio();\n';
  return out;
}

function getBundlePath() {
  return path.join(root, 'assets/js/joblio.bundle.js');
}

function writeBundle() {
  const out = buildBundleContent();
  const bundlePath = getBundlePath();
  fs.writeFileSync(bundlePath, out, 'utf8');
  // eslint-disable-next-line no-console
  console.log(`Built ${path.relative(root, bundlePath)} (${out.length} bytes)`);
}

if (require.main === module) {
  writeBundle();
}

module.exports = {
  buildBundleContent,
  getBundlePath,
  writeBundle,
};
