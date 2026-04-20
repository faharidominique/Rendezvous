// src/routes/guestPlan.js — Guest plan generation (no auth required)
const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const Anthropic = require('@anthropic-ai/sdk');

const prisma = new PrismaClient();

// Lazy Anthropic client — only instantiated when the key is present
let _anthropic = null;
function getAnthropic() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!_anthropic) _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _anthropic;
}

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

// ── FALLBACK PLAN BUILDER ─────────────────────────────────────────────────────
// Used when ANTHROPIC_API_KEY is not set. Assembles 3 plans from scored DB spots.
const FALLBACK_TEMPLATES = {
  chill: [
    { title: 'Easy Like Sunday',      tagline: 'Low lights, good drinks, and nowhere to be.' },
    { title: 'The Slow Burn',         tagline: 'Start quiet, stay that way — exactly as planned.' },
    { title: 'Just the Two-Stop',     tagline: 'Two great spots, zero pressure, all night.' },
  ],
  lively: [
    { title: 'Turn It Up',            tagline: 'Energy first, questions later.' },
    { title: 'The Social Circuit',    tagline: 'Bar to bar, crowd to crowd — the night finds you.' },
    { title: 'Friday Mode',           tagline: 'Music, people, and the right amount of chaos.' },
  ],
  cultural: [
    { title: 'The Culture Run',       tagline: 'Art, sound, and something you didn\'t expect.' },
    { title: 'Record to Table',       tagline: 'Browse vinyl, then settle in for the night.' },
    { title: 'After the Opening',     tagline: 'Galleries close, the night opens up.' },
  ],
  foodie: [
    { title: 'The Tasting Route',     tagline: 'Every stop earns its place on the table.' },
    { title: 'Bites & Rounds',        tagline: 'Snacks into dinner into something sweet.' },
    { title: 'Chef\'s Night Out',     tagline: 'Let the kitchen do the talking.' },
  ],
  active: [
    { title: 'The Neighborhood Run',  tagline: 'On foot, no plan — just good instincts.' },
    { title: 'Three & Done',          tagline: 'Three stops, three different feels, one great night.' },
    { title: 'Off the Map',           tagline: 'You\'ve walked past these places. Tonight you go in.' },
  ],
  spontaneous: [
    { title: 'Whatever Works',        tagline: 'No theme, no rules — just what sounds good right now.' },
    { title: 'The Wildcard Night',    tagline: 'Trust the process. The process is chaos.' },
    { title: 'Pick Three, See What Happens', tagline: 'The best nights are the ones nobody planned.' },
  ],
};

const STOP_DURATIONS = ['60 min', '75 min', '90 min', '2 hrs'];

function buildFallbackPlans(spots, vibe) {
  const templates = FALLBACK_TEMPLATES[vibe] || FALLBACK_TEMPLATES.spontaneous;

  // Divide the top spots into 3 non-overlapping groups of 2-3
  // Group 0: spots 0,1,2 — Group 1: spots 3,4,5 — Group 2: spots 6,7,8 (2-stop fallback if fewer)
  const plans = templates.map((tmpl, i) => {
    const poolStart = i * 3;
    const pool      = spots.slice(poolStart, poolStart + 3);

    // If we've run out of unique spots, wrap around with slight offset
    const filled = pool.length >= 2 ? pool : [
      spots[i % spots.length],
      spots[(i + 1) % spots.length],
    ];

    const stops = filled.slice(0, 3).map((s, j) => ({
      name:         s.name,
      category:     s.category,
      neighborhood: s.neighborhood,
      duration:     STOP_DURATIONS[j % STOP_DURATIONS.length],
    }));

    return { title: tmpl.title, tagline: tmpl.tagline, stops };
  });

  return plans;
}

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

  // ── Fallback: no API key → assemble plans from DB spots directly
  const anthropic = getAnthropic();
  if (!anthropic) {
    console.warn('ANTHROPIC_API_KEY not set — using fallback plan builder');
    return buildFallbackPlans(spots, vibe);
  }

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
