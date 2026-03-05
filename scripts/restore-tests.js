#!/usr/bin/env node
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isSafeArchiveEntry, validateEntries } = require('./restore');

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
