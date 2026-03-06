#!/usr/bin/env node
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { assertNoSymlinks, resolveRestoreSource } = require('./restore');

test('resolveRestoreSource accepts direct top-level data directory path', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'joblio-restore-test-'));
  try {
    const top = path.join(temp, '.joblio-data');
    await fs.mkdir(top, { recursive: true });
    const resolved = resolveRestoreSource(top, '.joblio-data');
    assert.equal(resolved, path.resolve(top));
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});

test('resolveRestoreSource accepts backup root containing top-level data directory', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'joblio-restore-test-'));
  try {
    const rootDir = path.join(temp, 'joblio-data-20260306-000000');
    const top = path.join(rootDir, '.joblio-data');
    await fs.mkdir(top, { recursive: true });
    const resolved = resolveRestoreSource(rootDir, '.joblio-data');
    assert.equal(resolved, path.resolve(top));
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});

test('assertNoSymlinks rejects symbolic links in source tree', async () => {
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
