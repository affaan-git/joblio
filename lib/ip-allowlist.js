'use strict';

const { isPrivateIpv4, isLoopbackIpv4, isLocalIpv6 } = require('./network-policy');

function stripIpv6Mapped(ip) {
  const v = String(ip || '').trim();
  if (!v) return '';
  if (v.startsWith('::ffff:')) return v.slice(7);
  return v;
}

function normalizeIp(raw) {
  let v = String(raw || '').trim();
  if (!v) return '';
  if (v.includes(',')) v = v.split(',')[0].trim();
  if (v.startsWith('[') && v.includes(']')) {
    v = v.slice(1, v.indexOf(']'));
  } else if (v.includes(':') && v.includes('.') && v.lastIndexOf(':') > v.lastIndexOf('.')) {
    v = v.slice(0, v.lastIndexOf(':'));
  }
  v = v.replace(/%.+$/, '');
  return stripIpv6Mapped(v).toLowerCase();
}

function ipv4ToInt(ip) {
  const parts = String(ip || '').split('.');
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return ((nums[0] << 24) >>> 0) + ((nums[1] << 16) >>> 0) + ((nums[2] << 8) >>> 0) + (nums[3] >>> 0);
}

function parseAllowlist(raw) {
  const src = String(raw || '').trim();
  if (!src) return [];
  const entries = src
    .split(',')
    .map((v) => normalizeIp(v))
    .filter(Boolean);
  return [...new Set(entries)];
}

function matchIpv4Cidr(ip, cidr) {
  const idx = cidr.indexOf('/');
  if (idx <= 0) return false;
  const net = cidr.slice(0, idx);
  const bits = Number(cidr.slice(idx + 1));
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const ipInt = ipv4ToInt(ip);
  const netInt = ipv4ToInt(net);
  if (ipInt == null || netInt == null) return false;
  if (bits === 0) return true;
  const mask = bits === 32 ? 0xFFFFFFFF : ((0xFFFFFFFF << (32 - bits)) >>> 0);
  return (ipInt & mask) === (netInt & mask);
}

function isSafeAllowlistEntry(entryRaw) {
  const entry = normalizeIp(entryRaw);
  if (!entry) return false;
  if (entry === 'localhost' || entry === '127.0.0.1' || entry === '::1') return true;
  if (isPrivateIpv4(entry) || isLoopbackIpv4(entry) || isLocalIpv6(entry)) return true;
  if (entry.includes('/')) {
    const idx = entry.indexOf('/');
    const base = normalizeIp(entry.slice(0, idx));
    const bits = Number(entry.slice(idx + 1));
    if (!base || !Number.isInteger(bits)) return false;
    if (!base.includes('.')) return false;
    if (bits < 8 || bits > 32) return false;
    if (!isPrivateIpv4(base) && !isLoopbackIpv4(base)) return false;
    return true;
  }
  return false;
}

function hasNonLoopbackAllowlistEntry(entriesRaw) {
  const entries = Array.isArray(entriesRaw) ? entriesRaw : [];
  return entries.some((entryRaw) => {
    const entry = normalizeIp(entryRaw);
    if (!entry) return false;
    if (entry === 'localhost' || entry === '127.0.0.1' || entry === '::1') return false;
    if (entry.includes('/')) {
      const base = normalizeIp(entry.split('/')[0]);
      if (!base) return false;
      return base !== '127.0.0.1' && base !== '::1';
    }
    return true;
  });
}

function isIpAllowed(ipRaw, allowlist) {
  const entries = Array.isArray(allowlist) ? allowlist : [];
  if (!entries.length) return true;
  const ip = normalizeIp(ipRaw);
  if (!ip) return false;

  for (const rawEntry of entries) {
    const entry = normalizeIp(rawEntry);
    if (!entry) continue;
    if (entry === ip) return true;
    if (entry === 'localhost' && (ip === '127.0.0.1' || ip === '::1')) return true;
    if (entry.includes('/') && ip.includes('.')) {
      if (matchIpv4Cidr(ip, entry)) return true;
    }
  }
  return false;
}

module.exports = {
  normalizeIp,
  parseAllowlist,
  isSafeAllowlistEntry,
  hasNonLoopbackAllowlistEntry,
  isIpAllowed,
};
