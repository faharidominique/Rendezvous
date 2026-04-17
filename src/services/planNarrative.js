// Rendezvous — Claude API Plan Narrative Generator
const Anthropic = require('@anthropic-ai/sdk');
const { redis } = require('../services/redis');
const logger = require('../utils/logger');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Cache key for plan narratives
function cacheKey(planHash) {
  return `plan_narrative:${planHash}`;
}

// Simple hash of plan contents for caching
function hashPlan(plan, composite) {
  const str = JSON.stringify({
    stops: plan.stops.map(s => s.id),
    energyLevel: Math.round(composite.vector.energyLevel * 10) / 10,
    budget: composite.constraints.effectiveBudget,
  });
  return Buffer.from(str).toString('base64').slice(0, 32);
}

// ── GENERATE NARRATIVE FOR ONE PLAN ──────────────────────────────────
async function generatePlanNarrative(plan, composite, memberCount) {
  const hash = hashPlan(plan, composite);
  const cached = await redis.get(cacheKey(hash));
  if (cached) return cached;

  const stopDescriptions = plan.stops.map((s, i) =>
    `Stop ${i + 1}: ${s.name} (${s.category}, ${s.neighborhood}) — ${s.vibeTags?.join(', ') || 'local favorite'}`
  ).join('\n');

  const vibeWords = [];
  const v = composite.vector;
  if (v.energyLevel > 0.65) vibeWords.push('high energy');
  else if (v.energyLevel < 0.4) vibeWords.push('low-key');
  if (v.culturalAppetite > 0.6) vibeWords.push('culturally curious');
  if (v.outdoorPreference > 0.6) vibeWords.push('outdoor-friendly');
  if (v.spontaneity > 0.6) vibeWords.push('spontaneous');
  if (v.foodPriority > 0.6) vibeWords.push('food-focused');
  if (v.nightOwlScore > 0.6) vibeWords.push('night owl');

  const prompt = `You are Rendezvous, a social planning app that sounds like a knowledgeable local friend. 
Write a 2-sentence description for this group outing plan. Be warm, specific, and enthusiastic — but concise.
Reference the actual stops and why this combination works for this group.

Group profile: ${memberCount} friends, ${vibeWords.join(', ') || 'relaxed'} vibe, $${composite.constraints.effectiveBudget} budget per person.
Plan type: ${plan.label}
Stops:
${stopDescriptions}
${plan.isWalkable ? 'Note: all stops are within walking distance of each other.' : ''}

Write only the 2-sentence description. No intro, no labels, no quotes.`;

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 150,
      messages: [{ role: 'user', content: prompt }]
    });

    const narrative = response.content[0]?.text?.trim() || fallbackNarrative(plan);

    // Cache for 4 hours
    await redis.setex(cacheKey(hash), 60 * 60 * 4, narrative);
    return narrative;

  } catch (err) {
    logger.error('Claude API error for plan narrative:', err.message);
    return fallbackNarrative(plan);
  }
}

// ── FALLBACK (if Claude unavailable) ─────────────────────────────────
function fallbackNarrative(plan) {
  const stopNames = plan.stops.map(s => s.name).join(', then ');
  const walkNote = plan.isWalkable ? ' Best part — it\'s all walkable.' : '';
  return `Start at ${plan.stops[0]?.name} and work your way through the night — ${stopNames}.${walkNote} A solid evening for the whole group.`;
}

// ── GENERATE NARRATIVES FOR ALL 3 PLANS ──────────────────────────────
async function generateAllNarratives(plans, composite, memberCount) {
  const narratives = await Promise.allSettled(
    plans.map(plan => generatePlanNarrative(plan, composite, memberCount))
  );
  return plans.map((plan, i) => ({
    ...plan,
    narrative: narratives[i].status === 'fulfilled'
      ? narratives[i].value
      : fallbackNarrative(plan),
  }));
}

module.exports = { generateAllNarratives, generatePlanNarrative };
