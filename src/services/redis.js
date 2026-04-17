// src/services/redis.js
const Redis = require('ioredis');
const logger = require('../utils/logger');

let redis;

async function connectRedis() {
  // Support Upstash (REST token → ioredis URL) or standard REDIS_URL
  let redisUrl = process.env.REDIS_URL;
  if (!redisUrl && process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    const host = process.env.UPSTASH_REDIS_REST_URL.replace('https://', '');
    redisUrl = `rediss://default:${process.env.UPSTASH_REDIS_REST_TOKEN}@${host}:6379`;
  }
  redisUrl = redisUrl || 'redis://localhost:6379';

  redis = new Redis(redisUrl, {
    retryStrategy: (times) => Math.min(times * 50, 2000),
    maxRetriesPerRequest: 3,
    tls: redisUrl.startsWith('rediss://') ? {} : undefined,
  });

  redis.on('connect', () => logger.info('Redis connected'));
  redis.on('error', (err) => logger.error('Redis error:', err.message));

  return redis;
}

function getRedis() {
  if (!redis) throw new Error('Redis not connected');
  return redis;
}

// Export proxy so other modules can do const { redis } = require('./redis')
const handler = {
  get(_, prop) {
    if (prop === 'connectRedis') return connectRedis;
    const r = getRedis();
    return typeof r[prop] === 'function' ? r[prop].bind(r) : r[prop];
  }
};

module.exports = { connectRedis, redis: new Proxy({}, handler) };
