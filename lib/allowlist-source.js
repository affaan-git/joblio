'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parseAllowlist } = require('./ip-allowlist');

const DEFAULT_MAX_ALLOWLIST_FILE_BYTES = 256 * 1024;

function normalizeAllowlistText(raw) {
  return String(raw || '')
    .replace(/\r\n/g, '\n')
    .replace(/\n/g, ',');
}

function resolveAllowlistPath(rawPath, baseDir) {
  const trimmed = String(rawPath || '').trim();
  if (!trimmed) return '';
  if (path.isAbsolute(trimmed)) return path.resolve(trimmed);
  return path.resolve(baseDir || process.cwd(), trimmed);
}

function loadAllowlistFromEnvSync(env = process.env, options = {}) {
  const issues = [];
  const maxBytes = Number(options.maxBytes || DEFAULT_MAX_ALLOWLIST_FILE_BYTES);
  const baseDir = options.baseDir || process.cwd();
  const pathRaw = String(env.JOBLIO_IP_ALLOWLIST_PATH || '').trim();
  const inlineRaw = String(env.JOBLIO_IP_ALLOWLIST || '').trim();

  if (pathRaw) {
    const resolvedPath = resolveAllowlistPath(pathRaw, baseDir);
    try {
      const stat = fs.statSync(resolvedPath);
      if (!stat.isFile()) {
        issues.push(`Allowlist path is not a file: ${pathRaw}`);
        return { entries: [], issues, warns: [], source: { type: 'path', pathRaw, resolvedPath } };
      }
      if (stat.size > maxBytes) {
        issues.push(`Allowlist file too large (${stat.size} bytes > ${maxBytes}) at: ${pathRaw}`);
        return { entries: [], issues, warns: [], source: { type: 'path', pathRaw, resolvedPath } };
      }
      const raw = fs.readFileSync(resolvedPath, 'utf8');
      const entries = parseAllowlist(normalizeAllowlistText(raw));
      return { entries, issues, warns: [], source: { type: 'path', pathRaw, resolvedPath } };
    } catch {
      issues.push(`Allowlist file not found/readable: ${pathRaw}`);
      return { entries: [], issues, warns: [], source: { type: 'path', pathRaw, resolvedPath } };
    }
  }

  if (inlineRaw) {
    issues.push('JOBLIO_IP_ALLOWLIST is not supported. Use JOBLIO_IP_ALLOWLIST_PATH.');
  }
  return { entries: [], issues, warns: [], source: { type: 'none', pathRaw: '', resolvedPath: '' } };
}

module.exports = {
  DEFAULT_MAX_ALLOWLIST_FILE_BYTES,
  normalizeAllowlistText,
  resolveAllowlistPath,
  loadAllowlistFromEnvSync,
};
