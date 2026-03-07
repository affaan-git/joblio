'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MAX_TEMPLATE_ENTRIES = 50;
const ALLOWED_TEMPLATE_EXT = new Set(['.md', '.txt', '.pdf', '.doc', '.docx']);

function parseTemplateConfig(raw) {
  const src = String(raw || '').trim();
  if (!src) return [];
  const entries = src
    .split(',')
    .map((v) => String(v || '').trim())
    .filter(Boolean)
    .slice(0, MAX_TEMPLATE_ENTRIES);
  return [...new Set(entries)];
}

function normalizeTemplateRelativePath(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  if (raw.includes('\0')) return '';
  if (path.isAbsolute(raw)) return '';
  const slashNorm = raw.replace(/\\/g, '/').replace(/^\.\/+/, '');
  const norm = path.posix.normalize(slashNorm);
  if (!norm || norm === '.' || norm === '..') return '';
  if (norm.startsWith('../') || norm.startsWith('/')) return '';
  const ext = path.posix.extname(norm).toLowerCase();
  if (!ALLOWED_TEMPLATE_EXT.has(ext)) return '';
  return norm;
}

function resolveTemplatePath(templateRoot, relativePath) {
  const rootAbs = path.resolve(templateRoot);
  const rel = normalizeTemplateRelativePath(relativePath);
  if (!rel) return null;
  const abs = path.resolve(rootAbs, rel);
  if (abs !== rootAbs && !abs.startsWith(`${rootAbs}${path.sep}`)) return null;
  return { rootAbs, rel, abs };
}

function validateTemplateConfig(raw, templateRoot, options = {}) {
  const requireExisting = Boolean(options.requireExisting);
  const maxBytes = Number.isFinite(options.maxBytes) ? Number(options.maxBytes) : 10 * 1024 * 1024;
  const parsed = parseTemplateConfig(raw);
  const issues = [];
  const templates = [];

  for (const entry of parsed) {
    const resolved = resolveTemplatePath(templateRoot, entry);
    if (!resolved) {
      issues.push(`Invalid template path: ${entry}`);
      continue;
    }
    const file = {
      id: resolved.rel,
      relativePath: resolved.rel,
      name: path.basename(resolved.rel),
      absPath: resolved.abs,
      size: null,
    };
    if (requireExisting) {
      let st;
      try {
        st = fs.lstatSync(resolved.abs);
      } catch {
        issues.push(`Template file not found: ${resolved.rel}`);
        continue;
      }
      if (st.isSymbolicLink()) {
        issues.push(`Template path cannot be a symlink: ${resolved.rel}`);
        continue;
      }
      if (!st.isFile()) {
        issues.push(`Template path must be a file: ${resolved.rel}`);
        continue;
      }
      if (st.size > maxBytes) {
        issues.push(`Template file too large: ${resolved.rel}`);
        continue;
      }
      file.size = st.size;
    }
    templates.push(file);
  }

  return { templates, issues };
}

module.exports = {
  parseTemplateConfig,
  normalizeTemplateRelativePath,
  resolveTemplatePath,
  validateTemplateConfig,
  ALLOWED_TEMPLATE_EXT,
};
