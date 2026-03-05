'use strict';

function normPart(v, max = 180) {
  return String(v || '').trim().toLowerCase().slice(0, max) || 'unknown';
}

function safePositiveInt(v, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

class AuthGuard {
  constructor(options = {}) {
    this.windowMs = safePositiveInt(options.windowMs, 10 * 60 * 1000);
    this.threshold = safePositiveInt(options.threshold, 5);
    this.lockoutMs = safePositiveInt(options.lockoutMs, 15 * 60 * 1000);
    this.backoffBaseMs = safePositiveInt(options.backoffBaseMs, 250);
    this.backoffMaxMs = safePositiveInt(options.backoffMaxMs, 2000);
    this.backoffStartAfter = safePositiveInt(options.backoffStartAfter, 2);
    this.maxEntries = safePositiveInt(options.maxEntries, 20000);
    this.map = new Map();
  }

  key(ip, user) {
    return `${normPart(ip, 120)}|${normPart(user, 120)}`;
  }

  prune(now = Date.now()) {
    if (this.map.size === 0) return;
    for (const [k, rec] of this.map.entries()) {
      if (!rec) {
        this.map.delete(k);
        continue;
      }
      const expiredWindow = now - Number(rec.firstFailAt || 0) > this.windowMs;
      const unlocked = Number(rec.lockUntil || 0) <= now;
      if (expiredWindow && unlocked) this.map.delete(k);
    }
    if (this.map.size > this.maxEntries) {
      const entries = [...this.map.entries()].sort((a, b) => Number(a[1]?.lastFailAt || 0) - Number(b[1]?.lastFailAt || 0));
      const toDelete = entries.slice(0, this.map.size - this.maxEntries);
      for (const [k] of toDelete) this.map.delete(k);
    }
  }

  get(ip, user, now = Date.now()) {
    this.prune(now);
    const rec = this.map.get(this.key(ip, user));
    if (!rec) return null;
    return {
      count: Number(rec.count || 0),
      firstFailAt: Number(rec.firstFailAt || 0),
      lastFailAt: Number(rec.lastFailAt || 0),
      lockUntil: Number(rec.lockUntil || 0),
      locked: Number(rec.lockUntil || 0) > now,
    };
  }

  clear(ip, user) {
    this.map.delete(this.key(ip, user));
  }

  isLocked(ip, user, now = Date.now()) {
    const rec = this.get(ip, user, now);
    if (!rec || !rec.locked) return { locked: false, retryAfterSec: 0, count: rec?.count || 0 };
    const retryAfterSec = Math.max(1, Math.ceil((rec.lockUntil - now) / 1000));
    return { locked: true, retryAfterSec, count: rec.count };
  }

  recordFailure(ip, user, now = Date.now()) {
    const key = this.key(ip, user);
    const existing = this.map.get(key);
    const active = existing && (now - Number(existing.firstFailAt || 0) <= this.windowMs)
      ? existing
      : { count: 0, firstFailAt: now, lastFailAt: 0, lockUntil: 0 };

    active.count = Number(active.count || 0) + 1;
    active.lastFailAt = now;

    if (active.count >= this.threshold) {
      active.lockUntil = Math.max(Number(active.lockUntil || 0), now + this.lockoutMs);
    }

    this.map.set(key, active);

    const exponent = Math.max(0, active.count - this.backoffStartAfter);
    const delayMs = exponent > 0
      ? Math.min(this.backoffMaxMs, this.backoffBaseMs * (2 ** (exponent - 1)))
      : 0;

    const locked = Number(active.lockUntil || 0) > now;
    const retryAfterSec = locked ? Math.max(1, Math.ceil((active.lockUntil - now) / 1000)) : 0;

    return {
      count: active.count,
      locked,
      retryAfterSec,
      delayMs,
      firstFailAt: active.firstFailAt,
      lockUntil: active.lockUntil,
    };
  }
}

module.exports = {
  AuthGuard,
};
