// Minimal in-memory rate limiter for authentication endpoints.
//
// Deliberately dependency-free so it needs no extra npm install on the VPS.
// Good enough to blunt password brute-force / credential-stuffing against a
// single app instance. If the API is ever scaled to multiple processes or
// servers, swap this for `express-rate-limit` backed by Redis so the counters
// are shared.

const buckets = new Map(); // key -> { count, resetAt }

// Drop expired buckets periodically so the map cannot grow unbounded.
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;
const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
        if (bucket.resetAt <= now) buckets.delete(key);
    }
}, SWEEP_INTERVAL_MS);
// Don't hold the process open just for the sweeper
if (typeof sweep.unref === 'function') sweep.unref();

const clientIp = (req) =>
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.ip ||
    req.connection?.remoteAddress ||
    'unknown';

/**
 * @param windowMs how long a window lasts
 * @param max      allowed attempts per window
 * @param keyBy    optional extra key (e.g. the submitted username) so one
 *                 attacker cannot lock out every user from a shared IP
 */
const rateLimit = ({ windowMs = 15 * 60 * 1000, max = 10, keyBy } = {}) => (req, res, next) => {
    const extra = typeof keyBy === 'function' ? keyBy(req) : '';
    const key = `${req.baseUrl}${req.path}|${clientIp(req)}|${extra || ''}`;
    const now = Date.now();

    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
        bucket = { count: 0, resetAt: now + windowMs };
        buckets.set(key, bucket);
    }

    bucket.count += 1;

    if (bucket.count > max) {
        const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
        res.setHeader('Retry-After', String(retryAfter));
        return res.status(429).json({
            success: false,
            message: `Too many attempts. Please try again in ${Math.ceil(retryAfter / 60)} minute(s).`
        });
    }

    next();
};

module.exports = rateLimit;
