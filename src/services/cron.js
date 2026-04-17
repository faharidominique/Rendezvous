// src/services/cron.js
// Background job scheduler — runs on server startup
const cron = require('node-cron');
const { syncAllUsers } = require('./spotify');
const { sendProsocialNudges } = require('./notifications');
const { prisma } = require('./db');
const logger = require('../utils/logger');

function initCronJobs() {
  // ── Spotify weekly sync — every Sunday at 3am ──────────────────────
  cron.schedule('0 3 * * 0', async () => {
    logger.info('[CRON] Starting weekly Spotify sync');
    try { await syncAllUsers(); logger.info('[CRON] Spotify sync complete'); }
    catch (err) { logger.error('[CRON] Spotify sync failed:', err.message); }
  });

  // ── Prosocial nudges — every day at 11am ───────────────────────────
  cron.schedule('0 11 * * *', async () => {
    logger.info('[CRON] Running prosocial nudge check');
    try { await sendProsocialNudges(); }
    catch (err) { logger.error('[CRON] Prosocial nudge failed:', err.message); }
  });

  // ── Vote reminders — every 15 minutes ─────────────────────────────
  cron.schedule('*/15 * * * *', async () => {
    try {
      // Find parties in VOTING state for > 15 minutes with members who haven't voted
      const cutoff = new Date(Date.now() - 15 * 60 * 1000);
      const parties = await prisma.party.findMany({
        where: { status: 'VOTING', updatedAt: { lte: cutoff } },
        include: { members: true, votes: true }
      });

      const { sendNotification } = require('./notifications');
      for (const party of parties) {
        const votedUserIds = new Set(party.votes.map(v => v.userId));
        const nonVoters = party.members.filter(m => !votedUserIds.has(m.userId));
        for (const member of nonVoters) {
          await sendNotification(member.userId, 'vote_reminder', {
            title: 'The crew is waiting on you ✦',
            body: 'Your party has 3 plan options ready. Cast your vote.',
            data: { partyId: party.id }
          });
        }
      }
    } catch (err) { logger.error('[CRON] Vote reminder failed:', err.message); }
  });

  // ── Expire old parties — every hour ───────────────────────────────
  cron.schedule('0 * * * *', async () => {
    try {
      const result = await prisma.party.updateMany({
        where: { status: { in: ['ACTIVE', 'GENERATING', 'VOTING'] }, expiresAt: { lte: new Date() } },
        data: { status: 'EXPIRED' }
      });
      if (result.count > 0) logger.info(`[CRON] Expired ${result.count} parties`);
    } catch (err) { logger.error('[CRON] Party expiry failed:', err.message); }
  });

  // ── Spot freshness check — every Monday at 4am ────────────────────
  cron.schedule('0 4 * * 1', async () => {
    try {
      const staleCutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      const staleCount = await prisma.spot.count({ where: { lastVerifiedAt: { lte: staleCutoff }, isActive: true } });
      if (staleCount > 0) {
        logger.warn(`[CRON] ${staleCount} spots haven't been verified in 90+ days — review needed`);
      }
    } catch (err) { logger.error('[CRON] Spot freshness check failed:', err.message); }
  });

  logger.info('Cron jobs initialised');
}

module.exports = { initCronJobs };
