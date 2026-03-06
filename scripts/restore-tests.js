#!/usr/bin/env node
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { isSafeArchiveEntry, validateEntries } = require('./restore');
const { assertNoSymlinks } = require('./restore');

test('isSafeArchiveEntry accepts expected relative entries under top dir', () => {
  const top = '.joblio-data';
  assert.equal(isSafeArchiveEntry('.joblio-data/state.json', top), true);
  assert.equal(isSafeArchiveEntry('.joblio-data/storage/app-1/file.txt', top), true);
  assert.equal(isSafeArchiveEntry(' .joblio-data/logs/activity.log ', top), true);
});

test('isSafeArchiveEntry rejects absolute and drive paths', () => {
  const top = '.joblio-data';
  assert.equal(isSafeArchiveEntry('/etc/passwd', top), false);
  assert.equal(isSafeArchiveEntry('\\windows\\system32', top), false);
  assert.equal(isSafeArchiveEntry('C:/Windows/System32/cmd.exe', top), false);
});

test('isSafeArchiveEntry rejects traversal and sibling top-level paths', () => {
  const top = '.joblio-data';
  assert.equal(isSafeArchiveEntry('../.joblio-data/state.json', top), false);
  assert.equal(isSafeArchiveEntry('.joblio-data/../../outside.txt', top), false);
  assert.equal(isSafeArchiveEntry('other-dir/state.json', top), false);
});

test('validateEntries throws on unsafe path list', () => {
  assert.throws(() => validateEntries(['.joblio-data/state.json', '../escape.txt'], '.joblio-data'), /Unsafe archive path detected/);
});

test('assertNoSymlinks rejects symbolic links in extracted tree', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'joblio-restore-test-'));
  try {
    const top = path.join(temp, '.joblio-data');
    const target = path.join(top, 'target.txt');
    const link = path.join(top, 'storage-link');
    await fs.mkdir(top, { recursive: true });
    await fs.writeFile(target, 'x', 'utf8');
    await fs.symlink(target, link);
    await assert.rejects(
      () => assertNoSymlinks(top, '.joblio-data'),
      /symbolic link/i,
    );
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});
