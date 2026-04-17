// src/middleware/rateLimit.js — Per-user rate limiting for expensive endpoints
const { redis } = require('../services/redis');

function perUserRateLimit(options = {}) {
  const { maxRequests = 5, windowSeconds = 60, keyPrefix = 'rl', message = 'Too many requests.' } = options;

  return async function(req, res, next) {
    if (!req.user?.id) return next();

    const key   = `${keyPrefix}:${req.user.id}`;
    const count = await redis.incr(key);

    if (count === 1) await redis.expire(key, windowSeconds);

    if (count > maxRequests) {
      const ttl = await redis.ttl(key);
      return res.status(429).json({
        success: false,
        error: { code: 'RATE_LIMIT_USER', message, retryAfter: ttl }
      });
    }

    next();
  };
}

const planGenerationLimit = perUserRateLimit({
  maxRequests: 3, windowSeconds: 300, keyPrefix: 'rl_generate',
  message: 'You can generate plans 3 times per 5 minutes.',
});

const authLimit = perUserRateLimit({
  maxRequests: 10, windowSeconds: 900, keyPrefix: 'rl_auth',
  message: 'Too many authentication attempts. Please wait before trying again.',
});

module.exports = { perUserRateLimit, planGenerationLimit, authLimit };
