#!/usr/bin/env node
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createPasswordHash, verifyPassword } = require('../lib/auth');
const { AuthGuard } = require('../lib/auth-guard');
const { parseAllowlist, isIpAllowed, normalizeIp, isSafeAllowlistEntry, hasNonLoopbackAllowlistEntry } = require('../lib/ip-allowlist');
const { loadAllowlistFromEnvSync } = require('../lib/allowlist-source');
const { isLoopbackHost, isWildcardHost, isPrivateOrLoopbackHost } = require('../lib/network-policy');
const { validateTemplateConfig } = require('../lib/template-registry');

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

test('auth guard triggers lockout after threshold and clears on success', () => {
  const guard = new AuthGuard({
    windowMs: 60_000,
    threshold: 3,
    lockoutMs: 120_000,
    backoffBaseMs: 100,
    backoffMaxMs: 500,
    backoffStartAfter: 2,
  });
  const ip = '127.0.0.1';
  const user = 'joblio';
  const t0 = 1_000_000;

  const f1 = guard.recordFailure(ip, user, t0);
  assert.equal(f1.locked, false);
  assert.equal(f1.delayMs, 0);

  const f2 = guard.recordFailure(ip, user, t0 + 10);
  assert.equal(f2.locked, false);
  assert.equal(f2.delayMs, 0);

  const f3 = guard.recordFailure(ip, user, t0 + 20);
  assert.equal(f3.locked, true);
  assert.equal(f3.delayMs, 100);
  assert.ok(f3.retryAfterSec >= 119);

  const lock = guard.isLocked(ip, user, t0 + 21);
  assert.equal(lock.locked, true);

  guard.clear(ip, user);
  const clearState = guard.isLocked(ip, user, t0 + 22);
  assert.equal(clearState.locked, false);
});

test('auth guard window expiry resets failure counter', () => {
  const guard = new AuthGuard({ windowMs: 1_000, threshold: 2, lockoutMs: 10_000, backoffBaseMs: 10, backoffMaxMs: 100, backoffStartAfter: 1 });
  const ip = '127.0.0.1';
  const user = 'u';
  const t0 = 5_000;

  guard.recordFailure(ip, user, t0);
  const later = guard.recordFailure(ip, user, t0 + 2_000);
  assert.equal(later.count, 1);
  assert.equal(later.locked, false);
});

test('allowlist supports exact ip and ipv4 cidr', () => {
  const entries = parseAllowlist('127.0.0.1,192.168.1.0/24, localhost ');
  assert.ok(entries.length >= 2);

  assert.equal(isIpAllowed('127.0.0.1', entries), true);
  assert.equal(isIpAllowed('192.168.1.42', entries), true);
  assert.equal(isIpAllowed('10.0.0.5', entries), false);
  assert.equal(isIpAllowed('::1', entries), true);
});

test('ip normalization handles ipv6-mapped ipv4 and xff style input', () => {
  assert.equal(normalizeIp('::ffff:127.0.0.1'), '127.0.0.1');
  assert.equal(normalizeIp('127.0.0.1, 10.0.0.2'), '127.0.0.1');
});

test('safe allowlist entries reject public and wildcard ranges', () => {
  assert.equal(isSafeAllowlistEntry('192.168.1.0/24'), true);
  assert.equal(isSafeAllowlistEntry('10.0.0.5'), true);
  assert.equal(isSafeAllowlistEntry('8.8.8.8'), false);
  assert.equal(isSafeAllowlistEntry('0.0.0.0/0'), false);
  assert.equal(isSafeAllowlistEntry('::/0'), false);
});

test('lan mode requires non-loopback allowlist entries', () => {
  assert.equal(hasNonLoopbackAllowlistEntry(parseAllowlist('localhost,127.0.0.1')), false);
  assert.equal(hasNonLoopbackAllowlistEntry(parseAllowlist('192.168.1.0/24')), true);
  assert.equal(hasNonLoopbackAllowlistEntry(parseAllowlist('10.1.2.3')), true);
});

test('allowlist loader reads newline-delimited entries from configured path', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'joblio-allowlist-test-'));
  const allowlistPath = path.join(tempRoot, 'allowlist.csv');
  await fs.writeFile(allowlistPath, '192.168.1.42\n10.0.0.0/24\n', 'utf8');

  const loaded = loadAllowlistFromEnvSync({ JOBLIO_IP_ALLOWLIST_PATH: allowlistPath }, { baseDir: tempRoot });
  assert.equal(loaded.issues.length, 0);
  assert.equal(isIpAllowed('192.168.1.42', loaded.entries), true);
  assert.equal(isIpAllowed('10.0.0.17', loaded.entries), true);
  assert.equal(isIpAllowed('172.16.0.5', loaded.entries), false);
});

test('allowlist loader rejects unreadable path', () => {
  const loaded = loadAllowlistFromEnvSync({ JOBLIO_IP_ALLOWLIST_PATH: '/definitely/missing/file.csv' }, { baseDir: '/' });
  assert.ok(loaded.issues.some((i) => i.includes('not found/readable')));
  assert.equal(loaded.entries.length, 0);
});

test('allowlist loader rejects legacy inline allowlist env', () => {
  const loaded = loadAllowlistFromEnvSync({ JOBLIO_IP_ALLOWLIST: '192.168.1.10' }, { baseDir: '/' });
  assert.ok(loaded.issues.some((i) => i.includes('not supported')));
  assert.equal(loaded.entries.length, 0);
});

test('network policy enforces private LAN host rules', () => {
  assert.equal(isLoopbackHost('127.0.0.1'), true);
  assert.equal(isWildcardHost('0.0.0.0'), true);
  assert.equal(isPrivateOrLoopbackHost('192.168.1.10'), true);
  assert.equal(isPrivateOrLoopbackHost('10.10.0.8'), true);
  assert.equal(isPrivateOrLoopbackHost('8.8.8.8'), false);
});

test('template config blocks traversal/absolute paths and allows valid relative files', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'joblio-template-test-'));
  const templateRoot = path.join(tempRoot, 'templates', 'resume');
  await fs.mkdir(templateRoot, { recursive: true });
  await fs.writeFile(path.join(templateRoot, 'ok.md'), '# ok', 'utf8');

  const good = validateTemplateConfig('ok.md', templateRoot, { requireExisting: true });
  assert.equal(good.issues.length, 0);
  assert.equal(good.templates.length, 1);
  assert.equal(good.templates[0].relativePath, 'ok.md');

  const bad = validateTemplateConfig('../secret.md,/etc/passwd,C:\\x\\y.txt', templateRoot, { requireExisting: false });
  assert.ok(bad.issues.length >= 2);
});

test('template config rejects symlinked directory escapes', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'joblio-template-symlink-test-'));
  const templateRoot = path.join(tempRoot, 'templates', 'resume');
  const outsideDir = path.join(tempRoot, 'outside');
  await fs.mkdir(templateRoot, { recursive: true });
  await fs.mkdir(outsideDir, { recursive: true });
  await fs.writeFile(path.join(outsideDir, 'pwn.md'), '# outside', 'utf8');
  await fs.symlink(outsideDir, path.join(templateRoot, 'link-out'));

  const result = validateTemplateConfig('link-out/pwn.md', templateRoot, { requireExisting: true });
  assert.ok(result.issues.some((i) => i.includes('escapes template root')));
});
