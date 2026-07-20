/**
 * Minimal in-memory rate limiter. Suitable for single-instance deployments.
 * For production multi-instance deployments, replace with Redis.
 */

const buckets = new Map(); // key → { tokens, last }

export function rateLimit({ windowMs = 60000, maxRequests = 30, keyFn = (req) => req.ip } = {}) {
  return (req, res, next) => {
    const key = keyFn(req) || 'global';
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || now - bucket.last > windowMs) {
      bucket = { tokens: maxRequests, last: now };
    }
    if (bucket.tokens <= 0) {
      return res.status(429).json({ error: 'Too many requests. Please try again later.' });
    }
    bucket.tokens -= 1;
    bucket.last = now;
    buckets.set(key, bucket);
    next();
  };
}

export function authRateLimit() {
  return rateLimit({ windowMs: 15 * 60 * 1000, maxRequests: 10, keyFn: (req) => `${req.ip}:${req.body?.username || 'unknown'}` });
}

export default rateLimit;
