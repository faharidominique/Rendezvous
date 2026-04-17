// src/routes/authExtra.js
// Adds to auth.js: email verification, password reset, user search
// Mount alongside auth routes in index.js:
//   app.use('/api/v1/auth', require('./routes/authExtra'))
const express  = require('express');
const bcrypt   = require('bcryptjs');
const crypto   = require('crypto');
const { body, query, validationResult } = require('express-validator');
const { prisma } = require('../services/db');
const { redis  } = require('../services/redis');
const { sendVerificationEmail, sendPasswordResetEmail, sendWelcomeEmail } = require('../services/email');
const { authMiddleware } = require('../middleware/auth');
const router = express.Router();

function ok(res, data, status = 200) { res.status(status).json({ success: true, data }); }
function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ success: false, error: { code: 'VALIDATION', message: errors.array()[0].msg, field: errors.array()[0].path } });
    return false;
  }
  return true;
}

// ── EMAIL VERIFICATION ────────────────────────────────────────────────

// POST /auth/send-verification — send or resend verification email
router.post('/send-verification', authMiddleware, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
    if (user.emailVerified) return ok(res, { alreadyVerified: true });

    // Rate limit: 1 verification email per 60 seconds
    const rateLimitKey = `verify_rate:${user.id}`;
    const recent = await redis.get(rateLimitKey);
    if (recent) return res.status(429).json({ success: false, error: { code: 'RATE_LIMIT', message: 'Please wait 60 seconds before requesting another verification email.' } });

    const token = crypto.randomBytes(32).toString('hex');
    await redis.setex(`verify_token:${token}`, 60 * 60 * 24, user.id); // 24 hours
    await redis.setex(rateLimitKey, 60, '1');

    await sendVerificationEmail(user, token);
    ok(res, { sent: true });
  } catch (err) { next(err); }
});

// GET /auth/verify-email?token=... — verify email address
router.get('/verify-email', async (req, res, next) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).json({ success: false, error: { code: 'MISSING_TOKEN' } });

    const userId = await redis.get(`verify_token:${token}`);
    if (!userId) return res.status(400).json({ success: false, error: { code: 'INVALID_OR_EXPIRED', message: 'Verification link is invalid or has expired.' } });

    await prisma.user.update({ where: { id: userId }, data: { emailVerified: true } });
    await redis.del(`verify_token:${token}`);

    // Send welcome email
    const user = await prisma.user.findUnique({ where: { id: userId } });
    await sendWelcomeEmail(user).catch(() => {}); // non-blocking

    ok(res, { verified: true });
  } catch (err) { next(err); }
});

// ── PASSWORD RESET ─────────────────────────────────────────────────────

// POST /auth/forgot-password
router.post('/forgot-password',
  [body('email').isEmail().normalizeEmail()],
  async (req, res, next) => {
    try {
      if (!validate(req, res)) return;

      const user = await prisma.user.findUnique({ where: { email: req.body.email } });
      // Always respond OK — don't reveal whether email exists
      if (!user || !user.hashedPassword) return ok(res, { sent: true });

      // Rate limit: 1 reset per 5 minutes
      const rateLimitKey = `reset_rate:${user.email}`;
      const recent = await redis.get(rateLimitKey);
      if (recent) return ok(res, { sent: true }); // silently throttle

      const token = crypto.randomBytes(32).toString('hex');
      await redis.setex(`reset_token:${token}`, 60 * 60, user.id); // 1 hour
      await redis.setex(rateLimitKey, 60 * 5, '1');

      await sendPasswordResetEmail(user, token);
      ok(res, { sent: true });
    } catch (err) { next(err); }
  }
);

// POST /auth/reset-password
router.post('/reset-password',
  [
    body('token').isString().notEmpty(),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  ],
  async (req, res, next) => {
    try {
      if (!validate(req, res)) return;

      const { token, password } = req.body;
      const userId = await redis.get(`reset_token:${token}`);
      if (!userId) return res.status(400).json({ success: false, error: { code: 'INVALID_OR_EXPIRED', message: 'Reset link is invalid or has expired.' } });

      const hashedPassword = await bcrypt.hash(password, 12);
      await prisma.user.update({ where: { id: userId }, data: { hashedPassword } });
      await redis.del(`reset_token:${token}`);

      // Invalidate all existing refresh tokens for this user
      await redis.del(`refresh:${userId}`);

      ok(res, { reset: true });
    } catch (err) { next(err); }
  }
);

// ── USER SEARCH ────────────────────────────────────────────────────────

// GET /api/v1/users/search?q=handle
router.get('/search',
  authMiddleware,
  [query('q').isString().trim().isLength({ min: 2 })],
  async (req, res, next) => {
    try {
      if (!validate(req, res)) return;
      const q = req.query.q.toLowerCase();

      const users = await prisma.user.findMany({
        where: {
          OR: [
            { handle: { contains: q, mode: 'insensitive' } },
            { displayName: { contains: q, mode: 'insensitive' } },
          ],
          NOT: { id: req.user.id }, // exclude self
        },
        select: { id: true, displayName: true, handle: true, avatarUrl: true, locationCity: true },
        take: 20,
      });

      // Annotate each result with friendship status
      const friendships = await prisma.friendship.findMany({
        where: {
          OR: [
            { requesterId: req.user.id, addresseeId: { in: users.map(u => u.id) } },
            { addresseeId: req.user.id, requesterId: { in: users.map(u => u.id) } },
          ]
        }
      });

      const withStatus = users.map(u => {
        const f = friendships.find(f => f.requesterId === u.id || f.addresseeId === u.id);
        return { ...u, friendshipStatus: f?.status || null, friendshipId: f?.id || null };
      });

      ok(res, { users: withStatus });
    } catch (err) { next(err); }
  }
);

// ── FRIEND SUGGESTIONS ─────────────────────────────────────────────────

// GET /api/v1/users/suggestions — people your friends know
router.get('/suggestions', authMiddleware, async (req, res, next) => {
  try {
    // Get current friends
    const friendships = await prisma.friendship.findMany({
      where: { status: 'ACCEPTED', OR: [{ requesterId: req.user.id }, { addresseeId: req.user.id }] }
    });
    const friendIds = friendships.map(f =>
      f.requesterId === req.user.id ? f.addresseeId : f.requesterId
    );

    if (!friendIds.length) {
      return ok(res, { suggestions: [] });
    }

    // Get friends-of-friends who aren't already friends
    const fofFriendships = await prisma.friendship.findMany({
      where: {
        status: 'ACCEPTED',
        OR: [
          { requesterId: { in: friendIds } },
          { addresseeId: { in: friendIds } },
        ],
      }
    });

    const candidateIds = new Set();
    for (const f of fofFriendships) {
      if (f.requesterId !== req.user.id && !friendIds.includes(f.requesterId)) {
        candidateIds.add(f.requesterId);
      }
      if (f.addresseeId !== req.user.id && !friendIds.includes(f.addresseeId)) {
        candidateIds.add(f.addresseeId);
      }
    }
    candidateIds.delete(req.user.id);

    if (!candidateIds.size) return ok(res, { suggestions: [] });

    const suggestions = await prisma.user.findMany({
      where: { id: { in: [...candidateIds] } },
      select: { id: true, displayName: true, handle: true, avatarUrl: true },
      take: 10,
    });

    ok(res, { suggestions });
  } catch (err) { next(err); }
});

module.exports = router;
