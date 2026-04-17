// src/routes/shelf.js
const express = require('express');
const { prisma } = require('../services/db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

function ok(res, data) { res.json({ success: true, data }); }

// GET /shelf
router.get('/', async (req, res, next) => {
  try {
    const items = await prisma.shelfItem.findMany({
      where: { userId: req.user.id },
      include: { spot: true },
      orderBy: { addedAt: 'desc' },
    });
    ok(res, { items });
  } catch (err) { next(err); }
});

// POST /shelf
router.post('/', async (req, res, next) => {
  try {
    const { spotId, addedFromPartyId } = req.body;
    if (!spotId) return res.status(400).json({ success: false, error: { code: 'MISSING_FIELD', message: 'spotId required.' } });

    const item = await prisma.shelfItem.upsert({
      where: { userId_spotId: { userId: req.user.id, spotId } },
      update: {},
      create: { userId: req.user.id, spotId, addedFromPartyId },
      include: { spot: true },
    });
    ok(res, { item });
  } catch (err) { next(err); }
});

// DELETE /shelf/:spotId
router.delete('/:spotId', async (req, res, next) => {
  try {
    await prisma.shelfItem.deleteMany({
      where: { userId: req.user.id, spotId: req.params.spotId }
    });
    ok(res, { removed: true });
  } catch (err) { next(err); }
});

module.exports = router;
