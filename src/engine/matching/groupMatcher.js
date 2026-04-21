// ─────────────────────────────────────────────────────────────────────
// rendezvous-engine/src/matching/groupMatcher.js
// ENGINE 2 — Group Matching Engine
//
// Takes individual taste vectors, builds a group vibe spectrum,
// finds the complementary midpoint, and matches spots to that space.
// ─────────────────────────────────────────────────────────────────────
const { mean, findConflicts, stdDev, clamp, clampVector, jaccard } = require('../utils/vector');
const { VIBE_SPECTRUM, SPOT_SCORE_WEIGHTS, ACTIVITY_TO_SPOT_CATEGORY } = require('../config');

// ── GROUP COMPOSITE VECTOR ────────────────────────────────────────────
/**
 * Build the group composite vector and vibe spectrum.
 *
 * members: [{ userId, tasteVector, tonightOverrides: { energyLevel, budget, availableFromMinutes } }]
 *
 * Returns:
 * {
 *   composite: TasteVector,      // group centroid
 *   spectrum: { [dim]: { min, max, mean, stdDev, values } },
 *   constraints: { effectiveBudget, availableFromMinutes, groupSize },
 *   conflicts: [{ dimension, stdDev, values }],
 *   memberCount: number,
 *   toleranceRadius: number,
 * }
 */
function buildGroupSpectrum(members) {
  if (!members?.length) {
    return {
      composite: require('../utils/vector').neutral(),
      spectrum: {},
      constraints: { effectiveBudget: 50, availableFromMinutes: 19 * 60, groupSize: 1 },
      conflicts: [],
      memberCount: 0,
      toleranceRadius: VIBE_SPECTRUM.defaultToleranceRadius,
    };
  }

  // Apply tonight overrides to each member's vector
  const effectiveVectors = members.map(m => {
    let v = { ...m.tasteVector };
    const o = m.tonightOverrides || {};

    // Energy level override for tonight
    if (o.energyLevel === 'low')    v.energyLevel = clamp(v.energyLevel - 0.25);
    if (o.energyLevel === 'high')   v.energyLevel = clamp(v.energyLevel + 0.25);
    if (o.energyLevel === 'medium') { /* no change */ }

    // Budget sensitivity: derive from tonight's stated budget
    if (o.budget !== undefined && o.budget !== null) {
      v.budgetSensitivity = clamp(1 - o.budget / 150);
    }

    return v;
  });

  // Compute group centroid (mean across all members)
  const composite = mean(effectiveVectors);

  // Build spectrum: per-dimension statistics
  const spectrum = {};
  const dims = require('../config').VECTOR_DIMS;
  for (const dim of dims) {
    const values = effectiveVectors.map(v => v[dim] ?? 0.5);
    const dimMean = values.reduce((s, v) => s + v, 0) / values.length;
    const dimMin  = Math.min(...values);
    const dimMax  = Math.max(...values);
    const variance = values.reduce((s, v) => s + (v - dimMean) ** 2, 0) / values.length;
    spectrum[dim] = {
      mean:   parseFloat(dimMean.toFixed(3)),
      min:    parseFloat(dimMin.toFixed(3)),
      max:    parseFloat(dimMax.toFixed(3)),
      stdDev: parseFloat(Math.sqrt(variance).toFixed(3)),
      values: values.map(v => parseFloat(v.toFixed(2))),
    };
  }

  // Hard constraints: budget = minimum, time = latest availability
  const budgets = members.filter(m => m.tonightOverrides?.budget).map(m => m.tonightOverrides.budget);
  const effectiveBudget = budgets.length ? Math.min(...budgets) : 50;

  const availTimes = members
    .filter(m => m.tonightOverrides?.availableFromMinutes)
    .map(m => m.tonightOverrides.availableFromMinutes);
  const availableFromMinutes = availTimes.length ? Math.max(...availTimes) : 19 * 60;

  // Conflicts: dimensions with high disagreement
  const conflicts = findConflicts(effectiveVectors, VIBE_SPECTRUM.conflictThreshold);

  // Adaptive tolerance: tighter groups get tighter radius, wider groups get wider
  const avgStdDev = dims.reduce((s, d) => s + spectrum[d].stdDev, 0) / dims.length;
  const toleranceRadius = clamp(VIBE_SPECTRUM.defaultToleranceRadius + (avgStdDev - 0.15) * 0.5);

  return {
    composite,
    spectrum,
    constraints: { effectiveBudget, availableFromMinutes, groupSize: members.length },
    conflicts,
    memberCount: members.length,
    toleranceRadius,
    memberVectors: effectiveVectors,
  };
}

// ── GROUP VIBE TAGS ───────────────────────────────────────────────────
/**
 * Derive the top vibe tags for the group from the composite vector.
 * These are used to match against spot vibe tags.
 */
function deriveGroupVibeTags(composite) {
  const tags = [];

  // Primary energy dimension
  if (composite.energyLevel > 0.65)  tags.push('lively', 'high energy');
  else if (composite.energyLevel < 0.40) tags.push('cozy', 'chill', 'low-key');
  else tags.push('relaxed');

  // Social openness
  if (composite.socialOpenness > 0.65)  tags.push('social', 'group-friendly');
  else if (composite.socialOpenness < 0.35) tags.push('intimate');

  // Cultural appetite
  if (composite.culturalAppetite > 0.65) tags.push('underground', 'hidden gem', 'creative');
  else if (composite.culturalAppetite < 0.35) tags.push('mainstream');

  // Outdoor
  if (composite.outdoorPreference > 0.60) tags.push('outdoor');

  // Night owl
  if (composite.nightOwlScore > 0.65) tags.push('late night');
  else if (composite.nightOwlScore < 0.35) tags.push('daytime');

  // Spontaneity
  if (composite.spontaneity > 0.65) tags.push('spontaneous');

  // Food
  if (composite.foodPriority > 0.65) tags.push('foodie');

  // Physical energy
  if (composite.physicalEnergy > 0.65) tags.push('active');
  else if (composite.physicalEnergy < 0.35) tags.push('seated', 'relaxed');

  return [...new Set(tags)];
}

// ── SPOT COMPATIBILITY SCORER ─────────────────────────────────────────
/**
 * Score a single spot against the group composite vector.
 * Returns float 0.0–1.0.
 *
 * spot: database spot object with all required attributes
 * groupSpectrum: result from buildGroupSpectrum()
 * groupActivities: string[] — union of all members' activity preferences
 * groupHistory: { visitedSpotIds: string[], lovedSpotIds: string[], suggestedSpotIds: string[] }
 * wildcardMode: boolean — add random offset for Option 3
 */
function scoreSpot(spot, groupSpectrum, groupActivities = [], groupHistory = {}, wildcardMode = false) {
  const { composite, toleranceRadius } = groupSpectrum;
  const { visitedSpotIds = [], lovedSpotIds = [], suggestedSpotIds = [] } = groupHistory;
  let score = 0;

  // ── 1. VIBE TAG OVERLAP (weight 0.25) ─────────────────────────────
  const groupVibeTags = deriveGroupVibeTags(composite);
  const vibeOverlap = jaccard(spot.vibeTags || [], groupVibeTags);
  score += vibeOverlap * SPOT_SCORE_WEIGHTS.vibeTagOverlap;

  // ── 2. ENERGY MATCH (weight 0.20) ──────────────────────────────────
  if (spot.energyScore !== undefined) {
    const energyDiff = Math.abs(spot.energyScore - composite.energyLevel);
    score += (1 - energyDiff) * SPOT_SCORE_WEIGHTS.energyMatch;
  } else {
    score += 0.5 * SPOT_SCORE_WEIGHTS.energyMatch; // neutral if unknown
  }

  // ── 3. SOCIAL DENSITY MATCH (weight 0.15) ──────────────────────────
  if (spot.socialDensity !== undefined) {
    const socialDiff = Math.abs(spot.socialDensity - composite.socialOpenness);
    score += (1 - socialDiff) * SPOT_SCORE_WEIGHTS.socialDensityMatch;

    // Penalty if social density is outside tolerance radius
    if (socialDiff > toleranceRadius) {
      score -= 0.08;
    }
  } else {
    score += 0.5 * SPOT_SCORE_WEIGHTS.socialDensityMatch;
  }

  // ── 4. NOVELTY FIT (weight 0.12) ───────────────────────────────────
  if (spot.noveltyScore !== undefined) {
    const noveltyDiff = Math.abs(spot.noveltyScore - composite.noveltyAppetite);
    score += (1 - noveltyDiff) * SPOT_SCORE_WEIGHTS.noveltyFit;
  } else {
    score += 0.5 * SPOT_SCORE_WEIGHTS.noveltyFit;
  }

  // ── 5. CATEGORY AFFINITY (weight 0.12) ────────────────────────────
  let categoryMatch = 0;
  for (const activity of groupActivities) {
    const cats = ACTIVITY_TO_SPOT_CATEGORY[activity.toLowerCase()] || [];
    if (cats.includes(spot.category)) { categoryMatch = 1; break; }
  }
  score += categoryMatch * SPOT_SCORE_WEIGHTS.categoryAffinity;

  // ── 6. PRIOR VISIT / LOVED BONUS (weight 0.08) ────────────────────
  if (lovedSpotIds.includes(spot.id)) {
    score += 0.15; // loved = highest bonus
  } else if (visitedSpotIds.includes(spot.id)) {
    score += 0.05; // visited but neutral
  }
  // Repeated suggestion suppression
  const suggestionCount = suggestedSpotIds.filter(id => id === spot.id).length;
  if (suggestionCount >= 3) {
    score -= 0.15; // heavily penalise over-repeated suggestions
  } else if (suggestionCount >= 1) {
    score -= 0.05 * suggestionCount;
  }

  // ── 7. MULTI-ACTIVITY BONUS (weight 0.05) ─────────────────────────
  if (spot.multiActivityFlag && spot.multiActivityDescription) {
    score += SPOT_SCORE_WEIGHTS.multiActivityBonus;
  }

  // ── 8. FRESHNESS BONUS (weight 0.03) ──────────────────────────────
  const daysSinceVerified = spot.lastVerifiedAt
    ? (Date.now() - new Date(spot.lastVerifiedAt).getTime()) / (1000 * 60 * 60 * 24)
    : 999;
  if (!visitedSpotIds.includes(spot.id) && daysSinceVerified < 90) {
    score += SPOT_SCORE_WEIGHTS.freshnessBonus;
  }

  // ── 9. WILDCARD OFFSET ─────────────────────────────────────────────
  if (wildcardMode) {
    score += Math.random() * 0.12; // random offset for Option 3
  }

  // ── 10. COMPLEMENTARY MATCHING BONUS ──────────────────────────────
  // Bonus for spots that satisfy multiple members' different top needs
  if (groupSpectrum.memberVectors?.length > 1) {
    const complementaryScore = computeComplementaryScore(spot, groupSpectrum.memberVectors, groupActivities);
    score += complementaryScore * 0.10;
  }

  return clamp(score);
}

/**
 * Compute how well a spot satisfies different members' complementary needs.
 * A record store with a bar scores high for a group where some want music
 * and others want drinks.
 */
function computeComplementaryScore(spot, memberVectors, groupActivities) {
  if (!spot.multiActivityFlag) return 0;

  let satisfiedMembers = 0;
  const memberNeeds = memberVectors.map(v => deriveTopNeed(v));

  for (const need of memberNeeds) {
    const relevantCats = ACTIVITY_TO_SPOT_CATEGORY[need] || [];
    if (relevantCats.includes(spot.category)) satisfiedMembers++;
  }

  // Score = fraction of members whose top need is addressed
  return clamp(satisfiedMembers / memberVectors.length);
}

/**
 * Identify a member's single top need from their taste vector.
 */
function deriveTopNeed(vector) {
  const scores = {
    food:     vector.foodPriority,
    outdoor:  vector.outdoorPreference,
    music:    vector.culturalAppetite * 0.7 + vector.energyLevel * 0.3,
    art:      vector.culturalAppetite,
    chill:    1 - vector.energyLevel,
    dance:    vector.energyLevel * 0.6 + vector.nightOwlScore * 0.4,
    sports:   vector.physicalEnergy,
  };
  return Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0];
}

// ── ELIGIBILITY FILTER ────────────────────────────────────────────────
/**
 * Filter spots to only those eligible for plan generation.
 * Applies hard constraints: budget, hours, group size.
 */
function filterEligibleSpots(spots, groupSpectrum) {
  const { effectiveBudget, availableFromMinutes, groupSize } = groupSpectrum.constraints;

  return spots.filter(spot => {
    // Budget: price_tier maps to approximate cost per person
    const tierCosts = { 1: 10, 2: 22, 3: 45, 4: 80 };
    const estimatedCost = tierCosts[spot.priceTier] || 22;
    if (estimatedCost > effectiveBudget * 1.05) return false; // 5% tolerance

    // Hours: must be open during the group's availability window
    if (!isOpenAt(spot, availableFromMinutes)) return false;

    // Group size fit (treat solo as 2 — venues don't distinguish 1 vs 2)
    const effectiveGroupSize = Math.max(2, groupSize);
    if (effectiveGroupSize < (spot.groupSizeMin || 2)) return false;
    if (effectiveGroupSize > (spot.groupSizeMax || 20)) return false;

    return true;
  });
}

/**
 * Check if a spot is open at a given time (minutes since midnight).
 */
function isOpenAt(spot, minutesSinceMidnight) {
  if (!spot.hours) return true;
  const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const today = dayNames[new Date().getDay()];
  const hours = spot.hours[today];
  if (!hours) return false;

  try {
    const [openStr, closeStr] = hours.split('-');
    const [openH, openM] = openStr.split(':').map(Number);
    const [closeH, closeM] = closeStr.split(':').map(Number);
    const openMins  = openH * 60 + (openM || 0);
    let closeMins   = closeH * 60 + (closeM || 0);
    if (closeMins < openMins) closeMins += 24 * 60; // closing time crosses midnight
    return minutesSinceMidnight >= openMins && minutesSinceMidnight < closeMins - 30;
  } catch {
    return true; // if hours parsing fails, include the spot
  }
}

// ── CONFLICT MESSAGING ────────────────────────────────────────────────
/**
 * Generate user-facing conflict messages — informative but never
 * attributing conflict to a specific individual.
 */
function generateConflictMessages(conflicts) {
  const messages = [];

  for (const conflict of conflicts) {
    switch (conflict.dimension) {
      case 'energyLevel':
        messages.push("Your group has a mix of energy levels tonight — we've balanced the plans to suit everyone.");
        break;
      case 'socialOpenness':
        messages.push("Some members prefer more intimate settings. We've included options that work for both.");
        break;
      case 'outdoorPreference':
        messages.push("Mixed feelings on outdoor vs. indoor — all three options handle this differently.");
        break;
      case 'nightOwlScore':
        messages.push("The group has different timing preferences. Plans are designed to wrap up at a reasonable hour.");
        break;
      case 'noveltyAppetite':
        messages.push("Some members love new spots, others prefer familiar territory. Each option takes a different approach.");
        break;
    }
  }

  return [...new Set(messages)]; // deduplicate
}

/**
 * Generate budget warning message (never names the individual).
 */
function generateBudgetWarning(spot, effectiveBudget) {
  const tierCosts = { 1: 10, 2: 22, 3: 45, 4: 80 };
  const cost = tierCosts[spot.priceTier] || 22;
  if (cost > effectiveBudget) {
    return `${spot.name} may exceed some members' budgets for tonight.`;
  }
  return null;
}

module.exports = {
  buildGroupSpectrum,
  deriveGroupVibeTags,
  scoreSpot,
  filterEligibleSpots,
  isOpenAt,
  computeComplementaryScore,
  generateConflictMessages,
  generateBudgetWarning,
};
