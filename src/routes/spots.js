// src/routes/spots.js
const express = require('express');
const { query } = require('express-validator');
const { prisma } = require('../services/db');
const { redis } = require('../services/redis');
const { authMiddleware } = require('../middleware/auth');
const router = express.Router();

// ── PUBLIC: trending spots (no auth) ─────────────────────────────────
router.get('/trending', async (req, res, next) => {
  try {
    const cacheKey = 'spots:trending';
    const cached = await redis.get(cacheKey).catch(() => null);
    if (cached) return res.json({ success: true, data: JSON.parse(cached) });

    // Spots with most memories in last 7 days
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const trending = await prisma.memory.groupBy({
      by: ['spotId'],
      where: { createdAt: { gte: since }, spotId: { not: null } },
      _count: { spotId: true },
      orderBy: { _count: { spotId: 'desc' } },
      take: 10,
    });

    const spotIds = trending.map(t => t.spotId).filter(Boolean);
    const spots = await prisma.spot.findMany({
      where: { id: { in: spotIds }, isActive: true },
    });

    // Attach memory counts and sort by count
    const countMap = Object.fromEntries(trending.map(t => [t.spotId, t._count.spotId]));
    const result = spots
      .map(s => ({ ...s, recentMemories: countMap[s.id] || 0 }))
      .sort((a, b) => b.recentMemories - a.recentMemories);

    await redis.setex(cacheKey, 900, JSON.stringify({ spots: result })).catch(() => {});
    res.json({ success: true, data: { spots: result } });
  } catch (err) { next(err); }
});

router.use(authMiddleware);

function ok(res, data) { res.json({ success: true, data }); }

router.get('/',
  [
    query('city').optional().isString(),
    query('category').optional().isString(),
    query('vibeTag').optional().isString(),
    query('priceTier').optional().isInt({ min: 1, max: 4 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    query('offset').optional().isInt({ min: 0 }).toInt(),
  ],
  async (req, res, next) => {
    try {
      const { city, category, vibeTag, priceTier, limit = 20, offset = 0 } = req.query;
      const where = {
        isActive: true,
        ...(city      ? { city:      { contains: city,     mode: 'insensitive' } } : {}),
        ...(category  ? { category:  { contains: category, mode: 'insensitive' } } : {}),
        ...(vibeTag   ? { vibeTags:  { has: vibeTag } } : {}),
        ...(priceTier ? { priceTier: parseInt(priceTier) } : {}),
      };
      const [spots, total] = await Promise.all([
        prisma.spot.findMany({ where, take: limit, skip: offset, orderBy: { name: 'asc' } }),
        prisma.spot.count({ where }),
      ]);
      ok(res, { spots, total, limit, offset });
    } catch (err) { next(err); }
  }
);

router.get('/:id', async (req, res, next) => {
  try {
    const spot = await prisma.spot.findUnique({ where: { id: req.params.id } });
    if (!spot) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Spot not found.' } });
    ok(res, { spot });
  } catch (err) { next(err); }
});

module.exports = router;
