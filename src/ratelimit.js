// Tiny in-memory rate limiter (per IP + route). No deps. A backstop against
// signup spam, scan-flooding, and conversion-pixel abuse. Disabled when
// RATE_LIMIT_DISABLED is set (used by tests).

// Pure core: record a hit, return whether it's over the limit. Exported for tests.
export function rateHit(store, key, now, windowMs, max) {
  let e = store.get(key);
  if (!e || e.reset <= now) { e = { count: 0, reset: now + windowMs }; store.set(key, e); }
  e.count++;
  return { limited: e.count > max, retryAfter: Math.ceil((e.reset - now) / 1000) };
}

export function createLimiter({ windowMs = 60000, max = 600 } = {}) {
  const store = new Map();
  let lastSweep = 0;
  return function rateLimit(req, res, next) {
    if (process.env.RATE_LIMIT_DISABLED) return next();
    const now = Date.now();
    // Occasional cleanup so the map can't grow unbounded.
    if (now - lastSweep > windowMs) {
      lastSweep = now;
      for (const [k, v] of store) if (v.reset <= now) store.delete(k);
    }
    const ip = req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
    const { limited, retryAfter } = rateHit(store, ip + ' ' + req.path, now, windowMs, max);
    if (limited) {
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({ error: 'rate_limited', hint: 'Too many requests — slow down.' });
    }
    next();
  };
}
