// Rendezvous — WebSocket Server (Socket.io)
// Handles real-time Party session events

const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { prisma } = require('../services/db');
const logger = require('../utils/logger');

let io;

function initSocket(server) {
  io = new Server(server, {
    cors: {
      origin: process.env.FRONTEND_URL || '*',
      methods: ['GET', 'POST'],
      credentials: true,
    }
  });

  // ── AUTH MIDDLEWARE ──────────────────────────────────────────────────
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.split(' ')[1];
      if (!token) return next(new Error('Authentication required'));

      const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
      const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
        select: { id: true, displayName: true, handle: true, avatarUrl: true }
      });
      if (!user) return next(new Error('User not found'));

      socket.user = user;
      next();
    } catch (err) {
      next(new Error('Invalid token'));
    }
  });

  // ── CONNECTION ───────────────────────────────────────────────────────
  io.on('connection', (socket) => {
    logger.info(`Socket connected: ${socket.user.handle} (${socket.id})`);

    // ── JOIN PARTY ROOM ────────────────────────────────────────────────
    socket.on('party:join', async ({ partyId }) => {
      try {
        const member = await prisma.partyMember.findFirst({
          where: { partyId, userId: socket.user.id }
        });
        if (!member) {
          socket.emit('error', { code: 'NOT_MEMBER', message: 'You are not in this party.' });
          return;
        }

        socket.join(`party:${partyId}`);
        socket.partyId = partyId;

        // Mark as connected
        await prisma.partyMember.update({
          where: { id: member.id },
          data: { isConnected: true }
        });

        // Notify room
        socket.to(`party:${partyId}`).emit('party:member_connected', {
          userId: socket.user.id,
          displayName: socket.user.displayName,
        });

        // Send current party state to the newly connected member
        const party = await prisma.party.findUnique({
          where: { id: partyId },
          include: {
            members: {
              include: { user: { select: { id: true, displayName: true, handle: true, avatarUrl: true } } }
            },
            votes: true,
          }
        });

        socket.emit('party:state', { party });
        logger.info(`${socket.user.handle} joined party room: ${partyId}`);
      } catch (err) {
        logger.error('party:join error', err);
        socket.emit('error', { code: 'JOIN_FAILED', message: err.message });
      }
    });

    // ── LEAVE PARTY ROOM ───────────────────────────────────────────────
    socket.on('party:leave', async ({ partyId }) => {
      socket.leave(`party:${partyId}`);
      await markDisconnected(socket.user.id, partyId);
      socket.to(`party:${partyId}`).emit('party:member_left', { userId: socket.user.id });
      logger.info(`${socket.user.handle} left party room: ${partyId}`);
    });

    // ── TYPING INDICATOR (for future chat feature) ─────────────────────
    socket.on('party:typing', ({ partyId }) => {
      socket.to(`party:${partyId}`).emit('party:typing', { userId: socket.user.id });
    });

    // ── DISCONNECT ─────────────────────────────────────────────────────
    socket.on('disconnect', async () => {
      if (socket.partyId) {
        await markDisconnected(socket.user.id, socket.partyId);
        socket.to(`party:${socket.partyId}`).emit('party:member_left', { userId: socket.user.id });
      }
      logger.info(`Socket disconnected: ${socket.user.handle} (${socket.id})`);
    });
  });

  logger.info('WebSocket server initialised');
  return io;
}

async function markDisconnected(userId, partyId) {
  try {
    await prisma.partyMember.updateMany({
      where: { userId, partyId },
      data: { isConnected: false }
    });
  } catch (err) {
    logger.warn('markDisconnected error:', err.message);
  }
}

function getIO() {
  if (!io) throw new Error('Socket.io not initialised');
  return io;
}

// ── PARTY EVENT EMITTERS (called from routes) ─────────────────────────
const PartyEvents = {
  memberJoined:     (partyId, data) => io?.to(`party:${partyId}`).emit('party:member_joined', data),
  checkinUpdated:   (partyId, data) => io?.to(`party:${partyId}`).emit('party:checkin_updated', data),
  generationStarted:(partyId, data) => io?.to(`party:${partyId}`).emit('party:generation_started', data),
  plansReady:       (partyId, data) => io?.to(`party:${partyId}`).emit('party:plans_ready', data),
  voteCast:         (partyId, data) => io?.to(`party:${partyId}`).emit('party:vote_cast', data),
  planConfirmed:    (partyId, data) => io?.to(`party:${partyId}`).emit('party:plan_confirmed', data),
  memberLeft:       (partyId, data) => io?.to(`party:${partyId}`).emit('party:member_left', data),
};

module.exports = { initSocket, getIO, PartyEvents };
