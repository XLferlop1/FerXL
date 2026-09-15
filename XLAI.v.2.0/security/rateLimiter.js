"use strict";

function createRateLimiter({ windowMs, max, now = () => Date.now(), maxEntries = 10000 } = {}) {
  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    throw new TypeError("createRateLimiter requires a positive windowMs.");
  }
  if (!Number.isInteger(max) || max <= 0) {
    throw new TypeError("createRateLimiter requires a positive integer max.");
  }

  const entries = new Map();

  function prune(timestamp) {
    for (const [key, entry] of entries) {
      if (timestamp - entry.startedAt >= windowMs) {
        entries.delete(key);
      }
    }

    if (entries.size <= maxEntries) return;
    const oldest = [...entries.entries()]
      .sort(([, left], [, right]) => left.startedAt - right.startedAt)
      .slice(0, entries.size - maxEntries);
    oldest.forEach(([key]) => entries.delete(key));
  }

  function check(key) {
    const timestamp = now();
    prune(timestamp);
    const current = entries.get(key);

    if (!current || timestamp - current.startedAt >= windowMs) {
      entries.set(key, { startedAt: timestamp, count: 1 });
      return { allowed: true, remaining: max - 1, retryAfterSeconds: 0 };
    }

    if (current.count >= max) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((windowMs - (timestamp - current.startedAt)) / 1000)),
      };
    }

    current.count += 1;
    return { allowed: true, remaining: max - current.count, retryAfterSeconds: 0 };
  }

  return {
    check,
    reset() {
      entries.clear();
    },
    size() {
      return entries.size;
    },
  };
}

module.exports = {
  createRateLimiter,
};
