// Rendezvous — Event Routes (unauthenticated host flow)
const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { prisma } = require('../services/db');

const router = express.Router();

const BASE_URL = 'https://rendezvous-production-408e.up.railway.app';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateCode(length = 6) {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

async function generateUniqueCode() {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = generateCode();
    const existing = await prisma.event.findUnique({ where: { code } });
    if (!existing) return code;
  }
  throw new Error('Could not generate unique code');
}

function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ success: false, error: { code: 'VALIDATION', message: errors.array()[0].msg } });
    return false;
  }
  return true;
}

// POST /api/v1/events — create a new event
router.post('/',
  [
    body('hostName').isString().trim().isLength({ min: 1, max: 100 }).withMessage('Host name is required'),
    body('eventName').isString().trim().isLength({ min: 1, max: 200 }).withMessage('Event name is required'),
    body('groupSize').isInt({ min: 2, max: 10 }).withMessage('Group size must be 2–10'),
    body('date').isISO8601().withMessage('Valid date required'),
    body('timeStart').isString().trim().notEmpty().withMessage('Start time required'),
    body('timeEnd').isString().trim().notEmpty().withMessage('End time required'),
    body('neighborhood').isString().trim().notEmpty().withMessage('Neighborhood required'),
    body('vibe').isString().trim().notEmpty().withMessage('Vibe required'),
  ],
  async (req, res, next) => {
    try {
      if (!validate(req, res)) return;

      const { hostName, eventName, groupSize, date, timeStart, timeEnd, neighborhood, vibe } = req.body;

      const code = await generateUniqueCode();

      const event = await prisma.event.create({
        data: {
          hostName,
          eventName,
          groupSize: parseInt(groupSize),
          date: new Date(date),
          timeStart,
          timeEnd,
          neighborhood,
          vibe,
          code,
        },
      });

      res.status(201).json({
        success: true,
        data: {
          code: event.code,
          eventId: event.id,
          joinUrl: `${BASE_URL}/join/${event.code}`,
        },
      });
    } catch (err) { next(err); }
  }
);

// GET /api/v1/events/:code — fetch event by join code
router.get('/:code',
  [param('code').isString().trim().toUpperCase().isLength({ min: 4, max: 10 })],
  async (req, res, next) => {
    try {
      if (!validate(req, res)) return;

      const event = await prisma.event.findUnique({
        where: { code: req.params.code.toUpperCase() },
        include: { guests: true },
      });

      if (!event) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Event not found.' } });
      }

      res.json({ success: true, data: { event } });
    } catch (err) { next(err); }
  }
);

module.exports = router;
