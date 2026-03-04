#!/usr/bin/env node
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPasswordHash, verifyPassword } = require('../lib/auth');

test('password hash verify success/failure', () => {
  const hash = createPasswordHash('S3curePass!123');
  assert.equal(typeof hash, 'string');
  assert.ok(hash.startsWith('scrypt$'));
  assert.equal(verifyPassword('S3curePass!123', hash), true);
  assert.equal(verifyPassword('wrong-password', hash), false);
});

test('invalid hash format fails verification', () => {
  assert.equal(verifyPassword('abc', 'not-a-hash'), false);
  assert.equal(verifyPassword('abc', 'scrypt$1$2$3$bad$'), false);
});
