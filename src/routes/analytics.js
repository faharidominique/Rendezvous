// src/routes/analytics.js
const express = require('express');
const { prisma } = require('../services/db');
const { authMiddleware } = require('../middleware/auth');
const logger = require('../utils/logger');
const router = express.Router();
router.use(authMiddleware);

// Valid event types — whitelist to prevent junk data
const VALID_EVENTS = new Set([
  'app_open', 'onboarding_started', 'onboarding_completed', 'onboarding_step',
  'app_connect_started', 'app_connect_completed', 'app_connect_skipped',
  'discover_feed_viewed', 'spot_viewed', 'spot_saved', 'spot_added_to_party',
  'spot_detail_opened', 'spot_detail_closed',
  'party_created', 'party_joined', 'party_checkin_submitted',
  'party_generate_tapped', 'party_plans_received', 'party_voted',
  'party_plan_confirmed', 'party_shared',
  'memory_created', 'memory_reacted', 'memory_viewed',
  'friend_request_sent', 'friend_request_accepted',
  'profile_edited', 'settings_changed',
  'cold_start_prompt_shown', 'cold_start_app_connected',
  'notification_received', 'notification_tapped', 'notification_dismissed',
  'search_performed', 'search_result_tapped',
]);

// POST /api/v1/analytics/event
router.post('/event', async (req, res, next) => {
  try {
    const { eventType, properties = {}, timestamp } = req.body;

    if (!eventType || !VALID_EVENTS.has(eventType)) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_EVENT', message: `Unknown event type: ${eventType}` } });
    }

    // Store in DB — simple append-only table
    await prisma.analyticsEvent.create({
      data: {
        userId:     req.user.id,
        eventType,
        properties: properties || {},
        clientTs:   timestamp ? new Date(timestamp) : new Date(),
      }
    }).catch(err => {
      // Analytics failures are non-fatal
      logger.warn(`Analytics event failed to store: ${err.message}`);
    });

    res.status(202).json({ success: true });
  } catch (err) {
    // Analytics should never break the app
    res.status(202).json({ success: true });
  }
});

// POST /api/v1/analytics/batch — multiple events at once (for offline sync)
router.post('/batch', async (req, res, next) => {
  try {
    const { events = [] } = req.body;
    if (!Array.isArray(events) || events.length > 50) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_BATCH', message: 'events must be an array of ≤50 items.' } });
    }

    const validEvents = events
      .filter(e => e.eventType && VALID_EVENTS.has(e.eventType))
      .map(e => ({
        userId:     req.user.id,
        eventType:  e.eventType,
        properties: e.properties || {},
        clientTs:   e.timestamp ? new Date(e.timestamp) : new Date(),
      }));

    if (validEvents.length) {
      await prisma.analyticsEvent.createMany({ data: validEvents, skipDuplicates: true }).catch(() => {});
    }

    res.status(202).json({ success: true, data: { accepted: validEvents.length } });
  } catch (err) {
    res.status(202).json({ success: true });
  }
});

module.exports = router;
