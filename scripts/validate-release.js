#!/usr/bin/env node
'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const steps = [
  { name: 'build:frontend:check', cmd: 'npm', args: ['run', 'build:frontend:check'] },
  { name: 'preflight', cmd: 'npm', args: ['run', 'preflight'] },
  { name: 'security:check', cmd: 'npm', args: ['run', 'security:check'] },
  { name: 'test:security', cmd: 'npm', args: ['run', 'test:security'] },
  { name: 'smoke', cmd: 'npm', args: ['run', 'smoke'] },
  { name: 'backup', cmd: 'npm', args: ['run', 'backup'] },
];

for (const step of steps) {
  // eslint-disable-next-line no-console
  console.log(`\n==> ${step.name}`);
  const run = spawnSync(step.cmd, step.args, {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (run.error) {
    // eslint-disable-next-line no-console
    console.error(`Step failed: ${step.name} (${run.error.message})`);
    process.exit(1);
  }
  if (run.status !== 0) {
    // eslint-disable-next-line no-console
    console.error(`Step failed: ${step.name} (exit ${run.status})`);
    process.exit(run.status || 1);
  }
}

// eslint-disable-next-line no-console
console.log('\nRelease validation OK');
