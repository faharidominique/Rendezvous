// src/routes/memories.js
const express = require('express');
const { prisma } = require('../services/db');
const { authMiddleware } = require('../middleware/auth');
const { sendNotification } = require('../services/notifications');

const router = express.Router();
router.use(authMiddleware);

function ok(res, data) { res.json({ success: true, data }); }

// GET /memories/feed
router.get('/feed', async (req, res, next) => {
  try {
    const limit  = parseInt(req.query.limit)  || 20;
    const offset = parseInt(req.query.offset) || 0;

    const friendships = await prisma.friendship.findMany({
      where: { status: 'ACCEPTED', OR: [{ requesterId: req.user.id }, { addresseeId: req.user.id }] }
    });
    const friendIds = friendships.map(f =>
      f.requesterId === req.user.id ? f.addresseeId : f.requesterId
    );

    const memories = await prisma.memory.findMany({
      where: { creatorId: { in: [req.user.id, ...friendIds] }, isPublic: true },
      include: {
        creator: { select: { id: true, displayName: true, handle: true, avatarUrl: true } },
        spot:    { select: { id: true, name: true, neighborhood: true, category: true } },
        reactions: { include: { user: { select: { id: true, displayName: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });

    ok(res, { memories, limit, offset });
  } catch (err) { next(err); }
});

// POST /memories
router.post('/', async (req, res, next) => {
  try {
    const { spotId, partyId, caption, photoUrl, isPublic = true } = req.body;
    const memory = await prisma.memory.create({
      data: { creatorId: req.user.id, spotId, partyId, caption, photoUrl, isPublic },
      include: {
        creator: { select: { id: true, displayName: true, handle: true, avatarUrl: true } },
        spot: true,
      }
    });
    ok(res, { memory });
  } catch (err) { next(err); }
});

// POST /memories/:id/react
router.post('/:id/react', async (req, res, next) => {
  try {
    const { reactionType } = req.body;
    if (!['HEART', 'REPEAT'].includes(reactionType)) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_REACTION', message: 'Must be HEART or REPEAT.' } });
    }

    const reaction = await prisma.memoryReaction.upsert({
      where: { memoryId_userId: { memoryId: req.params.id, userId: req.user.id } },
      update: { reactionType },
      create: { memoryId: req.params.id, userId: req.user.id, reactionType },
    });

    const memory = await prisma.memory.findUnique({ where: { id: req.params.id } });
    if (memory?.creatorId !== req.user.id) {
      await sendNotification(memory.creatorId, 'memory_reaction', {
        title: `${req.user.displayName} ${reactionType === 'HEART' ? 'loved' : 'wants to revisit'} your memory`,
        body: 'Tap to see it.',
        data: { memoryId: req.params.id }
      });
    }

    ok(res, { reaction });
  } catch (err) { next(err); }
});

// DELETE /memories/:id/react
router.delete('/:id/react', async (req, res, next) => {
  try {
    await prisma.memoryReaction.deleteMany({
      where: { memoryId: req.params.id, userId: req.user.id }
    });
    ok(res, { removed: true });
  } catch (err) { next(err); }
});

module.exports = router;
