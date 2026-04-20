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

// ── VIBE CONFIG ───────────────────────────────────────────────────────────────
// Each vibe defines: a human description, preferred venue categories/tags,
// categories to avoid, and specific instructions for the Claude prompt.
const VIBE_CONFIG = {
  chill: {
    label:       'Chill & low-key',
    description: 'low-energy, intimate, conversation-friendly',
    preferTags:  ['cozy', 'intimate', 'chill', 'low-key', 'quiet', 'neighborhood gem', 'hidden gem'],
    preferCats:  ['Café', 'Wine Bar', 'Cocktail Bar', 'Bookstore', 'Jazz Club'],
    avoidTags:   ['loud', 'club', 'high-energy', 'late night', 'DJ'],
    instructions: [
      'Prioritize venues with good seating, low ambient noise, and a relaxed atmosphere.',
      'Avoid clubs, loud bars, or venues where conversation is difficult.',
      'Good picks: wine bars, cozy cocktail lounges, cafés open late, jazz spots with table seating.',
      'Each plan should feel unhurried — 2 stops max, longer durations at each.',
    ],
  },
  lively: {
    label:       'Lively & social',
    description: 'high energy, music-forward, great crowd',
    preferTags:  ['high-energy', 'late night', 'DJ', 'live music', 'rooftop', 'social', 'trendy'],
    preferCats:  ['Bar', 'Lounge', 'Nightclub', 'Rooftop Bar', 'Music Venue'],
    avoidTags:   ['quiet', 'intimate', 'cozy', 'seated'],
    instructions: [
      'Prioritize bars, lounges, and venues with music and a buzzing crowd.',
      'Include at least one venue with a DJ or live band.',
      'Plans can have 2-3 stops with a natural escalation in energy.',
      'Think: pregame spot → main event → late-night option.',
    ],
  },
  cultural: {
    label:       'Cultural & artsy',
    description: 'arts, culture, live performance, creative spaces',
    preferTags:  ['live music', 'art', 'gallery', 'record shop', 'spoken word', 'indie', 'local', 'creative'],
    preferCats:  ['Music Venue', 'Record Store', 'Art Gallery', 'Theater', 'Jazz Club', 'Café'],
    avoidTags:   ['chain', 'tourist', 'club'],
    instructions: [
      'Lead with a cultural anchor: a record store, gallery opening, live performance, or jazz club.',
      'Mix venue types — e.g. record shop browse → dinner → live show.',
      'Highlight what makes each venue culturally interesting (history, local significance, artists).',
      'Each plan should feel like a curated evening, not just drinks.',
    ],
  },
  foodie: {
    label:       'Foodie night',
    description: 'exceptional food, dining experience, diverse cuisine',
    preferTags:  ['food', 'chef-driven', 'diverse cuisine', 'cocktails', 'wine', 'local', 'brunch'],
    preferCats:  ['Restaurant', 'Food Hall', 'Bar', 'Cocktail Bar', 'Café'],
    avoidTags:   ['club', 'late night', 'DJ'],
    instructions: [
      'Food is the star — every stop should have exceptional food or drinks.',
      'Structure plans around a food journey: drinks & small bites → main dinner → dessert or nightcap.',
      'Vary cuisines across the 3 plans (e.g. one American, one international, one fusion).',
      'Mention cuisine type and any standout dishes or drinks in the plan tagline.',
    ],
  },
  active: {
    label:       'Active & adventurous',
    description: 'unique experiences, walkable, multi-stop, outdoor options',
    preferTags:  ['outdoor', 'rooftop', 'walkable', 'unique', 'experiential', 'hidden gem', 'neighborhood gem'],
    preferCats:  ['Outdoor Venue', 'Rooftop Bar', 'Market', 'Food Hall', 'Music Venue', 'Bar'],
    avoidTags:   ['seated only', 'quiet', 'intimate'],
    instructions: [
      'Plans should involve movement — multiple stops in walkable proximity.',
      'Include at least one outdoor or rooftop venue per plan.',
      'Think: explore a neighborhood on foot, pop into spots along the way.',
      'Each plan should have 3 stops to maximize variety and activity.',
      'One stop per plan should be somewhere unexpected or off the beaten path.',
    ],
  },
  spontaneous: {
    label:       'Surprise me',
    description: 'eclectic mix, one unexpected venue per plan',
    preferTags:  [],
    preferCats:  [],
    avoidTags:   [],
    instructions: [
      'Each plan should be a genuinely surprising, eclectic mix of venue types.',
      'Include at least one unexpected or unusual venue per plan that the group would not normally pick.',
      'Do not repeat the same venue category across all 3 plans.',
      'Think creatively — pair a record store with a wine bar, or a rooftop with a jazz club.',
      'The plans should feel like happy accidents, not a typical night out.',
    ],
  },
};

async function buildPlans({ vibe, groupSize, budget, neighborhood, startTime }) {
  const config   = VIBE_CONFIG[vibe] || VIBE_CONFIG.spontaneous;
  const priceTier = budget <= 25 ? 1 : budget <= 50 ? 2 : budget <= 75 ? 3 : 4;

  // Pull all budget-appropriate spots
  const allSpots = await prisma.spot.findMany({
    where: {
      isActive: true,
      priceTier: { lte: priceTier },
      ...(neighborhood ? { neighborhood: { contains: neighborhood, mode: 'insensitive' } } : {}),
    },
    take: 60,
  });

  // Score each spot against the vibe: +2 per matching tag, +1 per matching category
  function scoreSpot(spot) {
    let score = 0;
    const tags = spot.vibeTags || [];
    const cat  = spot.category  || '';
    for (const t of config.preferTags) {
      if (tags.some(tag => tag.toLowerCase().includes(t.toLowerCase()))) score += 2;
    }
    if (config.preferCats.some(c => cat.toLowerCase().includes(c.toLowerCase()))) score += 1;
    for (const t of config.avoidTags) {
      if (tags.some(tag => tag.toLowerCase().includes(t.toLowerCase()))) score -= 3;
    }
    return score;
  }

  const scored = allSpots
    .map(s => ({ spot: s, score: scoreSpot(s) }))
    .sort((a, b) => b.score - a.score);

  // Top 20 preferred spots + up to 10 others for variety (spontaneous gets full shuffle)
  let preferred = scored.slice(0, 20).map(x => x.spot);
  let others    = scored.slice(20).map(x => x.spot).slice(0, 10);
  const spots   = vibe === 'spontaneous'
    ? allSpots.sort(() => Math.random() - 0.5)
    : [...preferred, ...others];

  const spotList = spots.length
    ? spots.map(s =>
        `- ${s.name} | ${s.category} | ${s.neighborhood} | ${'$'.repeat(s.priceTier)} | Tags: ${(s.vibeTags || []).join(', ')}`
      ).join('\n')
    : '(no venues in database — invent 2–3 real DC venues per plan)';

  const prompt = `You are a local DC expert curating evening plans. Generate 3 distinct plans for a group night out.

GROUP DETAILS
- Vibe: ${config.label} — ${config.description}
- Group size: ${groupSize} people
- Budget: up to $${budget} per person
- Neighborhood preference: ${neighborhood || 'anywhere in DC'}
- Starting time: ${startTime}

VIBE INSTRUCTIONS
${config.instructions.map((line, i) => `${i + 1}. ${line}`).join('\n')}

AVAILABLE VENUES (use only venues from this list):
${spotList}

OUTPUT FORMAT
Return a JSON array of exactly 3 plan objects. No markdown, no explanation — only the raw JSON array.
[
  {
    "title": "Short catchy plan name (3-5 words)",
    "tagline": "One compelling sentence describing the vibe of this plan",
    "stops": [
      {
        "name": "Exact venue name from the list above",
        "category": "Venue category",
        "neighborhood": "Neighborhood",
        "duration": "e.g. 60 min"
      }
    ]
  }
]

Rules:
- Each plan must have 2-3 stops chosen from the venue list above.
- Plans must be meaningfully different from each other.
- Only use venues from the list. Do not invent venues.
- Return ONLY the JSON array.`;

  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  let text = msg.content[0].text.trim();
  // Strip markdown code fences if present
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  // Find the JSON array
  const start = text.indexOf('[');
  const end   = text.lastIndexOf(']');
  if (start === -1 || end === -1) throw new Error('No JSON array in response');
  return JSON.parse(text.slice(start, end + 1));
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
