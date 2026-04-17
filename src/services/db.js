// ── db.js ─────────────────────────────────────────────────────────────
// src/services/db.js
const { PrismaClient } = require('@prisma/client');
const logger = require('../utils/logger');

const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development'
    ? [{ emit: 'event', level: 'query' }]
    : [],
});

if (process.env.NODE_ENV === 'development') {
  prisma.$on('query', e => {
    if (e.duration > 100) logger.warn(`Slow query (${e.duration}ms): ${e.query}`);
  });
}

module.exports = { prisma };
