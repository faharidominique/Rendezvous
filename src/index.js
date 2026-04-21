// Rendezvous v2 — API Server Entry Point
console.log('index.js loaded, PORT:', process.env.PORT);
require('dotenv').config();
const express    = require('express');
const http       = require('http');
const path       = require('path');
const cors       = require('cors');
const helmet     = require('helmet');
const compression = require('compression');
const morgan     = require('morgan');
const rateLimit  = require('express-rate-limit');

const { initSocket }        = require('./websocket/socket');
const { connectRedis, redis } = require('./services/redis');
const { prisma }              = require('./services/db');
const logger                  = require('./utils/logger');

// Routes
const authRoutes        = require('./routes/auth');
const authExtraRoutes   = require('./routes/authExtra');
const userRoutes        = require('./routes/users');
const partyRoutes       = require('./routes/parties');
const spotRoutes        = require('./routes/spots');
const shelfRoutes       = require('./routes/shelf');
const memoryRoutes      = require('./routes/memories');
const friendshipRoutes  = require('./routes/friendships');
const integrationRoutes = require('./routes/integrations');
const notifRoutes       = require('./routes/notifications');
const analyticsRoutes   = require('./routes/analytics');
const mediaRoutes       = require('./routes/media');
const gdprRoutes        = require('./routes/gdpr');
const adminRoutes       = require('./routes/admin');
const guestPlanRoutes   = require('./routes/guestPlan');

const app    = express();
const server = http.createServer(app);

// ── MIDDLEWARE ────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.socket.io"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'", "ws:", "wss:"],
    }
  }
}));
app.use(compression());
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('combined', { stream: { write: msg => logger.info(msg.trim()) } }));

// Serve static files (landing page, admin dashboard)
app.use(express.static(path.join(__dirname, '../public')));

// Global API rate limiter
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { code: 'RATE_LIMIT', message: 'Too many requests, slow down.' } }
});
app.use('/api/', limiter);

// Stricter limiter for auth routes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, error: { code: 'AUTH_RATE_LIMIT', message: 'Too many auth attempts. Try again in 15 minutes.' } }
});
app.use('/api/v1/auth', authLimiter);

// ── API ROUTES ────────────────────────────────────────────────────────
app.use('/api/v1/auth',          authRoutes);
app.use('/api/v1/auth',          authExtraRoutes);
app.use('/api/v1/users',         userRoutes);
app.use('/api/v1/users',         gdprRoutes);
app.use('/api/v1/parties',       partyRoutes);
app.use('/api/v1/spots',         spotRoutes);
app.use('/api/v1/shelf',         shelfRoutes);
app.use('/api/v1/memories',      memoryRoutes);
app.use('/api/v1/friendships',   friendshipRoutes);
app.use('/api/v1/integrations',  integrationRoutes);
app.use('/api/v1/notifications', notifRoutes);
app.use('/api/v1/analytics',     analyticsRoutes);
app.use('/api/v1/media',         mediaRoutes);
app.use('/admin',                adminRoutes);
app.use('/api/v1/guest',         guestPlanRoutes);

// ── HEALTH CHECK ─────────────────────────────────────────────────────
app.get('/health', async (req, res) => {
  const result = {
    status:    'ok',
    version:   '2.0.0',
    timestamp: new Date().toISOString(),
    env:       process.env.NODE_ENV || 'development',
    db:        'disconnected',
    redis:     'disconnected',
  };

  try {
    await prisma.$queryRaw`SELECT 1`;
    result.db = 'connected';
  } catch (e) {
    result.db     = 'error';
    result.status = 'degraded';
  }

  try {
    await redis.ping();
    result.redis = 'connected';
  } catch (e) {
    result.redis  = 'error';
    result.status = result.status === 'degraded' ? 'degraded' : 'degraded';
  }

  res.status(result.status === 'ok' ? 200 : 503).json(result);
});

// ── TEMP DEBUG: verify ADMIN_SECRET value on Railway ─────────────────
app.get('/admin-check', (req, res) => {
  const s = process.env.ADMIN_SECRET;
  res.json({
    set: !!s,
    length: s?.length ?? 0,
    prefix: s ? s.slice(0, 3) : null,
  });
});

// ── FALLBACK: serve landing page for non-API routes ───────────────────
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api') && !req.path.startsWith('/admin')) {
    res.sendFile(path.join(__dirname, '../public/index.html'));
  } else {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Route not found.' } });
  }
});

// ── ERROR HANDLER ─────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  logger.error(err.stack);
  const status = err.status || 500;
  res.status(status).json({
    success: false,
    error: {
      code: err.code || 'INTERNAL_ERROR',
      message: process.env.NODE_ENV === 'production' ? 'Something went wrong.' : err.message,
      field: err.field || null,
    }
  });
});

// ── WEBSOCKET ─────────────────────────────────────────────────────────
initSocket(server);

// ── START ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

async function start() {
  console.log(`Starting Rendezvous v2 on port ${PORT}...`);
  try {
    await connectRedis();
    console.log('Redis connected.');
  } catch (err) {
    console.error('Redis connection failed, continuing without it:', err.message);
  }
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Rendezvous v2 running on port ${PORT} [${process.env.NODE_ENV}]`);
  });
  server.on('error', (err) => {
    console.error('Server error:', err.message);
    process.exit(1);
  });
}

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err.message, err.stack);
  process.exit(1);
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
  process.exit(1);
});

start();
module.exports = app;
