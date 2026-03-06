'use strict';

function normalizeHost(host) {
  return String(host || '').trim().toLowerCase();
}

function isLoopbackHost(host) {
  const h = normalizeHost(host);
  return h === '127.0.0.1' || h === 'localhost' || h === '::1';
}

function isWildcardHost(host) {
  const h = normalizeHost(host);
  return h === '0.0.0.0' || h === '::';
}

function parseIpv4(host) {
  const h = normalizeHost(host);
  const parts = h.split('.');
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return nums;
}

function isPrivateIpv4(host) {
  const p = parseIpv4(host);
  if (!p) return false;
  const [a, b] = p;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function isLoopbackIpv4(host) {
  const p = parseIpv4(host);
  return Boolean(p && p[0] === 127);
}

function isLocalIpv6(host) {
  const h = normalizeHost(host);
  if (!h || !h.includes(':')) return false;
  if (h === '::1') return true;
  if (h.startsWith('fc') || h.startsWith('fd')) return true; // unique local
  if (h.startsWith('fe8') || h.startsWith('fe9') || h.startsWith('fea') || h.startsWith('feb')) return true; // link-local fe80::/10
  return false;
}

function isPrivateOrLoopbackHost(host) {
  return isLoopbackHost(host) || isLoopbackIpv4(host) || isPrivateIpv4(host) || isLocalIpv6(host);
}

module.exports = {
  normalizeHost,
  isLoopbackHost,
  isWildcardHost,
  isPrivateIpv4,
  isLoopbackIpv4,
  isLocalIpv6,
  isPrivateOrLoopbackHost,
};
