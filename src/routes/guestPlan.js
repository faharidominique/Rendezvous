// src/routes/guestPlan.js — Guest plan generation (no auth required)
const express  = require('express');
const router   = express.Router();
const { PrismaClient } = require('@prisma/client');
const Anthropic = require('@anthropic-ai/sdk');
const { generateGroupPlans } = require('../engine/engine');

const prisma = new PrismaClient();

let _anthropic = null;
function getAnthropic() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!_anthropic) _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _anthropic;
}

const guestPlans = new Map();
function planId() { return Math.random().toString(36).slice(2, 10).toUpperCase(); }

// ── VIBE → TASTE PROFILE ──────────────────────────────────────────────────────
// Maps check-in vibe selection to a synthetic tasteProfile the engine understands.
// Uses the same ACTIVITY_MAP and VIBE_MAP keys defined in src/engine/config.js.
const VIBE_TO_PROFILE = {
  chill:       { activities: ['coffee', 'chill', 'food'],                vibeTags: ['chill', 'low-key'],           energyOverride: 'low'    },
  lively:      { activities: ['music', 'dance', 'late-night', 'events'], vibeTags: ['social', 'high-energy'],      energyOverride: 'high'   },
  cultural:    { activities: ['music', 'art', 'markets', 'events'],      vibeTags: ['creative', 'spontaneous'],    energyOverride: 'medium' },
  foodie:      { activities: ['food', 'coffee', 'markets'],              vibeTags: ['social'],                     energyOverride: 'medium' },
  active:      { activities: ['outdoor', 'events', 'sports', 'food'],    vibeTags: ['adventurous', 'outdoors'],    energyOverride: 'high'   },
  spontaneous: { activities: ['events', 'music', 'food'],                vibeTags: ['spontaneous', 'adventurous'], energyOverride: 'medium' },
};

// ── NEW CHECK-IN FIELD MAPPINGS ───────────────────────────────────────────────
// Translates the 4 new fields into additional activities/vibeTags that merge with
// the vibe profile before being passed to buildTasteVector in the engine.
// houseStart shifts availableFromMinutes forward by 45 min (getting ready at home).

const FORMAT_MAP = {
  collaborate: { activities: ['events'],           vibeTags: ['social']                     },
  compete:     { activities: ['gaming'],            vibeTags: ['high-energy']                },
  talk:        { activities: ['coffee', 'chill'],   vibeTags: ['low-key']                    },
  experience:  { activities: ['art', 'events'],     vibeTags: ['adventurous', 'creative']    },
  flexible:    { activities: [],                    vibeTags: []                             },
};

const NOVELTY_MAP = {
  familiar:  { activities: [],        vibeTags: ['planned']                   },
  discover:  { activities: [],        vibeTags: ['spontaneous', 'adventurous'] },
  either:    { activities: [],        vibeTags: []                             },
};

const VISIBILITY_MAP = {
  low:  { activities: [],   vibeTags: ['low-key', 'indoors'] },
  mid:  { activities: [],   vibeTags: []                     },
  high: { activities: [],   vibeTags: ['social', 'high-energy'] },
};

const HOUSE_START_DELAY_MINUTES = 45;

function applyCheckInFields(baseProfile, { format, novelty, visibility, houseStart }) {
  const f = FORMAT_MAP[format]     || FORMAT_MAP.flexible;
  const n = NOVELTY_MAP[novelty]   || NOVELTY_MAP.either;
  const v = VISIBILITY_MAP[visibility] || VISIBILITY_MAP.mid;

  return {
    activities: [...new Set([...baseProfile.activities, ...f.activities, ...n.activities, ...v.activities])],
    vibeTags:   [...new Set([...baseProfile.vibeTags,   ...f.vibeTags,   ...n.vibeTags,   ...v.vibeTags])],
    extraMinutes: houseStart ? HOUSE_START_DELAY_MINUTES : 0,
  };
}

// ── HELPERS ───────────────────────────────────────────────────────────────────
function startTimeToMinutes(startTime) {
  if (!startTime) return 19 * 60;
  const match = String(startTime).match(/(\d{1,2}):?(\d{2})?\s*(am|pm)?/i);
  if (!match) return 19 * 60;
  let hours = parseInt(match[1]);
  const mins  = parseInt(match[2] || '0');
  const mer   = match[3]?.toLowerCase();
  if (mer === 'pm' && hours !== 12) hours += 12;
  if (mer === 'am' && hours === 12) hours = 0;
  return hours * 60 + mins;
}

// ── CLAUDE: NARRATIVE LAYER ───────────────────────────────────────────────────
// Engine picks the venues. Claude writes the voice.
async function addNarratives(anthropic, plans, { vibe, groupSize, budget }) {
  const summaries = plans.map((p, i) => ({
    index: i,
    label: p.label,
    stops: p.stops.map(s => `${s.name} (${s.category}, ${s.neighborhood})`).join(' → '),
  }));

  const prompt = `You are Rendezvous — write sharp, local-feeling copy for 3 evening plans.

Group: ${groupSize} people | Vibe: ${vibe} | Budget: $${budget}/person

For each plan write:
- "tagline": one punchy sentence capturing the night's feel (under 15 words, no quotes, no filler)
- "stops": for each stop, one "why" sentence explaining why this stop fits this group tonight (under 20 words, specific, no generic phrases)

Plans:
${summaries.map(p => `Plan ${p.index + 1} (${p.label}): ${p.stops}`).join('\n')}

Return ONLY a raw JSON array of exactly 3 objects — no markdown, no explanation:
[{"tagline":"...","stops":[{"why":"..."},...]}]
Each stops array must have the exact same stop count as the corresponding plan.`;

  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 800,
    messages: [{ role: 'user', content: prompt }],
  });

  let text = msg.content[0].text.trim()
    .replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const narratives = JSON.parse(text.slice(text.indexOf('['), text.lastIndexOf(']') + 1));

  return plans.map((plan, i) => ({
    ...plan,
    tagline: narratives[i]?.tagline || plan.label,
    stops: plan.stops.map((stop, j) => ({
      ...stop,
      why: narratives[i]?.stops?.[j]?.why || '',
    })),
  }));
}

function fallbackFormat(plans) {
  return plans.map(plan => ({
    ...plan,
    tagline: plan.label,
    stops: plan.stops.map(s => ({ ...s, why: '' })),
  }));
}

// ── PLAN BUILDER ──────────────────────────────────────────────────────────────
async function buildPlans({ vibe, groupSize, budget, neighborhood, startTime, format, novelty, visibility, houseStart, mbtiType, zodiacSign }) {
  const baseProfile = VIBE_TO_PROFILE[vibe] || VIBE_TO_PROFILE.spontaneous;
  const priceTier   = budget <= 25 ? 1 : budget <= 50 ? 2 : budget <= 75 ? 3 : 4;

  // Merge vibe profile with the 4 new check-in fields
  const { activities, vibeTags, extraMinutes } = applyCheckInFields(baseProfile, {
    format:     format     || 'flexible',
    novelty:    novelty    || 'either',
    visibility: visibility || 'low',
    houseStart: houseStart || false,
  });

  // Pull budget/neighborhood-filtered spots from DB
  const allSpots = await prisma.spot.findMany({
    where: {
      isActive:  true,
      priceTier: { lte: priceTier },
      ...(neighborhood ? { neighborhood: { contains: neighborhood, mode: 'insensitive' } } : {}),
    },
    take: 80,
  });

  // Build synthetic party members — one per person, all sharing the merged profile.
  // Minimum 2 so the engine's group size filter passes (spots require groupSizeMin >= 2).
  const availableFromMinutes = startTimeToMinutes(startTime) + extraMinutes;
  const memberCount = Math.max(2, groupSize);
  const partyMembers = Array.from({ length: memberCount }, (_, i) => ({
    userId: `guest_${i}`,
    mbtiType:   mbtiType   || null,
    zodiacSign: zodiacSign || null,
    tasteProfile: {
      activities,
      vibeTags,
      budgetMax: budget,
    },
    tonightOverrides: {
      energyLevel:          baseProfile.energyOverride,
      budget,
      availableFromMinutes,
    },
  }));

  // Engine runs: profile build → group spectrum → venue scoring → 3 plans
  const { plans } = await generateGroupPlans(partyMembers, allSpots);

  // Layer Claude narrative on top
  const anthropic = getAnthropic();
  if (!anthropic) {
    console.warn('[guestPlan] ANTHROPIC_API_KEY not set — skipping narratives');
    return fallbackFormat(plans);
  }

  try {
    return await addNarratives(anthropic, plans, { vibe, groupSize, budget });
  } catch (err) {
    console.error('[guestPlan] Claude narrative error:', err.message);
    return fallbackFormat(plans);
  }
}

// ── ROUTES ────────────────────────────────────────────────────────────────────

const GUEST_HOST_EMAIL = 'guest-host@rendezvous.app';

async function getOrCreateGuestHost() {
  return prisma.user.upsert({
    where: { email: GUEST_HOST_EMAIL },
    update: {},
    create: {
      email: GUEST_HOST_EMAIL,
      displayName: 'Guest Host',
      handle: 'guest-host',
    },
  });
}

async function generateUniqueCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code, exists;
  do {
    code = 'RNDVZ-' + Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    exists = await prisma.party.findUnique({ where: { code } });
  } while (exists);
  return code;
}

// POST /api/v1/guest/plan
router.post('/plan', async (req, res) => {
  try {
    const { vibe, groupSize, budget, neighborhood, startTime, format, novelty, visibility, houseStart, mbtiType, zodiacSign } = req.body;
    if (!vibe || !groupSize || !budget) {
      return res.status(400).json({ success: false, error: { message: 'Missing required fields.' } });
    }
    const plans = await buildPlans({ vibe, groupSize, budget, neighborhood, startTime, format, novelty, visibility, houseStart, mbtiType, zodiacSign });

    const id = planId();
    guestPlans.set(id, { plans, inputs: req.body, createdAt: Date.now() });

    const guestHost = await getOrCreateGuestHost();
    const code = await generateUniqueCode();
    const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);
    await prisma.party.create({
      data: {
        hostId: guestHost.id,
        code,
        expiresAt,
        locationCity: 'Washington, DC',
        status: 'ACTIVE',
        generatedPlans: plans,
      },
    });

    res.json({ success: true, planId: id, partyCode: code, plans });
  } catch (err) {
    console.error('[guestPlan] Error:', err.message, err.stack);
    res.status(500).json({ success: false, error: { message: 'Could not generate plans.', detail: err.message } });
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
