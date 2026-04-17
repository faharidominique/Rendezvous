// Rendezvous — Auth Routes & Controller
const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { prisma }  = require('../services/db');
const { redis }   = require('../services/redis');
const { nanoid }  = require('nanoid');
const router = express.Router();

// ── HELPERS ───────────────────────────────────────────────────────────
function generateAccessToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_ACCESS_SECRET, {
    expiresIn: process.env.JWT_ACCESS_EXPIRES || '15m'
  });
}

async function generateRefreshToken(userId) {
  const token = nanoid(64);
  // Store hashed refresh token in Redis with 30-day TTL
  const hash = await bcrypt.hash(token, 8);
  await redis.setex(`refresh:${userId}`, 60 * 60 * 24 * 30, hash);
  return token;
}

function respond(res, status, data) {
  res.status(status).json({ success: true, data });
}

function createDefaultTasteProfile(userId) {
  return prisma.tasteProfile.create({
    data: {
      userId,
      activities: [],
      vibeTags: [],
      budgetMin: 0,
      budgetMax: 50,
      energyLevel: 0.5,
      socialOpenness: 0.5,
      spontaneity: 0.5,
      culturalAppetite: 0.5,
      foodPriority: 0.5,
      outdoorPreference: 0.5,
      budgetSensitivity: 0.5,
      nightOwlScore: 0.5,
      activityDiversity: 0.5,
      signalConfidence: 0.1,
    }
  });
}

// ── REGISTER ─────────────────────────────────────────────────────────
router.post('/register',
  [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    body('displayName').trim().isLength({ min: 1, max: 50 }),
    body('handle').trim().isLength({ min: 2, max: 30 }).matches(/^[a-z0-9_]+$/i)
      .withMessage('Handle can only contain letters, numbers, and underscores'),
    body('birthYear').optional().isInt({ min: 1900, max: new Date().getFullYear() }),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, error: { code: 'VALIDATION', message: errors.array()[0].msg, field: errors.array()[0].path } });
      }

      const { email, password, displayName, handle, birthYear } = req.body;

      // COPPA age check
      if (birthYear) {
        const age = new Date().getFullYear() - birthYear;
        if (age < 13) {
          return res.status(403).json({ success: false, error: { code: 'UNDER_AGE', message: 'Users must be 13 or older to register.' } });
        }
      }

      // Check uniqueness
      const [existingEmail, existingHandle] = await Promise.all([
        prisma.user.findUnique({ where: { email } }),
        prisma.user.findUnique({ where: { handle: handle.toLowerCase() } }),
      ]);

      if (existingEmail) return res.status(409).json({ success: false, error: { code: 'EMAIL_TAKEN', message: 'That email is already registered.', field: 'email' } });
      if (existingHandle) return res.status(409).json({ success: false, error: { code: 'HANDLE_TAKEN', message: 'That handle is already taken.', field: 'handle' } });

      const hashedPassword = await bcrypt.hash(password, 12);

      const user = await prisma.user.create({
        data: {
          email,
          hashedPassword,
          displayName,
          handle: handle.toLowerCase(),
          isMinor: birthYear ? (new Date().getFullYear() - birthYear) < 18 : false,
        }
      });

      // Create default taste profile and notification preferences
      await Promise.all([
        createDefaultTasteProfile(user.id),
        prisma.notifPreference.create({ data: { userId: user.id } }),
      ]);

      const accessToken  = generateAccessToken(user.id);
      const refreshToken = await generateRefreshToken(user.id);

      respond(res, 201, {
        accessToken, refreshToken,
        user: { id: user.id, email: user.email, displayName: user.displayName, handle: user.handle }
      });
    } catch (err) { next(err); }
  }
);

// ── LOGIN ─────────────────────────────────────────────────────────────
router.post('/login',
  [
    body('email').isEmail().normalizeEmail(),
    body('password').notEmpty(),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, error: { code: 'VALIDATION', message: 'Invalid email or password format.' } });
      }

      const { email, password } = req.body;
      const user = await prisma.user.findUnique({ where: { email } });

      if (!user || !user.hashedPassword) {
        return res.status(401).json({ success: false, error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' } });
      }

      const passwordMatch = await bcrypt.compare(password, user.hashedPassword);
      if (!passwordMatch) {
        return res.status(401).json({ success: false, error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' } });
      }

      // Update last active
      await prisma.user.update({ where: { id: user.id }, data: { lastActiveAt: new Date() } });

      const accessToken  = generateAccessToken(user.id);
      const refreshToken = await generateRefreshToken(user.id);

      respond(res, 200, {
        accessToken, refreshToken,
        user: { id: user.id, email: user.email, displayName: user.displayName, handle: user.handle, avatarUrl: user.avatarUrl }
      });
    } catch (err) { next(err); }
  }
);

// ── REFRESH TOKEN ─────────────────────────────────────────────────────
router.post('/refresh', async (req, res, next) => {
  try {
    const { refreshToken, userId } = req.body;
    if (!refreshToken || !userId) {
      return res.status(400).json({ success: false, error: { code: 'MISSING_FIELDS', message: 'refreshToken and userId required.' } });
    }

    const storedHash = await redis.get(`refresh:${userId}`);
    if (!storedHash) {
      return res.status(401).json({ success: false, error: { code: 'REFRESH_EXPIRED', message: 'Refresh token expired. Please log in again.' } });
    }

    const valid = await bcrypt.compare(refreshToken, storedHash);
    if (!valid) {
      return res.status(401).json({ success: false, error: { code: 'INVALID_REFRESH', message: 'Invalid refresh token.' } });
    }

    // Rotate: invalidate old, issue new
    await redis.del(`refresh:${userId}`);
    const newAccessToken  = generateAccessToken(userId);
    const newRefreshToken = await generateRefreshToken(userId);

    respond(res, 200, { accessToken: newAccessToken, refreshToken: newRefreshToken });
  } catch (err) { next(err); }
});

// ── APPLE SIGN IN ─────────────────────────────────────────────────────
// Note: Requires apple-signin-auth package and Apple Developer credentials
router.post('/apple', async (req, res, next) => {
  try {
    const { identityToken, displayName } = req.body;
    if (!identityToken) {
      return res.status(400).json({ success: false, error: { code: 'MISSING_TOKEN', message: 'Apple identity token required.' } });
    }

    // Decode Apple JWT (in production, verify signature with Apple's public key)
    const payload = JSON.parse(Buffer.from(identityToken.split('.')[1], 'base64').toString());
    const appleUserId = payload.sub;
    const email = payload.email;

    if (!appleUserId) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_APPLE_TOKEN', message: 'Could not verify Apple identity.' } });
    }

    // Find or create user
    let user = await prisma.user.findFirst({ where: { email } });

    if (!user) {
      const baseHandle = (displayName || email.split('@')[0]).toLowerCase().replace(/[^a-z0-9]/g, '');
      let handle = baseHandle;
      let suffix = 1;
      while (await prisma.user.findUnique({ where: { handle } })) {
        handle = `${baseHandle}${suffix++}`;
      }

      user = await prisma.user.create({
        data: { email, displayName: displayName || handle, handle }
      });

      await Promise.all([
        createDefaultTasteProfile(user.id),
        prisma.notifPreference.create({ data: { userId: user.id } }),
      ]);
    }

    await prisma.user.update({ where: { id: user.id }, data: { lastActiveAt: new Date() } });

    const accessToken  = generateAccessToken(user.id);
    const refreshToken = await generateRefreshToken(user.id);

    respond(res, 200, {
      accessToken, refreshToken,
      user: { id: user.id, email: user.email, displayName: user.displayName, handle: user.handle, avatarUrl: user.avatarUrl },
      isNewUser: !user.createdAt || (Date.now() - user.createdAt.getTime()) < 5000
    });
  } catch (err) { next(err); }
});

// ── LOGOUT ────────────────────────────────────────────────────────────
router.post('/logout', async (req, res, next) => {
  try {
    const { userId } = req.body;
    if (userId) await redis.del(`refresh:${userId}`);
    respond(res, 200, { message: 'Logged out successfully.' });
  } catch (err) { next(err); }
});

module.exports = router;
