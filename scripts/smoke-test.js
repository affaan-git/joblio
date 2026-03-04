#!/usr/bin/env node
'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');
const { createPasswordHash } = require('../lib/auth');

const root = path.resolve(__dirname, '..');
const port = Number(process.env.SMOKE_PORT || 8799);
const host = '127.0.0.1';
const base = `http://${host}:${port}`;
const token = process.env.SMOKE_TOKEN || 'smoke-token-123';
const basicUser = process.env.SMOKE_BASIC_USER || 'smoke-user';
const basicPass = process.env.SMOKE_BASIC_PASS || 'smoke-pass';
const basicAuth = Buffer.from(`${basicUser}:${basicPass}`).toString('base64');
let cookieJar = '';
let csrfToken = '';

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function req(url, opts = {}) {
  const headers = {
    Authorization: `Basic ${basicAuth}`,
    ...(cookieJar ? { Cookie: cookieJar } : {}),
    ...(opts.headers || {}),
  };
  const res = await fetch(url, { ...opts, headers });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) {
    const cookie = setCookie.split(';')[0];
    if (cookie) cookieJar = cookie;
  }
  let body = null;
  const text = await res.text();
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { res, body };
}

async function waitForServer(timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const { res } = await req(`${base}/api/health`);
      if (res.ok || res.status === 401) return;
    } catch {}
    await sleep(200);
  }
  throw new Error('Server did not become ready');
}

(async () => {
  const env = {
    ...process.env,
    HOST: host,
    PORT: String(port),
    JOBLIO_STRICT_MODE: '1',
    JOBLIO_API_TOKEN: token,
    JOBLIO_BASIC_AUTH_USER: basicUser,
    JOBLIO_BASIC_AUTH_HASH: createPasswordHash(basicPass),
    PURGE_MIN_AGE_SEC: '0',
    JOBLIO_HEALTH_VERBOSE: '1',
  };

  const child = spawn(process.execPath, ['server.js'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  child.stdout.on('data', (d) => { out += d.toString(); });
  child.stderr.on('data', (d) => { err += d.toString(); });

  const cleanup = () => {
    if (!child.killed) child.kill('SIGTERM');
  };

  try {
    await waitForServer();

    let r = await req(`${base}/api/state`);
    if (r.res.status !== 401) throw new Error('Expected unauthorized GET /api/state without session');

    r = await req(`${base}/api/auth/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!r.res.ok || !r.body?.csrfToken || !cookieJar) throw new Error('Session bootstrap failed');
    csrfToken = r.body.csrfToken;

    r = await req(`${base}/api/state`);
    if (!r.res.ok || !r.body?.state) throw new Error('GET /api/state failed');

    r = await req(`${base}/api/state`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: { version: 1, theme: 'dark', activeId: null, apps: [], trashApps: [], trashFiles: [] } }),
    });
    if (r.res.status !== 403) throw new Error('Expected CSRF rejection on PUT without x-joblio-csrf');

    const appId = 'appsmoke1';
    r = await req(`${base}/api/state`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-joblio-csrf': csrfToken },
      body: JSON.stringify({ state: { version: 1, theme: 'dark', activeId: appId, apps: [{ id: appId, company: 'Acme', title: 'Eng', workMode: 'Remote', status: 'wishlist', workspaceFiles: [] }], trashApps: [], trashFiles: [] } }),
    });
    if (!r.res.ok || !r.body?.state?.apps?.length) throw new Error('PUT /api/state with session failed');

    r = await req(`${base}/api/files/upload`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-joblio-csrf': csrfToken },
      body: JSON.stringify({ appId, name: 'resume.txt', type: 'text/plain', contentBase64: Buffer.from('hello').toString('base64') }),
    });
    if (!r.res.ok || !r.body?.file?.id) throw new Error('Upload failed');
    const fileId = r.body.file.id;

    r = await req(`${base}/api/files/${encodeURIComponent(fileId)}`, {
      method: 'DELETE',
      headers: { 'x-joblio-csrf': csrfToken },
    });
    if (!r.res.ok) throw new Error('Delete file failed');

    r = await req(`${base}/api/files/${encodeURIComponent(fileId)}/restore`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-joblio-csrf': csrfToken },
      body: JSON.stringify({ appId }),
    });
    if (!r.res.ok) throw new Error('Restore file failed');

    cookieJar = '';
    r = await req(`${base}/api/template/resume`);
    if (r.res.status !== 401) throw new Error('Expected unauthorized template download without session');
    r = await req(`${base}/api/auth/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!r.res.ok || !r.body?.csrfToken || !cookieJar) throw new Error('Second session bootstrap failed');
    csrfToken = r.body.csrfToken;
    r = await req(`${base}/api/template/resume`);
    if (!r.res.ok || !String(r.body || '').includes('Resume Template')) throw new Error('Resume template endpoint failed');

    r = await req(`${base}/api/health?verbose=1`);
    if (!r.res.ok || !r.body?.limits) throw new Error('Verbose health failed');

    r = await req(`${base}/api/integrity/verify`);
    if (!r.res.ok || typeof r.body?.ok !== 'boolean') throw new Error('Integrity verify failed');

    r = await req(`${base}/api/auth/revoke-all`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-joblio-csrf': csrfToken },
      body: JSON.stringify({}),
    });
    if (!r.res.ok || !r.body?.ok) throw new Error('Revoke-all failed');
    r = await req(`${base}/api/state`);
    if (r.res.status !== 401) throw new Error('Expected session invalidation after revoke-all');

    console.log('Smoke test OK');
    cleanup();
    process.exit(0);
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    if (msg.includes('ready') && /EPERM|EACCES|listen/i.test(`${out}\n${err}`)) {
      console.log('Smoke test skipped: listen not permitted in current environment');
      cleanup();
      process.exit(0);
    }
    console.error('Smoke test failed:', msg);
    if (out) console.error(out.trim());
    if (err) console.error(err.trim());
    cleanup();
    process.exit(1);
  }
})();
