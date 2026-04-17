// src/routes/gdpr.js — GDPR data export & account deletion
const express = require('express');
const { prisma } = require('../services/db');
const { redis }  = require('../services/redis');
const { authMiddleware } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();
router.use(authMiddleware);

// GET /api/v1/users/me/export
router.get('/me/export', async (req, res, next) => {
  try {
    const userId = req.user.id;

    const [
      user, tasteProfile, parties, partyMembers, votes,
      shelfItems, memories, reactions, friendships, notifPrefs, appConnections
    ] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { id:true, email:true, displayName:true, handle:true, locationCity:true, createdAt:true, lastActiveAt:true }
      }),
      prisma.tasteProfile.findUnique({ where: { userId } }),
      prisma.party.findMany({ where: { hostId: userId }, select: { id:true, code:true, status:true, createdAt:true, completedAt:true } }),
      prisma.partyMember.findMany({ where: { userId }, select: { partyId:true, energyLevel:true, checkedInAt:true, joinedAt:true } }),
      prisma.partyVote.findMany({ where: { userId }, select: { partyId:true, planIndex:true, votedAt:true } }),
      prisma.shelfItem.findMany({ where: { userId }, include: { spot: { select: { name:true, category:true, neighborhood:true } } } }),
      prisma.memory.findMany({ where: { creatorId: userId }, select: { id:true, caption:true, createdAt:true, spotId:true } }),
      prisma.memoryReaction.findMany({ where: { userId }, select: { memoryId:true, reactionType:true, createdAt:true } }),
      prisma.friendship.findMany({ where: { OR:[{requesterId:userId},{addresseeId:userId}] }, select: { requesterId:true, addresseeId:true, status:true, createdAt:true } }),
      prisma.notifPreference.findUnique({ where: { userId } }),
      prisma.appConnection.findMany({ where: { userId }, select: { provider:true, scopes:true, lastSyncedAt:true } }),
    ]);

    const exportData = {
      exportedAt: new Date().toISOString(),
      user,
      tasteProfile: tasteProfile ? { ...tasteProfile, spotifySignals: '[redacted]', appleMusicSignals: '[redacted]' } : null,
      parties, partyMemberships: partyMembers, votes,
      savedSpots: shelfItems,
      memories, memoryReactions: reactions, friendships,
      notificationPreferences: notifPrefs,
      connectedApps: appConnections,
    };

    res.setHeader('Content-Disposition', `attachment; filename="rendezvous-data-${userId}.json"`);
    res.setHeader('Content-Type', 'application/json');
    res.json(exportData);
  } catch (err) { next(err); }
});

// DELETE /api/v1/users/me
router.delete('/me', async (req, res, next) => {
  try {
    const userId = req.user.id;
    logger.info(`Account deletion requested for user ${userId}`);

    await redis.del(`refresh:${userId}`);

    await prisma.user.delete({ where: { id: userId } });

    logger.info(`Account deleted: ${userId}`);
    res.json({ success: true, data: { deleted: true, message: 'Your account and all associated data have been permanently deleted.' } });
  } catch (err) { next(err); }
});

module.exports = router;
