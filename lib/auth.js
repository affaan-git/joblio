'use strict';

const crypto = require('node:crypto');

function createPasswordHash(password, opts = {}) {
  const pass = String(password || '');
  if (!pass) throw new Error('Password is required');
  const N = Number(opts.N || 32768);
  const r = Number(opts.r || 8);
  const p = Number(opts.p || 1);
  const keylen = Number(opts.keylen || 32);
  const salt = opts.saltBytes ? crypto.randomBytes(Number(opts.saltBytes)) : crypto.randomBytes(16);
  const derived = crypto.scryptSync(pass, salt, keylen, { N, r, p, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

function verifyPassword(password, encoded) {
  const pass = String(password || '');
  const raw = String(encoded || '');
  const parts = raw.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (![N, r, p].every(Number.isFinite)) return false;
  let salt;
  let expected;
  try {
    salt = Buffer.from(parts[4], 'base64');
    expected = Buffer.from(parts[5], 'base64');
  } catch {
    return false;
  }
  if (!salt.length || !expected.length) return false;
  let actual;
  try {
    actual = crypto.scryptSync(pass, salt, expected.length, { N, r, p, maxmem: 64 * 1024 * 1024 });
  } catch {
    return false;
  }
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

module.exports = {
  createPasswordHash,
  verifyPassword,
};
