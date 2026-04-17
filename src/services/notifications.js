// src/services/notifications.js
// Rendezvous Push Notification Service (Expo Push Notifications)
const axios = require('axios');
const { prisma } = require('./db');
const logger = require('../utils/logger');

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

// Notification type → preference field mapping
const NOTIF_PREFS = {
  'party_invite':   'partyInvite',
  'checkin_nudge':  'checkinNudge',
  'plans_ready':    'plansReady',
  'vote_reminder':  'voteReminder',
  'plan_confirmed': 'planConfirmed',
  'prosocial_nudge':'prosocialNudge',
  'memory_reaction':'memoryReaction',
  'friend_request': 'friendRequest',
};

// ── CHECK QUIET HOURS ─────────────────────────────────────────────────
function isQuietHours(prefs) {
  const hour = new Date().getHours();
  const { quietHoursStart = 23, quietHoursEnd = 9 } = prefs;

  if (quietHoursStart > quietHoursEnd) {
    // Spans midnight: e.g. 23:00 - 09:00
    return hour >= quietHoursStart || hour < quietHoursEnd;
  }
  return hour >= quietHoursStart && hour < quietHoursEnd;
}

// ── SEND TO ONE USER ──────────────────────────────────────────────────
async function sendNotification(userId, type, { title, body, data = {} }) {
  try {
    const [prefs, tokens] = await Promise.all([
      prisma.notifPreference.findUnique({ where: { userId } }),
      prisma.pushToken.findMany({ where: { userId } }),
    ]);

    if (!tokens.length) return; // No tokens registered

    // Check user preference for this notification type
    const prefField = NOTIF_PREFS[type];
    if (prefs && prefField && prefs[prefField] === false) return;

    // Check quiet hours
    if (prefs && isQuietHours(prefs)) {
      logger.info(`Suppressed notification for ${userId} (quiet hours)`);
      return;
    }

    const messages = tokens.map(token => ({
      to: token.token,
      sound: 'default',
      title,
      body,
      data: { type, ...data },
      badge: 1,
    }));

    const response = await axios.post(EXPO_PUSH_URL, messages, {
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
        ...(process.env.EXPO_ACCESS_TOKEN ? {
          'Authorization': `Bearer ${process.env.EXPO_ACCESS_TOKEN}`
        } : {})
      }
    });

    logger.info(`Push sent to ${userId} [${type}]: ${title}`);
    return response.data;
  } catch (err) {
    logger.warn(`Push notification failed for ${userId}:`, err.message);
  }
}

// ── PROSOCIAL NUDGE SCHEDULER (run daily via cron) ────────────────────
async function sendProsocialNudges() {
  logger.info('Running prosocial nudge check...');

  const prefs = await prisma.notifPreference.findMany({
    where: { prosocialNudge: true },
    include: { user: { include: { friendsRequested: { include: { addressee: true } }, friendsReceived: { include: { requester: true } } } } }
  });

  for (const pref of prefs) {
    const user = pref.user;
    const daysSinceActive = (Date.now() - new Date(user.lastActiveAt).getTime()) / (1000 * 60 * 60 * 24);

    if (daysSinceActive < pref.nudgeDays) continue;

    // Get friends who have been active recently
    const friends = [
      ...user.friendsRequested.filter(f => f.status === 'ACCEPTED').map(f => f.addressee),
      ...user.friendsReceived.filter(f => f.status === 'ACCEPTED').map(f => f.requester),
    ].filter(f => {
      const daysSinceFriendActive = (Date.now() - new Date(f.lastActiveAt).getTime()) / (1000 * 60 * 60 * 24);
      return daysSinceFriendActive < 7; // Friend was active in last week
    });

    if (!friends.length) continue;

    const friendNames = friends.slice(0, 2).map(f => f.displayName).join(' and ');
    const plural = friends.length > 2 ? ` and ${friends.length - 2} others` : '';

    await sendNotification(user.id, 'prosocial_nudge', {
      title: `${friendNames}${plural} miss you`,
      body: "It's been a while. Start a Party and see who's free tonight.",
      data: { action: 'create_party' }
    });
  }
}

module.exports = { sendNotification, sendProsocialNudges };
