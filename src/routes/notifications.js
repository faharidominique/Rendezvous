// src/routes/notifications.js
const express = require('express');
const { prisma } = require('../services/db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// GET /notifications/preferences
router.get('/preferences', async (req, res, next) => {
  try {
    const prefs = await prisma.notifPreference.findUnique({ where: { userId: req.user.id } });
    res.json({ success: true, data: { preferences: prefs } });
  } catch (err) { next(err); }
});

// PATCH /notifications/preferences
router.patch('/preferences', async (req, res, next) => {
  try {
    const prefs = await prisma.notifPreference.update({
      where: { userId: req.user.id },
      data: req.body,
    });
    res.json({ success: true, data: { preferences: prefs } });
  } catch (err) { next(err); }
});

// POST /notifications/register
router.post('/register', async (req, res, next) => {
  try {
    const { token, deviceId, platform } = req.body;
    if (!token || !deviceId || !platform) {
      return res.status(400).json({ success: false, error: { code: 'MISSING_FIELDS', message: 'token, deviceId, platform required.' } });
    }

    await prisma.pushToken.upsert({
      where: { userId_deviceId: { userId: req.user.id, deviceId } },
      update: { token, platform },
      create: { userId: req.user.id, deviceId, platform, token },
    });

    res.json({ success: true, data: { registered: true } });
  } catch (err) { next(err); }
});

// DELETE /notifications/register/:deviceId
router.delete('/register/:deviceId', async (req, res, next) => {
  try {
    await prisma.pushToken.deleteMany({
      where: { userId: req.user.id, deviceId: req.params.deviceId }
    });
    res.json({ success: true, data: { unregistered: true } });
  } catch (err) { next(err); }
});

module.exports = router;
