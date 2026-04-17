// src/routes/integrations.js
const express = require('express');
const { prisma } = require('../services/db');
const { authMiddleware } = require('../middleware/auth');
const spotifyService = require('../services/spotify');

const router = express.Router();
router.use(authMiddleware);

// GET /integrations/spotify/auth
router.get('/spotify/auth', (req, res) => {
  const url = spotifyService.getAuthUrl(req.user.id);
  res.json({ success: true, data: { url } });
});

// POST /integrations/spotify/callback
router.post('/spotify/callback', async (req, res, next) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ success: false, error: { code: 'MISSING_CODE', message: 'Authorization code required.' } });
    const result = await spotifyService.connectAndSync(req.user.id, code);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

// GET /integrations/status
router.get('/status', async (req, res, next) => {
  try {
    const connections = await prisma.appConnection.findMany({
      where: { userId: req.user.id },
      select: { provider: true, lastSyncedAt: true, scopes: true }
    });
    res.json({ success: true, data: { connections } });
  } catch (err) { next(err); }
});

// DELETE /integrations/:provider
router.delete('/:provider', async (req, res, next) => {
  try {
    const { provider } = req.params;
    await prisma.appConnection.deleteMany({ where: { userId: req.user.id, provider } });

    const signalField = `${provider}Signals`;
    await prisma.tasteProfile.update({
      where: { userId: req.user.id },
      data: { [signalField]: null }
    }).catch(() => {});

    res.json({ success: true, data: { disconnected: provider } });
  } catch (err) { next(err); }
});

module.exports = router;
