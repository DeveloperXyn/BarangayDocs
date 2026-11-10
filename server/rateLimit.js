'use strict';
/* In-memory sliding-window limiter (single process). For several instances, back it with Redis. */
class RateLimiter {
  constructor() { this.m = new Map(); this.t = setInterval(() => this.sweep(), 300000); this.t.unref(); }
  hit(key, limit, windowMs) {
    const now = Date.now(), e = this.m.get(key) || { times: [], windowMs };
    e.windowMs = windowMs; e.times = e.times.filter(t => now - t < windowMs);
    if (e.times.length >= limit) { this.m.set(key, e); return { ok: false, retryAfter: Math.max(1, Math.ceil((e.times[0] + windowMs - now) / 1000)) }; }
    e.times.push(now); this.m.set(key, e); return { ok: true };
  }
  reset(key) { this.m.delete(key); }
  sweep() { const now = Date.now(); for (const [k, e] of this.m) if (!e.times.some(t => now - t < e.windowMs)) this.m.delete(k); }
}
module.exports = { RateLimiter };
