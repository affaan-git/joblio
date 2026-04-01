'use strict';

const { isLoopbackHost, isWildcardHost, isPrivateOrLoopbackHost } = require('./network-policy');
const { isSafeAllowlistEntry, hasNonLoopbackAllowlistEntry } = require('./ip-allowlist');

function validateNetworkPolicy({ host, allowLan, trustProxy, allowlist }) {
  const issues = [];
  const warns = [];

  if (!allowLan && !isLoopbackHost(host)) {
    issues.push('HOST is not loopback while JOBLIO_ALLOW_LAN=0. Set HOST=127.0.0.1 or enable JOBLIO_ALLOW_LAN=1.');
  }
  if (allowLan) {
    if (isWildcardHost(host)) {
      issues.push('Wildcard bind host is not allowed in LAN mode. Use a specific private interface IP.');
    }
    if (!isPrivateOrLoopbackHost(host)) {
      issues.push('LAN mode requires a private or loopback bind host.');
    }
    if (!allowlist.length) {
      issues.push('JOBLIO_ALLOW_LAN=1 requires a non-empty allowlist.');
    }
    if (allowlist.length && !hasNonLoopbackAllowlistEntry(allowlist)) {
      issues.push('JOBLIO_ALLOW_LAN=1 requires at least one non-loopback allowlist entry.');
    }
    const unsafe = allowlist.find((entry) => !isSafeAllowlistEntry(entry));
    if (unsafe) {
      issues.push('Unsupported or unsafe allowlist entry in LAN mode. Only private/loopback IPv4 ranges and exact addresses are allowed.');
    }
    if (trustProxy) {
      issues.push('JOBLIO_ALLOW_LAN=1 requires JOBLIO_TRUST_PROXY=0 unless explicitly redesigned for a trusted proxy chain.');
    }
  }
  if (trustProxy && !allowlist.length) {
    issues.push('JOBLIO_TRUST_PROXY=1 requires a non-empty allowlist.');
  }
  if (!allowLan && allowlist.length && !trustProxy) {
    warns.push('IP allowlist is enabled while JOBLIO_TRUST_PROXY=0. Only socket remoteAddress will be used for IP checks.');
  }

  return { issues, warns };
}

module.exports = { validateNetworkPolicy };
