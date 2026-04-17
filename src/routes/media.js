// src/routes/media.js
// Photo upload endpoint — handles profile photos and Memory post images
const express  = require('express');
const multer   = require('multer');
const sharp    = require('sharp');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { v4: uuidv4 }   = require('uuid');
const { authMiddleware } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();
router.use(authMiddleware);

// ── S3 CLIENT ─────────────────────────────────────────────────────────
const s3 = new S3Client({
  region:      process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});
const BUCKET = process.env.AWS_S3_BUCKET || 'rendezvous-media';

// ── MULTER CONFIG (memory storage — no disk writes) ───────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg','image/png','image/webp','image/heic'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only JPEG, PNG, WebP, and HEIC images are accepted.'));
  },
});

// ── IMAGE RESIZE PROFILES ─────────────────────────────────────────────
const PROFILES = {
  avatar:  { width: 400,  height: 400,  quality: 85, fit: 'cover' },
  memory:  { width: 1080, height: 1080, quality: 88, fit: 'inside' },
  hero:    { width: 1200, height: 900,  quality: 85, fit: 'cover'  },
};

async function resizeImage(buffer, profile) {
  const p = PROFILES[profile] || PROFILES.memory;
  return sharp(buffer)
    .resize(p.width, p.height, { fit: p.fit, withoutEnlargement: true })
    .jpeg({ quality: p.quality, progressive: true })
    .toBuffer();
}

async function uploadToS3(buffer, key, contentType = 'image/jpeg') {
  await s3.send(new PutObjectCommand({
    Bucket:      BUCKET,
    Key:         key,
    Body:        buffer,
    ContentType: contentType,
    CacheControl:'max-age=31536000',
  }));
  return key;
}

// ── SIGNED URL GENERATOR (used by all routes returning photo URLs) ────
async function signUrl(key, expiresInSeconds = 3600) {
  if (!key) return null;
  // If already a full URL (legacy or CDN), return as-is
  if (key.startsWith('http')) return key;
  const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  return getSignedUrl(s3, cmd, { expiresIn: expiresInSeconds });
}

// ── SIGN URLS IN A SPOT/MEMORY OBJECT ────────────────────────────────
async function signSpotPhotos(spot) {
  if (!spot) return spot;
  const out = { ...spot };
  if (out.heroPhotoUrl) out.heroPhotoUrl = await signUrl(out.heroPhotoUrl);
  if (out.photos) {
    out.photos = await Promise.all(out.photos.map(async p => ({
      ...p, url: await signUrl(p.url)
    })));
  }
  return out;
}

async function signMemoryPhoto(memory) {
  if (!memory) return memory;
  const out = { ...memory };
  if (out.photoUrl) out.photoUrl = await signUrl(out.photoUrl);
  return out;
}

// ── UPLOAD ROUTES ─────────────────────────────────────────────────────

// POST /api/v1/media/avatar — upload profile photo
router.post('/avatar', upload.single('photo'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: { code: 'NO_FILE', message: 'No file uploaded.' } });

    const resized = await resizeImage(req.file.buffer, 'avatar');
    const key     = `avatars/${req.user.id}/${uuidv4()}.jpg`;
    await uploadToS3(resized, key);

    const { prisma } = require('../services/db');
    await prisma.user.update({ where: { id: req.user.id }, data: { avatarUrl: key } });

    const signedUrl = await signUrl(key);
    res.json({ success: true, data: { url: signedUrl, key } });
  } catch (err) { next(err); }
});

// POST /api/v1/media/memory — upload memory post photo
router.post('/memory', upload.single('photo'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: { code: 'NO_FILE', message: 'No file uploaded.' } });

    const resized = await resizeImage(req.file.buffer, 'memory');
    const key     = `memories/${req.user.id}/${uuidv4()}.jpg`;
    await uploadToS3(resized, key);

    const signedUrl = await signUrl(key);
    res.json({ success: true, data: { url: signedUrl, key } });
  } catch (err) { next(err); }
});

// GET /api/v1/media/sign?key=avatars/... — get a fresh signed URL for any key
router.get('/sign', async (req, res, next) => {
  try {
    const { key } = req.query;
    if (!key) return res.status(400).json({ success: false, error: { code: 'MISSING_KEY', message: 'key param required.' } });

    // Validate key belongs to requesting user (security check)
    if (!key.startsWith(`avatars/${req.user.id}/`) &&
        !key.startsWith(`memories/${req.user.id}/`) &&
        !key.startsWith('spots/') &&
        !key.startsWith('events/')) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Cannot sign this resource.' } });
    }

    const url = await signUrl(key, 7200); // 2 hours
    res.json({ success: true, data: { url, expiresIn: 7200 } });
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.signUrl       = signUrl;
module.exports.signSpotPhotos = signSpotPhotos;
module.exports.signMemoryPhoto = signMemoryPhoto;
