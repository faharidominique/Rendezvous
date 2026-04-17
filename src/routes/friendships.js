// src/routes/friendships.js
const express = require('express');
const { prisma } = require('../services/db');
const { authMiddleware } = require('../middleware/auth');
const { sendNotification } = require('../services/notifications');

const router = express.Router();
router.use(authMiddleware);

function ok(res, data) { res.json({ success: true, data }); }

// GET /friendships
router.get('/', async (req, res, next) => {
  try {
    const friendships = await prisma.friendship.findMany({
      where: { status: 'ACCEPTED', OR: [{ requesterId: req.user.id }, { addresseeId: req.user.id }] },
      include: {
        requester: { select: { id: true, displayName: true, handle: true, avatarUrl: true } },
        addressee: { select: { id: true, displayName: true, handle: true, avatarUrl: true } },
      }
    });
    const friends = friendships.map(f =>
      f.requesterId === req.user.id ? f.addressee : f.requester
    );
    ok(res, { friends });
  } catch (err) { next(err); }
});

// GET /friendships/requests
router.get('/requests', async (req, res, next) => {
  try {
    const requests = await prisma.friendship.findMany({
      where: { addresseeId: req.user.id, status: 'PENDING' },
      include: { requester: { select: { id: true, displayName: true, handle: true, avatarUrl: true } } }
    });
    ok(res, { requests });
  } catch (err) { next(err); }
});

// POST /friendships/request
router.post('/request', async (req, res, next) => {
  try {
    const { addresseeId, handle } = req.body;
    let targetId = addresseeId;

    if (!targetId && handle) {
      const user = await prisma.user.findUnique({ where: { handle: handle.toLowerCase() } });
      if (!user) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'User not found.' } });
      targetId = user.id;
    }

    if (!targetId) return res.status(400).json({ success: false, error: { code: 'MISSING_FIELD', message: 'addresseeId or handle required.' } });
    if (targetId === req.user.id) return res.status(400).json({ success: false, error: { code: 'SELF_FRIEND', message: 'You cannot friend yourself.' } });

    const existing = await prisma.friendship.findFirst({
      where: { OR: [{ requesterId: req.user.id, addresseeId: targetId }, { requesterId: targetId, addresseeId: req.user.id }] }
    });
    if (existing) return res.status(409).json({ success: false, error: { code: 'ALREADY_EXISTS', message: 'Friend request already exists.' } });

    const friendship = await prisma.friendship.create({
      data: { requesterId: req.user.id, addresseeId: targetId }
    });

    await sendNotification(targetId, 'friend_request', {
      title: `${req.user.displayName} wants to be friends`,
      body: `@${req.user.handle} sent you a friend request on Rendezvous`,
      data: { friendshipId: friendship.id }
    });

    ok(res, { friendship });
  } catch (err) { next(err); }
});

// PATCH /friendships/:id
router.patch('/:id', async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!['ACCEPTED', 'DECLINED'].includes(status)) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_STATUS', message: 'Status must be ACCEPTED or DECLINED.' } });
    }

    const friendship = await prisma.friendship.findUnique({ where: { id: req.params.id } });
    if (!friendship) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Friend request not found.' } });
    if (friendship.addresseeId !== req.user.id) return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Not your request to respond to.' } });

    const updated = await prisma.friendship.update({ where: { id: req.params.id }, data: { status } });
    ok(res, { friendship: updated });
  } catch (err) { next(err); }
});

module.exports = router;
