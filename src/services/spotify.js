// Rendezvous — Spotify Integration Service
const axios = require('axios');
const { prisma } = require('../services/db');
const { encryptToken, decryptToken } = require('../utils/crypto');
const { buildTasteVector, applySpotifySignals } = require('../algorithms/tasteVector');
const logger = require('../utils/logger');

const SPOTIFY_AUTH_URL  = 'https://accounts.spotify.com/authorize';
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
const SPOTIFY_API_URL   = 'https://api.spotify.com/v1';
const SCOPES = ['user-top-read', 'user-read-recently-played'].join(' ');

// ── OAUTH URL ─────────────────────────────────────────────────────────
function getAuthUrl(userId) {
  const params = new URLSearchParams({
    client_id:     process.env.SPOTIFY_CLIENT_ID,
    response_type: 'code',
    redirect_uri:  process.env.SPOTIFY_REDIRECT_URI,
    scope:         SCOPES,
    state:         userId, // We use userId as state for verification
  });
  return `${SPOTIFY_AUTH_URL}?${params}`;
}

// ── EXCHANGE CODE FOR TOKENS ──────────────────────────────────────────
async function exchangeCode(code) {
  const response = await axios.post(SPOTIFY_TOKEN_URL,
    new URLSearchParams({
      grant_type:   'authorization_code',
      code,
      redirect_uri: process.env.SPOTIFY_REDIRECT_URI,
    }),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(
          `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
        ).toString('base64'),
      }
    }
  );
  return response.data;
}

// ── REFRESH ACCESS TOKEN ──────────────────────────────────────────────
async function refreshAccessToken(userId) {
  const connection = await prisma.appConnection.findFirst({
    where: { userId, provider: 'spotify' }
  });
  if (!connection?.refreshToken) throw new Error('No Spotify refresh token found.');

  const refreshToken = decryptToken(connection.refreshToken);
  const response = await axios.post(SPOTIFY_TOKEN_URL,
    new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: refreshToken,
    }),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(
          `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
        ).toString('base64'),
      }
    }
  );

  const newToken = response.data.access_token;
  await prisma.appConnection.update({
    where: { id: connection.id },
    data: {
      accessToken: encryptToken(newToken),
      expiresAt: new Date(Date.now() + response.data.expires_in * 1000),
    }
  });
  return newToken;
}

// ── GET VALID ACCESS TOKEN ────────────────────────────────────────────
async function getAccessToken(userId) {
  const connection = await prisma.appConnection.findFirst({
    where: { userId, provider: 'spotify' }
  });
  if (!connection) throw new Error('Spotify not connected.');

  // Check if expired
  if (connection.expiresAt && new Date() > connection.expiresAt) {
    return refreshAccessToken(userId);
  }
  return decryptToken(connection.accessToken);
}

// ── EXTRACT SIGNALS ───────────────────────────────────────────────────
async function extractSignals(userId) {
  const accessToken = await getAccessToken(userId);
  const headers = { Authorization: `Bearer ${accessToken}` };

  try {
    const [topTracksRes, topArtistsRes, recentlyPlayedRes] = await Promise.allSettled([
      axios.get(`${SPOTIFY_API_URL}/me/top/tracks?limit=50&time_range=short_term`, { headers }),
      axios.get(`${SPOTIFY_API_URL}/me/top/artists?limit=20&time_range=short_term`, { headers }),
      axios.get(`${SPOTIFY_API_URL}/me/player/recently-played?limit=50`, { headers }),
    ]);

    const signals = {};

    // Audio features from top tracks
    if (topTracksRes.status === 'fulfilled' && topTracksRes.value.data.items.length > 0) {
      const tracks = topTracksRes.value.data.items;
      const trackIds = tracks.map(t => t.id).slice(0, 100).join(',');

      try {
        const featuresRes = await axios.get(
          `${SPOTIFY_API_URL}/audio-features?ids=${trackIds}`,
          { headers }
        );
        const features = featuresRes.data.audio_features.filter(Boolean);

        if (features.length > 0) {
          signals.avgEnergy       = features.reduce((s, f) => s + f.energy, 0) / features.length;
          signals.avgValence      = features.reduce((s, f) => s + f.valence, 0) / features.length;
          signals.avgDanceability = features.reduce((s, f) => s + f.danceability, 0) / features.length;
          signals.avgAcousticness = features.reduce((s, f) => s + f.acousticness, 0) / features.length;
          signals.avgTempo        = features.reduce((s, f) => s + f.tempo, 0) / features.length;
        }
      } catch (err) {
        logger.warn(`Spotify audio features fetch failed for user ${userId}:`, err.message);
      }
    }

    // Top genres from artists
    if (topArtistsRes.status === 'fulfilled') {
      const artists = topArtistsRes.value.data.items;
      const genreCounts = {};
      artists.forEach(artist => {
        artist.genres.forEach(genre => {
          genreCounts[genre] = (genreCounts[genre] || 0) + 1;
        });
      });
      signals.topGenres = Object.entries(genreCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([genre]) => genre);
    }

    // Listening time of day from recently played
    if (recentlyPlayedRes.status === 'fulfilled') {
      const items = recentlyPlayedRes.value.data.items;
      const hours = items.map(item => new Date(item.played_at).getHours());
      const hourCounts = new Array(24).fill(0);
      hours.forEach(h => hourCounts[h]++);
      signals.peakHour = hourCounts.indexOf(Math.max(...hourCounts));
    }

    return signals;
  } catch (err) {
    logger.error(`Spotify signal extraction failed for user ${userId}:`, err.message);
    throw err;
  }
}

// ── CONNECT AND SYNC ──────────────────────────────────────────────────
async function connectAndSync(userId, code) {
  const tokenData = await exchangeCode(code);

  // Save connection
  await prisma.appConnection.upsert({
    where: { userId_provider: { userId, provider: 'spotify' } },
    update: {
      accessToken:  encryptToken(tokenData.access_token),
      refreshToken: tokenData.refresh_token ? encryptToken(tokenData.refresh_token) : undefined,
      scopes:       SCOPES.split(' '),
      expiresAt:    new Date(Date.now() + tokenData.expires_in * 1000),
      lastSyncedAt: new Date(),
    },
    create: {
      userId,
      provider:     'spotify',
      accessToken:  encryptToken(tokenData.access_token),
      refreshToken: tokenData.refresh_token ? encryptToken(tokenData.refresh_token) : null,
      scopes:       SCOPES.split(' '),
      expiresAt:    new Date(Date.now() + tokenData.expires_in * 1000),
      lastSyncedAt: new Date(),
    }
  });

  // Extract signals
  const signals = await extractSignals(userId);

  // Update taste profile with Spotify signals
  const profile = await prisma.tasteProfile.findUnique({ where: { userId } });
  if (profile) {
    const currentVector = {
      energyLevel:       profile.energyLevel,
      socialOpenness:    profile.socialOpenness,
      spontaneity:       profile.spontaneity,
      culturalAppetite:  profile.culturalAppetite,
      foodPriority:      profile.foodPriority,
      outdoorPreference: profile.outdoorPreference,
      budgetSensitivity: profile.budgetSensitivity,
      nightOwlScore:     profile.nightOwlScore,
      activityDiversity: profile.activityDiversity,
    };

    const updated = applySpotifySignals(currentVector, signals);

    await prisma.tasteProfile.update({
      where: { userId },
      data: {
        ...updated,
        spotifySignals: signals,
        signalConfidence: Math.min(1.0, profile.signalConfidence + 0.2),
      }
    });
  }

  logger.info(`Spotify connected and synced for user ${userId}`);
  return { connected: true, signals };
}

// ── WEEKLY SYNC JOB ───────────────────────────────────────────────────
async function syncAllUsers() {
  const connections = await prisma.appConnection.findMany({
    where: { provider: 'spotify' },
    select: { userId: true }
  });

  logger.info(`Syncing Spotify for ${connections.length} users`);

  for (const { userId } of connections) {
    try {
      const signals = await extractSignals(userId);
      const profile = await prisma.tasteProfile.findUnique({ where: { userId } });
      if (profile) {
        const currentVector = {
          energyLevel: profile.energyLevel,
          socialOpenness: profile.socialOpenness,
          spontaneity: profile.spontaneity,
          culturalAppetite: profile.culturalAppetite,
          foodPriority: profile.foodPriority,
          outdoorPreference: profile.outdoorPreference,
          budgetSensitivity: profile.budgetSensitivity,
          nightOwlScore: profile.nightOwlScore,
          activityDiversity: profile.activityDiversity,
        };
        const updated = applySpotifySignals(currentVector, signals);
        await prisma.tasteProfile.update({
          where: { userId },
          data: { ...updated, spotifySignals: signals, lastSyncedAt: new Date() }
        });
      }
      await prisma.appConnection.updateMany({
        where: { userId, provider: 'spotify' },
        data: { lastSyncedAt: new Date() }
      });
    } catch (err) {
      logger.warn(`Spotify sync failed for user ${userId}:`, err.message);
    }
  }
}

module.exports = { getAuthUrl, exchangeCode, connectAndSync, extractSignals, syncAllUsers };
