#!/usr/bin/env node
'use strict';

const { createPasswordHash } = require('../lib/auth');

const args = process.argv.slice(2);
const passIdx = args.indexOf('--password');
const pass = passIdx >= 0 ? args[passIdx + 1] : '';

if (!pass) {
  // eslint-disable-next-line no-console
  console.error('Usage: node ./scripts/gen-auth-hash.js --password <plain-password>');
  process.exit(1);
}

const hash = createPasswordHash(pass);
// eslint-disable-next-line no-console
console.log(hash);
