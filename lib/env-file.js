'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');

function parseEnvText(text) {
  const out = {};
  const lines = String(text || '').split(/\r?\n/);
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const idx = t.indexOf('=');
    if (idx < 1) continue;
    const key = t.slice(0, idx).trim();
    const value = t.slice(idx + 1).trim();
    if (!key) continue;
    out[key] = value;
  }
  return out;
}

async function readEnvFile(filePath) {
  try {
    const raw = await fsp.readFile(filePath, 'utf8');
    return parseEnvText(raw);
  } catch {
    return {};
  }
}

function readEnvFileSync(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return parseEnvText(raw);
  } catch {
    return {};
  }
}

module.exports = {
  parseEnvText,
  readEnvFile,
  readEnvFileSync,
};
