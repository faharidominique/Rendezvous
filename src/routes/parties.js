// Rendezvous — Party Routes
const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { prisma } = require('../services/db');
const { redis } = require('../services/redis');
const { authMiddleware } = require('../middleware/auth');
const { buildTasteVector, buildGroupComposite } = require('../algorithms/tasteVector');
const { generatePlanOptions } = require('../algorithms/spotMatching');
const { generateAllNarratives } = require('../services/planNarrative');
const { getIO } = require('../websocket/socket');
const { sendNotification } = require('../services/notifications');
const { planGenerationLimit } = require('../middleware/rateLimit');
const logger = require('../utils/logger');

const router = express.Router();

// ── GUEST ROUTES (no auth required) ──────────────────────────────────

// POST /parties/guest/lookup — look up a party by code without auth
router.post('/guest/lookup',
  [body('code').isString().trim().toUpperCase()],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ success: false, error: { code: 'VALIDATION', message: errors.array()[0].msg } });

      const party = await prisma.party.findUnique({
        where: { code: req.body.code },
        include: {
          host: { select: { id: true, displayName: true, handle: true, avatarUrl: true } },
          members: {
            include: { user: { select: { id: true, displayName: true, handle: true, avatarUrl: true } } }
          }
        }
      });

      if (!party) return res.status(404).json({ success: false, error: { code: 'INVALID_CODE', message: 'Party code not found.' } });
      if (party.status === 'EXPIRED' || new Date() > party.expiresAt) {
        return res.status(410).json({ success: false, error: { code: 'PARTY_EXPIRED', message: 'This party has expired.' } });
      }

      // Return safe party data (no sensitive info)
      res.json({ success: true, data: {
        party: {
          id: party.id,
          code: party.code,
          status: party.status,
          locationCity: party.locationCity,
          host: party.host,
          memberCount: party.members.length,
          members: party.members.map(m => ({
            displayName: m.user?.displayName || m.guestName,
            avatarUrl: m.user?.avatarUrl || null,
            checkedIn: !!m.checkedInAt,
          })),
          expiresAt: party.expiresAt,
        }
      }});
    } catch (err) { next(err); }
  }
);

// POST /parties/guest/checkin — check in as a guest (Redis-only, no account required)
router.post('/guest/checkin',
  [
    body('code').isString().trim().toUpperCase(),
    body('guestName').isString().trim().isLength({ min: 1, max: 50 }),
    body('energyLevel').optional().isIn(['low', 'medium', 'high']),
    body('budget').optional().isInt({ min: 0, max: 1000 }),
    body('availableFrom').optional().matches(/^\d{2}:\d{2}$/),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ success: false, error: { code: 'VALIDATION', message: errors.array()[0].msg } });

      const { code, guestName, energyLevel, budget, availableFrom } = req.body;

      const party = await prisma.party.findUnique({ where: { code } });

      if (!party) return res.status(404).json({ success: false, error: { code: 'INVALID_CODE', message: 'Party code not found.' } });
      if (party.status === 'EXPIRED' || new Date() > party.expiresAt) {
        return res.status(410).json({ success: false, error: { code: 'PARTY_EXPIRED', message: 'This party has expired.' } });
      }

      // Store guest in Redis (guests are ephemeral — no DB write needed)
      const guestId = `guest_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const guestData = { guestId, partyId: party.id, guestName: guestName.trim(), energyLevel, budget, availableFrom, checkedInAt: new Date().toISOString() };
      await redis.setex(`party:${party.id}:guest:${guestId}`, 8 * 60 * 60, JSON.stringify(guestData));

      // Add to party guests set so we can list them
      await redis.sadd(`party:${party.id}:guests`, guestId);
      await redis.expire(`party:${party.id}:guests`, 8 * 60 * 60);

      // Generate a session token for this guest
      const guestToken = `${party.id}:${guestId}`;
      await redis.setex(`guest_session:${guestToken}`, 8 * 60 * 60, JSON.stringify(guestData));

      // Broadcast guest check-in to party room
      getIO().to(`party:${party.id}`).emit('party:guest_checkin', {
        member: { id: guestId, guestName: guestName.trim(), energyLevel, budget, checkedIn: true, isGuest: true }
      });

      // Notify host
      await sendNotification(party.hostId, 'party_invite', {
        title: `${guestName} checked in`,
        body: `${party.code} — they're in the waiting room`,
      }).catch(() => {});

      res.json({ success: true, data: { guestToken, partyId: party.id, guestId, guestName: guestName.trim() } });
    } catch (err) { next(err); }
  }
);

// ── AUTH REQUIRED FROM HERE ───────────────────────────────────────────
router.use(authMiddleware);

// ── GENERATE PARTY CODE ───────────────────────────────────────────────
async function generateUniqueCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code, exists;
  do {
    code = 'RNDVZ-' + Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    exists = await prisma.party.findUnique({ where: { code } });
  } while (exists);
  return code;
}

function ok(res, data, status = 200) {
  res.status(status).json({ success: true, data });
}

function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ success: false, error: { code: 'VALIDATION', message: errors.array()[0].msg, field: errors.array()[0].path } });
    return false;
  }
  return true;
}

// ── CREATE PARTY ──────────────────────────────────────────────────────
router.post('/',
  [body('locationCity').optional().isString()],
  async (req, res, next) => {
    try {
      if (!validate(req, res)) return;

      const code = await generateUniqueCode();
      const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000); // 8 hours

      const party = await prisma.party.create({
        data: {
          hostId: req.user.id,
          code,
          expiresAt,
          locationCity: req.body.locationCity,
          members: {
            create: {
              userId: req.user.id,
              joinedAt: new Date(),
            }
          }
        },
        include: { members: { include: { user: { select: { id: true, displayName: true, handle: true, avatarUrl: true } } } } }
      });

      // Store active party in Redis
      await redis.setex(`party:${party.id}:active`, 8 * 60 * 60, '1');

      ok(res, { party }, 201);
    } catch (err) { next(err); }
  }
);

// ── GET MY ACTIVE PARTY ───────────────────────────────────────────────
router.get('/mine', async (req, res, next) => {
  try {
    // Find the most recent non-expired party where the user is a member
    const membership = await prisma.partyMember.findFirst({
      where: {
        userId: req.user.id,
        party: {
          status: { in: ['ACTIVE', 'GENERATING', 'VOTING', 'CONFIRMED'] },
          expiresAt: { gt: new Date() },
        }
      },
      orderBy: { joinedAt: 'desc' },
      include: {
        party: {
          include: {
            host: { select: { id: true, displayName: true, handle: true, avatarUrl: true } },
            members: {
              include: { user: { select: { id: true, displayName: true, handle: true, avatarUrl: true } } }
            },
            votes: true,
          }
        }
      }
    });

    if (!membership) {
      return res.json({ success: true, data: { party: null } });
    }

    res.json({ success: true, data: { party: membership.party } });
  } catch (err) { next(err); }
});

// ── GET PARTY ─────────────────────────────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const party = await prisma.party.findUnique({
      where: { id: req.params.id },
      include: {
        host: { select: { id: true, displayName: true, handle: true, avatarUrl: true } },
        members: {
          include: {
            user: { select: { id: true, displayName: true, handle: true, avatarUrl: true } }
          }
        },
        votes: true,
      }
    });

    if (!party) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Party not found.' } });

    const isMember = party.members.some(m => m.userId === req.user.id);
    if (!isMember) return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'You are not in this party.' } });

    ok(res, { party });
  } catch (err) { next(err); }
});

// ── JOIN BY CODE ──────────────────────────────────────────────────────
router.post('/join/code',
  [body('code').isString().trim().toUpperCase()],
  async (req, res, next) => {
    try {
      if (!validate(req, res)) return;

      const party = await prisma.party.findUnique({
        where: { code: req.body.code },
        include: { members: true }
      });

      if (!party) return res.status(404).json({ success: false, error: { code: 'INVALID_CODE', message: 'Party code not found.' } });
      if (party.status === 'EXPIRED' || new Date() > party.expiresAt) {
        return res.status(410).json({ success: false, error: { code: 'PARTY_EXPIRED', message: 'This party has expired.' } });
      }
      if (party.members.some(m => m.userId === req.user.id)) {
        return ok(res, { party, alreadyMember: true });
      }

      const member = await prisma.partyMember.create({
        data: { partyId: party.id, userId: req.user.id },
        include: { user: { select: { id: true, displayName: true, handle: true, avatarUrl: true } } }
      });

      // Broadcast join to party room
      getIO().to(`party:${party.id}`).emit('party:member_joined', { member });

      // Notify host
      await sendNotification(party.hostId, 'party_invite', {
        title: `${req.user.displayName} joined your party`,
        body: `${party.code} — ${party.members.length + 1} members now`,
      });

      const updated = await prisma.party.findUnique({
        where: { id: party.id },
        include: { members: { include: { user: { select: { id: true, displayName: true, handle: true, avatarUrl: true } } } } }
      });

      ok(res, { party: updated });
    } catch (err) { next(err); }
  }
);

// ── CHECK IN ──────────────────────────────────────────────────────────
router.patch('/:id/checkin',
  [
    param('id').isUUID(),
    body('energyLevel').optional().isIn(['low', 'medium', 'high']),
    body('budget').optional().isInt({ min: 0, max: 1000 }),
    body('availableFrom').optional().matches(/^\d{2}:\d{2}$/),
  ],
  async (req, res, next) => {
    try {
      if (!validate(req, res)) return;

      const member = await prisma.partyMember.findFirst({
        where: { partyId: req.params.id, userId: req.user.id }
      });
      if (!member) return res.status(403).json({ success: false, error: { code: 'NOT_MEMBER', message: 'You are not in this party.' } });

      const updated = await prisma.partyMember.update({
        where: { id: member.id },
        data: {
          energyLevel: req.body.energyLevel,
          budget: req.body.budget,
          availableFrom: req.body.availableFrom,
          checkedInAt: new Date(),
        },
        include: { user: { select: { id: true, displayName: true, handle: true } } }
      });

      // Broadcast check-in update to party room
      getIO().to(`party:${req.params.id}`).emit('party:checkin_updated', {
        member: updated,
        userId: req.user.id,
      });

      ok(res, { member: updated });
    } catch (err) { next(err); }
  }
);

// ── GENERATE PLANS ────────────────────────────────────────────────────
router.post('/:id/generate', planGenerationLimit, async (req, res, next) => {
  try {
    const party = await prisma.party.findUnique({
      where: { id: req.params.id },
      include: { members: true }
    });

    if (!party) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Party not found.' } });
    if (party.hostId !== req.user.id) return res.status(403).json({ success: false, error: { code: 'HOST_ONLY', message: 'Only the host can generate plans.' } });

    // Update status to GENERATING
    await prisma.party.update({ where: { id: party.id }, data: { status: 'GENERATING' } });
    getIO().to(`party:${party.id}`).emit('party:generation_started', { partyId: party.id });

    // Fetch all members' taste profiles
    const memberIds = party.members.map(m => m.userId);
    const tasteProfiles = await prisma.tasteProfile.findMany({
      where: { userId: { in: memberIds } }
    });

    // Build group composite
    const composite = buildGroupComposite(party.members, tasteProfiles);

    // Get group's collective activities
    const groupActivities = [...new Set(
      tasteProfiles.flatMap(p => p.activities || [])
    )];

    // Get visited / loved spots for this group
    const shelfItems = await prisma.shelfItem.findMany({
      where: { userId: { in: memberIds } },
      select: { spotId: true }
    });
    const visitedSpotIds = [...new Set(shelfItems.map(s => s.spotId))];

    const reactions = await prisma.memoryReaction.findMany({
      where: { userId: { in: memberIds }, reactionType: 'HEART' },
      include: { memory: { select: { spotId: true } } }
    });
    const lovedSpotIds = [...new Set(reactions.filter(r => r.memory.spotId).map(r => r.memory.spotId))];

    // Generate plans
    const rawPlans = await generatePlanOptions(composite, {
      cityFilter: party.locationCity,
      centerLat: party.locationLat,
      centerLng: party.locationLng,
      groupActivities,
      visitedSpotIds,
      lovedSpotIds,
    });

    // Generate narratives with Claude
    const plans = await generateAllNarratives(rawPlans, composite, party.members.length);

    // Save plans and update status to VOTING
    await prisma.party.update({
      where: { id: party.id },
      data: { status: 'VOTING', generatedPlans: plans }
    });

    // Broadcast plans to all members
    getIO().to(`party:${party.id}`).emit('party:plans_ready', { plans, partyId: party.id });

    // Notify all members
    for (const memberId of memberIds) {
      if (memberId !== req.user.id) {
        await sendNotification(memberId, 'plans_ready', {
          title: 'Your plans are ready ✦',
          body: 'Rendezvous has 3 options for tonight. Tap to vote.',
          data: { partyId: party.id }
        });
      }
    }

    ok(res, { plans });
  } catch (err) {
    // Reset party status on error
    await prisma.party.update({ where: { id: req.params.id }, data: { status: 'ACTIVE' } }).catch(() => {});
    next(err);
  }
});

// ── VOTE ──────────────────────────────────────────────────────────────
router.post('/:id/vote',
  [
    param('id').isUUID(),
    body('planIndex').isInt({ min: 0, max: 2 }),
  ],
  async (req, res, next) => {
    try {
      if (!validate(req, res)) return;

      const party = await prisma.party.findUnique({
        where: { id: req.params.id },
        include: { members: true, votes: true }
      });

      if (!party) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Party not found.' } });

      const isMember = party.members.some(m => m.userId === req.user.id);
      if (!isMember) return res.status(403).json({ success: false, error: { code: 'NOT_MEMBER', message: 'You are not in this party.' } });

      // Upsert vote
      await prisma.partyVote.upsert({
        where: { partyId_userId: { partyId: party.id, userId: req.user.id } },
        update: { planIndex: req.body.planIndex, votedAt: new Date() },
        create: { partyId: party.id, userId: req.user.id, planIndex: req.body.planIndex }
      });

      // Tally votes
      const allVotes = await prisma.partyVote.findMany({ where: { partyId: party.id } });
      const tally = [0, 0, 0];
      allVotes.forEach(v => tally[v.planIndex]++);

      const votedCount = allVotes.length;
      const totalMembers = party.members.length;
      const majority = Math.ceil(totalMembers / 2);

      // Broadcast vote update
      getIO().to(`party:${party.id}`).emit('party:vote_cast', {
        tally,
        votedCount,
        totalMembers,
        userId: req.user.id,
        planIndex: req.body.planIndex,
      });

      // Check if majority reached
      const winnerIndex = tally.findIndex(v => v >= majority);
      if (winnerIndex !== -1 && party.status === 'VOTING') {
        // Store confirmedIndex inside generatedPlans JSON (no migration needed)
        const updatedPlans = Array.isArray(party.generatedPlans) ? [...party.generatedPlans] : [];
        updatedPlans.confirmedIndex = winnerIndex;
        await prisma.party.update({
          where: { id: party.id },
          data: { status: 'CONFIRMED', generatedPlans: updatedPlans }
        });

        getIO().to(`party:${party.id}`).emit('party:plan_confirmed', {
          planIndex: winnerIndex,
          plan: party.generatedPlans[winnerIndex],
        });

        // Notify all members of confirmation
        for (const member of party.members) {
          const plan = party.generatedPlans?.[winnerIndex];
          await sendNotification(member.userId, 'plan_confirmed', {
            title: 'Tonight is set ✦',
            body: plan ? `${plan.label} — tap for details` : 'Your plan for tonight is confirmed.',
            data: { partyId: party.id }
          });
        }
      }

      ok(res, { tally, votedCount, totalMembers, confirmed: winnerIndex !== -1, confirmedPlanIndex: winnerIndex });
    } catch (err) { next(err); }
  }
);

// ── GET PARTY HISTORY ─────────────────────────────────────────────────
router.get('/history', async (req, res, next) => {
  try {
    const memberships = await prisma.partyMember.findMany({
      where: { userId: req.user.id },
      orderBy: { joinedAt: 'desc' },
      take: 20,
      include: {
        party: {
          include: {
            host: { select: { id: true, displayName: true, handle: true, avatarUrl: true } },
            members: {
              include: { user: { select: { id: true, displayName: true, handle: true, avatarUrl: true } } },
              take: 5,
            },
            _count: { select: { memories: true, members: true } }
          }
        }
      }
    });

    const parties = memberships.map(m => ({
      ...m.party,
      wasHost: m.party.hostId === req.user.id,
      joinedAt: m.joinedAt,
    }));

    ok(res, { parties });
  } catch (err) { next(err); }
});

// ── POST-NIGHT RATING ─────────────────────────────────────────────────
router.post('/:id/rate',
  [
    param('id').isUUID(),
    body('rating').isInt({ min: 1, max: 5 }),
    body('tags').optional().isArray(),
    body('note').optional().isString().isLength({ max: 280 }),
  ],
  async (req, res, next) => {
    try {
      if (!validate(req, res)) return;

      const party = await prisma.party.findUnique({
        where: { id: req.params.id },
        include: { members: true }
      });

      if (!party) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Party not found.' } });

      const isMember = party.members.some(m => m.userId === req.user.id);
      if (!isMember) return res.status(403).json({ success: false, error: { code: 'NOT_MEMBER', message: 'You were not in this party.' } });

      // Store rating as a memory on the party
      const confirmedIdx = Array.isArray(party.generatedPlans) ? party.generatedPlans.confirmedIndex : null;
      const confirmedPlan = confirmedIdx != null ? party.generatedPlans?.[confirmedIdx] : null;
      const memory = await prisma.memory.create({
        data: {
          authorId: req.user.id,
          partyId: party.id,
          spotId: confirmedPlan?.spots?.[0]?.id || null,
          content: req.body.note || `Rated ${req.body.rating}/5`,
          mediaType: 'TEXT',
          tags: req.body.tags || [],
          mood: req.body.rating >= 4 ? 'happy' : req.body.rating >= 3 ? 'neutral' : 'meh',
        }
      });

      // Apply feedback to taste profile based on rating
      const tasteProfile = await prisma.tasteProfile.findUnique({ where: { userId: req.user.id } });
      if (tasteProfile && confirmedPlan?.spots?.length) {
        const { applyFeedback } = require('../algorithms/tasteVector');
        const reactionType = req.body.rating >= 4 ? 'HEART' : req.body.rating <= 2 ? 'SKIP' : null;
        if (reactionType) {
          const currentVector = {
            energyLevel: tasteProfile.energyLevel, socialOpenness: tasteProfile.socialOpenness,
            spontaneity: tasteProfile.spontaneity, culturalAppetite: tasteProfile.culturalAppetite,
            foodPriority: tasteProfile.foodPriority, outdoorPreference: tasteProfile.outdoorPreference,
            budgetSensitivity: tasteProfile.budgetSensitivity, nightOwlScore: tasteProfile.nightOwlScore,
            activityDiversity: tasteProfile.activityDiversity,
          };
          const updatedVector = applyFeedback(currentVector, [{ type: reactionType, spotAttributes: confirmedPlan.spots[0] }]);
          await prisma.tasteProfile.update({ where: { userId: req.user.id }, data: updatedVector });
        }
      }

      ok(res, { rated: true, memory });
    } catch (err) { next(err); }
  }
);

module.exports = router;
