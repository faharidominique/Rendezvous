// ════════════════════════════════════════════════════════════════
// src/routes/users.js
// ════════════════════════════════════════════════════════════════
const express = require('express');
const { body, validationResult } = require('express-validator');
const { prisma } = require('../services/db');
const { authMiddleware } = require('../middleware/auth');
const { buildTasteVector } = require('../algorithms/tasteVector');
const { applyFeedback } = require('../algorithms/tasteVector');

const router = express.Router();
router.use(authMiddleware);

function ok(res, data) { res.json({ success: true, data }); }

// GET /users/me
router.get('/me', async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: {
        tasteProfile: true,
        notifPreferences: true,
        appConnections: { select: { provider: true, lastSyncedAt: true } },
      }
    });
    ok(res, { user });
  } catch (err) { next(err); }
});

// GET /users/:id
router.get('/:id', async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: {
        id: true, displayName: true, handle: true, avatarUrl: true, locationCity: true, createdAt: true,
        _count: { select: { memoriesCreated: true, partiesHosted: true } }
      }
    });
    if (!user) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'User not found.' } });
    ok(res, { user });
  } catch (err) { next(err); }
});

// PATCH /users/me — update profile
router.patch('/me',
  [
    body('displayName').optional().trim().isLength({ min: 1, max: 50 }),
    body('locationCity').optional().isString(),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ success: false, error: { code: 'VALIDATION', message: errors.array()[0].msg } });

      const user = await prisma.user.update({
        where: { id: req.user.id },
        data: {
          displayName: req.body.displayName,
          locationCity: req.body.locationCity,
          locationLat: req.body.locationLat,
          locationLng: req.body.locationLng,
        }
      });
      ok(res, { user });
    } catch (err) { next(err); }
  }
);

// PATCH /users/me/taste — update taste profile
router.patch('/me/taste', async (req, res, next) => {
  try {
    const {
      activities, vibeTags, budgetMin, budgetMax,
      mbtiType, mbtiSource, energyLevel, spontaneity
    } = req.body;

    const profile = await prisma.tasteProfile.upsert({
      where: { userId: req.user.id },
      update: {
        activities:   activities !== undefined ? activities : undefined,
        vibeTags:     vibeTags !== undefined ? vibeTags : undefined,
        budgetMin:    budgetMin !== undefined ? budgetMin : undefined,
        budgetMax:    budgetMax !== undefined ? budgetMax : undefined,
        mbtiType:     mbtiType !== undefined ? mbtiType : undefined,
        mbtiSource:   mbtiSource !== undefined ? mbtiSource : undefined,
      },
      create: {
        userId: req.user.id,
        activities: activities || [],
        vibeTags: vibeTags || [],
        budgetMin: budgetMin || 0,
        budgetMax: budgetMax || 50,
        mbtiType: mbtiType || null,
        mbtiSource: mbtiSource || null,
      }
    });

    // Rebuild taste vector from scratch
    const { vector, confidence } = buildTasteVector(profile);
    await prisma.tasteProfile.update({
      where: { userId: req.user.id },
      data: { ...vector, signalConfidence: confidence }
    });

    ok(res, { profile: { ...profile, ...vector, signalConfidence: confidence } });
  } catch (err) { next(err); }
});

// POST /users/me/feedback — post-outing reaction feedback
router.post('/me/feedback', async (req, res, next) => {
  try {
    const { reactions } = req.body; // [{ spotId, type, spotAttributes }]
    if (!Array.isArray(reactions)) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION', message: 'reactions must be an array.' } });
    }

    const profile = await prisma.tasteProfile.findUnique({ where: { userId: req.user.id } });
    if (!profile) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Taste profile not found.' } });

    const currentVector = {
      energyLevel: profile.energyLevel, socialOpenness: profile.socialOpenness,
      spontaneity: profile.spontaneity, culturalAppetite: profile.culturalAppetite,
      foodPriority: profile.foodPriority, outdoorPreference: profile.outdoorPreference,
      budgetSensitivity: profile.budgetSensitivity, nightOwlScore: profile.nightOwlScore,
      activityDiversity: profile.activityDiversity,
    };

    const updatedVector = applyFeedback(currentVector, reactions);
    await prisma.tasteProfile.update({ where: { userId: req.user.id }, data: updatedVector });

    ok(res, { updated: true });
  } catch (err) { next(err); }
});

// GET /users/:id/compatibility/:otherId — vibe compatibility score
router.get('/:id/compatibility/:otherId', async (req, res, next) => {
  try {
    const [profileA, profileB] = await Promise.all([
      prisma.tasteProfile.findUnique({ where: { userId: req.params.id } }),
      prisma.tasteProfile.findUnique({ where: { userId: req.params.otherId } }),
    ]);

    if (!profileA || !profileB) {
      return res.json({ success: true, data: { score: null, reason: 'Incomplete profiles' } });
    }

    // Cosine-similarity style score on 9 vector dimensions
    const dims = [
      'energyLevel','socialOpenness','spontaneity','culturalAppetite',
      'foodPriority','outdoorPreference','budgetSensitivity','nightOwlScore','activityDiversity'
    ];

    let dot = 0, magA = 0, magB = 0;
    for (const d of dims) {
      const a = profileA[d] || 0.5;
      const b = profileB[d] || 0.5;
      dot  += a * b;
      magA += a * a;
      magB += b * b;
    }
    const cosine = magA && magB ? dot / (Math.sqrt(magA) * Math.sqrt(magB)) : 0;
    const score  = Math.round(cosine * 100);

    // Shared vibe tags
    const tagsA = new Set(profileA.vibeTags || []);
    const sharedTags = (profileB.vibeTags || []).filter(t => tagsA.has(t));

    // Shared activities
    const actsA = new Set(profileA.activities || []);
    const sharedActivities = (profileB.activities || []).filter(a => actsA.has(a));

    let label = 'Different vibes';
    if (score >= 90) label = 'Perfect match';
    else if (score >= 75) label = 'Great match';
    else if (score >= 60) label = 'Good match';
    else if (score >= 45) label = 'Some overlap';

    ok(res, { score, label, sharedTags, sharedActivities });
  } catch (err) { next(err); }
});

// GET /users/:handle/profile — public profile by handle
router.get('/by-handle/:handle', async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { handle: req.params.handle },
      select: {
        id: true, displayName: true, handle: true, avatarUrl: true,
        locationCity: true, createdAt: true,
        tasteProfile: {
          select: {
            activities: true, vibeTags: true, energyLevel: true,
            socialOpenness: true, spontaneity: true, nightOwlScore: true,
          }
        },
        _count: { select: { memoriesCreated: true, partiesHosted: true } }
      }
    });
    if (!user) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'User not found.' } });

    // Recent party count (last 30 days)
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const recentParties = await prisma.partyMember.count({
      where: { userId: user.id, joinedAt: { gte: since } }
    });

    ok(res, { user: { ...user, recentParties } });
  } catch (err) { next(err); }
});

module.exports = router;
