// src/routes/guestPlan.js — Guest plan generation (no auth required)
const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const Anthropic = require('@anthropic-ai/sdk');

const prisma = new PrismaClient();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// In-memory store for guest plans (no DB required)
const guestPlans = new Map();

function planId() {
  return Math.random().toString(36).slice(2, 10).toUpperCase();
}

async function buildPlans({ vibe, groupSize, budget, neighborhood, startTime }) {
  // Fetch spots from DB filtered by budget
  const priceTier = budget <= 25 ? 1 : budget <= 50 ? 2 : budget <= 75 ? 3 : 4;
  const spots = await prisma.spot.findMany({
    where: {
      isActive: true,
      priceTier: { lte: priceTier },
      ...(neighborhood ? { neighborhood: { contains: neighborhood, mode: 'insensitive' } } : {}),
    },
    take: 40,
  });

  const vibeMap = {
    chill:       'low-energy, intimate, great for conversation',
    lively:      'high energy, social, music-forward',
    cultural:    'arts, culture, galleries, live performance',
    foodie:      'exceptional food, unique cuisine, dining experience',
    active:      'active, adventurous, experiential',
    spontaneous: 'eclectic mix, surprising, fun variety',
  };

  const prompt = `You are a DC nightlife expert. Generate 3 distinct evening plan options for a group.

Group details:
- Vibe: ${vibeMap[vibe] || vibe}
- Group size: ${groupSize} people
- Budget: $${budget} per person max
- Neighborhood preference: ${neighborhood || 'anywhere in DC'}
- Starting time: ${startTime}

Available venues (use only these):
${spots.map(s => `- ${s.name} | ${s.category} | ${s.neighborhood} | Price tier ${s.priceTier}/4 | Tags: ${s.vibeTags?.join(', ')}`).join('\n')}

Return a JSON array of exactly 3 plan objects. Each plan:
{
  "title": "Short catchy name",
  "tagline": "One-line description",
  "stops": [
    { "name": "Venue name", "category": "Category", "neighborhood": "Neighborhood", "duration": "90 min" }
  ]
}

Each plan should have 2-3 stops. Plans should be meaningfully different from each other.
Return ONLY the JSON array, no other text.`;

  const msg = await anthropic.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = msg.content[0].text.trim();
  const json = text.startsWith('[') ? text : text.slice(text.indexOf('['));
  return JSON.parse(json);
}

// POST /api/v1/guest/plan
router.post('/plan', async (req, res) => {
  try {
    const { vibe, groupSize, budget, neighborhood, startTime } = req.body;
    if (!vibe || !groupSize || !budget) {
      return res.status(400).json({ success: false, error: { message: 'Missing required fields.' } });
    }

    const plans = await buildPlans({ vibe, groupSize, budget, neighborhood, startTime });
    const id = planId();
    guestPlans.set(id, { plans, inputs: req.body, createdAt: Date.now() });

    res.json({ success: true, planId: id, plans });
  } catch (err) {
    console.error('Guest plan error:', err);
    res.status(500).json({ success: false, error: { message: 'Could not generate plans.' } });
  }
});

// POST /api/v1/guest/plan/:id/reshuffle
router.post('/plan/:id/reshuffle', async (req, res) => {
  try {
    const entry = guestPlans.get(req.params.id);
    if (!entry) return res.status(404).json({ success: false, error: { message: 'Plan not found.' } });

    const plans = await buildPlans(entry.inputs);
    entry.plans = plans;
    guestPlans.set(req.params.id, entry);

    res.json({ success: true, planId: req.params.id, plans });
  } catch (err) {
    console.error('Reshuffle error:', err);
    res.status(500).json({ success: false, error: { message: 'Could not reshuffle.' } });
  }
});

// GET /api/v1/guest/plan/:id
router.get('/plan/:id', (req, res) => {
  const entry = guestPlans.get(req.params.id);
  if (!entry) return res.status(404).json({ success: false, error: { message: 'Plan not found.' } });
  res.json({ success: true, planId: req.params.id, plans: entry.plans });
});

module.exports = router;
