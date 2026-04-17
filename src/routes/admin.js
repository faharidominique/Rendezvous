// src/routes/admin.js — Admin dashboard & API
const express = require('express');
const path    = require('path');
const { prisma } = require('../services/db');
const { redis }  = require('../services/redis');
const logger  = require('../utils/logger');

const router = express.Router();

// ── ADMIN AUTH MIDDLEWARE ─────────────────────────────────────────────
function adminAuth(req, res, next) {
  const secret = req.headers['x-admin-secret'] || req.query.secret;
  if (!process.env.ADMIN_SECRET || secret !== process.env.ADMIN_SECRET) {
    // For browser requests, serve the dashboard (auth handled client-side)
    if (req.accepts('html') && !req.path.startsWith('/api')) {
      return next();
    }
    return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Admin access required.' } });
  }
  next();
}

// ── SERVE ADMIN DASHBOARD ─────────────────────────────────────────────
router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../../public/admin.html'));
});

router.get('/health', (req, res) => {
  res.sendFile(path.join(__dirname, '../../public/health.html'));
});

// ── ADMIN API ─────────────────────────────────────────────────────────
router.use('/api', adminAuth);

// GET /admin/api/stats — overview stats
router.get('/api/stats', async (req, res, next) => {
  try {
    const [userCount, spotCount, partyCount, memoryCount, activeParties] = await Promise.all([
      prisma.user.count(),
      prisma.spot.count({ where: { isActive: true } }),
      prisma.party.count(),
      prisma.memory.count(),
      prisma.party.count({ where: { status: { in: ['ACTIVE', 'GENERATING', 'VOTING', 'CONFIRMED'] } } }),
    ]);

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const newUsersThisWeek = await prisma.user.count({ where: { createdAt: { gte: sevenDaysAgo } } });

    res.json({
      success: true,
      data: { userCount, spotCount, partyCount, memoryCount, activeParties, newUsersThisWeek }
    });
  } catch (err) { next(err); }
});

// GET /admin/api/spots — paginated spot list
router.get('/api/spots', async (req, res, next) => {
  try {
    const limit  = parseInt(req.query.limit)  || 50;
    const offset = parseInt(req.query.offset) || 0;
    const city   = req.query.city;
    const status = req.query.status; // 'active' | 'inactive'

    const where = {
      ...(city   ? { city: { contains: city, mode: 'insensitive' } } : {}),
      ...(status === 'active'   ? { isActive: true  } : {}),
      ...(status === 'inactive' ? { isActive: false } : {}),
    };

    const [spots, total] = await Promise.all([
      prisma.spot.findMany({ where, take: limit, skip: offset, orderBy: { createdAt: 'desc' } }),
      prisma.spot.count({ where }),
    ]);

    res.json({ success: true, data: { spots, total, limit, offset } });
  } catch (err) { next(err); }
});

// PATCH /admin/api/spots/:id — update a spot
router.patch('/api/spots/:id', async (req, res, next) => {
  try {
    const spot = await prisma.spot.update({
      where: { id: req.params.id },
      data: req.body,
    });
    logger.info(`Admin updated spot ${req.params.id}`);
    res.json({ success: true, data: { spot } });
  } catch (err) { next(err); }
});

// DELETE /admin/api/spots/:id — deactivate a spot
router.delete('/api/spots/:id', async (req, res, next) => {
  try {
    await prisma.spot.update({ where: { id: req.params.id }, data: { isActive: false } });
    logger.info(`Admin deactivated spot ${req.params.id}`);
    res.json({ success: true, data: { deactivated: true } });
  } catch (err) { next(err); }
});

// GET /admin/api/users — paginated user list
router.get('/api/users', async (req, res, next) => {
  try {
    const limit  = parseInt(req.query.limit)  || 50;
    const offset = parseInt(req.query.offset) || 0;
    const search = req.query.search;

    const where = search ? {
      OR: [
        { email:       { contains: search, mode: 'insensitive' } },
        { displayName: { contains: search, mode: 'insensitive' } },
        { handle:      { contains: search, mode: 'insensitive' } },
      ]
    } : {};

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: { id:true, email:true, displayName:true, handle:true, locationCity:true, createdAt:true, lastActiveAt:true, isMinor:true },
        take: limit, skip: offset, orderBy: { createdAt: 'desc' }
      }),
      prisma.user.count({ where }),
    ]);

    res.json({ success: true, data: { users, total, limit, offset } });
  } catch (err) { next(err); }
});

// GET /admin/api/parties — recent parties
router.get('/api/parties', async (req, res, next) => {
  try {
    const limit  = parseInt(req.query.limit)  || 50;
    const offset = parseInt(req.query.offset) || 0;

    const [parties, total] = await Promise.all([
      prisma.party.findMany({
        include: {
          host: { select: { displayName: true, handle: true } },
          _count: { select: { members: true, votes: true } }
        },
        take: limit, skip: offset, orderBy: { createdAt: 'desc' }
      }),
      prisma.party.count(),
    ]);

    res.json({ success: true, data: { parties, total, limit, offset } });
  } catch (err) { next(err); }
});

// GET /admin/api/health — system health check
router.get('/api/health', async (req, res, next) => {
  try {
    const results = { server: 'ok', database: 'unknown', redis: 'unknown', ts: new Date().toISOString() };

    // Check DB
    try {
      await prisma.$queryRaw`SELECT 1`;
      results.database = 'ok';
    } catch {
      results.database = 'error';
    }

    // Check Redis
    try {
      await redis.ping();
      results.redis = 'ok';
    } catch {
      results.redis = 'error';
    }

    const allOk = Object.values(results).every(v => v === 'ok' || typeof v !== 'string' || v === results.ts);
    res.status(allOk ? 200 : 503).json({ success: allOk, data: results });
  } catch (err) { next(err); }
});

module.exports = router;
