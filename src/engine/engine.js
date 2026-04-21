// ─────────────────────────────────────────────────────────────────────
// rendezvous-engine/src/engine.js
// Main orchestrator — public API for both engines.
// This is the single entry point used by the backend routes.
// ─────────────────────────────────────────────────────────────────────

const { buildTasteVector, getColdStartStatus, getRebuildScope, processScrollBehavior } = require('./vector/profileBuilder');
const { buildGroupSpectrum, deriveGroupVibeTags, generateConflictMessages } = require('./matching/groupMatcher');
const { generateThreePlans } = require('./matching/itineraryAssembler');
const { applyContextModifiers, normalizeWeatherData } = require('./context/contextModifiers');
const { processFeedbackBatch, getSuppressedSpotIds, computeFeedbackStats } = require('./feedback/feedbackLoop');
const { scoreSpot, filterEligibleSpots } = require('./matching/groupMatcher');

// ══════════════════════════════════════════════════════════════════════
// ENGINE 1 — PERSONAL PROFILE
// ══════════════════════════════════════════════════════════════════════

/**
 * Rebuild a user's taste vector from all available signals.
 * Call this whenever a new signal arrives (event-driven).
 *
 * profile: full TasteProfile from database
 * options: { triggerEvent?: string, scrollEvents?: [], seasonalFeedback?: [] }
 *
 * Returns: { vector, confidence, coldStartStatus, signalBreakdown, rebuildScope }
 */
function rebuildProfile(profile, options = {}) {
  const rebuildScope = getRebuildScope(options.triggerEvent || 'full');

  // Build taste vector from all signals
  const { vector, confidence, signalBreakdown } = buildTasteVector(profile);

  // Apply scroll behavior nudges if in cold start
  let finalVector = vector;
  if (options.scrollEvents?.length) {
    const { vector: scrollUpdated } = processScrollBehavior(options.scrollEvents, vector);
    finalVector = scrollUpdated;
  }

  // Cold start status
  const coldStartStatus = getColdStartStatus({ ...profile, scrollEventCount: options.scrollEventCount || 0 });

  return {
    vector:          finalVector,
    confidence,
    coldStartStatus,
    signalBreakdown,
    rebuildScope,
  };
}

/**
 * Score and rank Discover feed spots for a single user.
 *
 * userVector: user's taste vector
 * spots: array of spot objects from database
 * options: { limit?, savedSpotIds?, visitedSpotIds?, weather?, events? }
 *
 * Returns: ranked spot array with match scores
 */
function rankDiscoverFeed(userVector, spots, options = {}) {
  const {
    limit = 30,
    savedSpotIds = [],
    visitedSpotIds = [],
    weather = null,
    events = [],
  } = options;

  // Build a single-member "group" spectrum for individual scoring
  const singleMemberSpectrum = buildGroupSpectrum([{
    userId: 'self',
    tasteVector: userVector,
    tonightOverrides: {},
  }]);

  // Score all spots
  let scored = spots.map(spot => ({
    spot,
    score: scoreSpot(spot, singleMemberSpectrum, [], {
      visitedSpotIds,
      lovedSpotIds: savedSpotIds,
      suggestedSpotIds: [],
    }),
    wildcardScore: 0,
  }));

  // Apply context modifiers
  const context = {
    weather: weather ? normalizeWeatherData(weather) : null,
    events,
    spotHistories: {},
    lastOutingDate: options.lastOutingDate || null,
  };
  scored = applyContextModifiers(scored, context);

  // Sort and limit
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ spot, score, contextModifier }) => ({
      ...spot,
      matchScore: Math.round(score * 100),
      contextModifier,
    }));
}

/**
 * Process feedback batch for weekly profile update.
 * Call from the weekly cron job.
 */
function applyFeedback(profile, feedbackBatch) {
  return processFeedbackBatch(profile, feedbackBatch);
}

/**
 * Get feedback statistics for a user.
 */
function getFeedbackStats(reactions, windowDays = 90) {
  return computeFeedbackStats(reactions, windowDays);
}

// ══════════════════════════════════════════════════════════════════════
// ENGINE 2 — GROUP MATCHING
// ══════════════════════════════════════════════════════════════════════

/**
 * Generate three plan options for a party.
 * This is the main plan generation function called from the party route.
 *
 * partyMembers: [{
 *   userId: string,
 *   tasteProfile: TasteProfile (from DB),
 *   tonightOverrides: { energyLevel, budget, availableFromMinutes }
 * }]
 * allSpots: spot[] — full spot database
 * options: {
 *   centerLat?, centerLng?, radiusMiles?,
 *   weather?, events?,
 *   groupHistory?: { visitedSpotIds, lovedSpotIds, suggestedSpotIds, lastOutingDate },
 *   suppressedSpotIds?: Set<string>,
 * }
 *
 * Returns: {
 *   plans: Plan[3],
 *   groupSpectrum,
 *   conflicts: string[],
 *   groupVibeTags: string[],
 * }
 */
async function generateGroupPlans(partyMembers, allSpots, options = {}) {
  if (!partyMembers?.length) throw new Error('No party members provided.');

  // ── 1. Build taste vectors for all members ──────────────────────
  const membersWithVectors = partyMembers.map(member => {
    const { vector } = buildTasteVector(member.tasteProfile);
    return {
      userId: member.userId,
      tasteVector: vector,
      tonightOverrides: member.tonightOverrides || {},
    };
  });

  // ── 2. Build group vibe spectrum ────────────────────────────────
  const groupSpectrum = buildGroupSpectrum(membersWithVectors);

  // ── 3. Derive group context ─────────────────────────────────────
  const groupActivities = [
    ...new Set(partyMembers.flatMap(m => m.tasteProfile.activities || []))
  ];

  const groupHistory = options.groupHistory || {
    visitedSpotIds:   [],
    lovedSpotIds:     [],
    suggestedSpotIds: [],
  };

  // ── 4. Filter suppressed spots ──────────────────────────────────
  let eligibleSpots = allSpots;
  if (options.suppressedSpotIds?.size) {
    eligibleSpots = allSpots.filter(s => !options.suppressedSpotIds.has(s.id));
  }

  // ── 5. Apply context modifiers to all spots ─────────────────────
  const context = {
    weather:      options.weather ? normalizeWeatherData(options.weather) : null,
    events:       options.events || [],
    spotHistories: options.spotHistories || {},
    lastOutingDate: groupHistory.lastOutingDate || null,
  };

  const tempScored = eligibleSpots.map(spot => ({
    spot,
    score: scoreSpot(spot, groupSpectrum, groupActivities, groupHistory, false),
    wildcardScore: scoreSpot(spot, groupSpectrum, groupActivities, groupHistory, true),
  }));

  const contextuallyScored = applyContextModifiers(tempScored, context);

  // Update scores in the spots for the itinerary assembler
  const spotScoreMap = new Map(contextuallyScored.map(s => [s.spot.id, s.score]));
  eligibleSpots = eligibleSpots.map(spot => ({
    ...spot,
    _engineScore: spotScoreMap.get(spot.id) || 0,
  }));

  // ── 6. Generate three plans ─────────────────────────────────────
  const plans = await generateThreePlans(
    eligibleSpots,
    groupSpectrum,
    groupActivities,
    groupHistory,
    {
      centerLat:   options.centerLat,
      centerLng:   options.centerLng,
      radiusMiles: options.radiusMiles || 3,
    }
  );

  // ── 7. Generate conflict messages ───────────────────────────────
  const conflictMessages = generateConflictMessages(groupSpectrum.conflicts);
  const groupVibeTags    = deriveGroupVibeTags(groupSpectrum.composite);

  return {
    plans,
    groupSpectrum: {
      composite:       groupSpectrum.composite,
      conflicts:       groupSpectrum.conflicts,
      toleranceRadius: groupSpectrum.toleranceRadius,
      memberCount:     groupSpectrum.memberCount,
    },
    conflictMessages,
    groupVibeTags,
    effectiveBudget: groupSpectrum.constraints.effectiveBudget,
  };
}

/**
 * Get group match analysis without generating plans.
 * Used for the "group composite vibe" display on the Party screen.
 */
function analyzeGroupCompatibility(partyMembers) {
  const membersWithVectors = partyMembers.map(member => {
    const { vector, confidence } = buildTasteVector(member.tasteProfile);
    return {
      userId: member.userId,
      tasteVector: vector,
      confidence,
      tonightOverrides: member.tonightOverrides || {},
    };
  });

  const groupSpectrum  = buildGroupSpectrum(membersWithVectors);
  const groupVibeTags  = deriveGroupVibeTags(groupSpectrum.composite);
  const conflictMessages = generateConflictMessages(groupSpectrum.conflicts);

  return {
    composite:         groupSpectrum.composite,
    spectrum:          groupSpectrum.spectrum,
    groupVibeTags,
    conflictMessages,
    toleranceRadius:   groupSpectrum.toleranceRadius,
    memberCount:       groupSpectrum.memberCount,
    overallCompatibility: computeOverallCompatibility(groupSpectrum),
  };
}

/**
 * Compute a single 0–100 compatibility score for the group.
 * Higher = more aligned, easier to find a plan everyone loves.
 */
function computeOverallCompatibility(groupSpectrum) {
  const primaryDims = ['energyLevel', 'socialOpenness', 'physicalEnergy', 'groupSizePref'];
  const avgStdDev = primaryDims.reduce((s, d) =>
    s + (groupSpectrum.spectrum[d]?.stdDev || 0), 0) / primaryDims.length;
  // Invert: low std dev = high compatibility
  return Math.round((1 - Math.min(1, avgStdDev / 0.5)) * 100);
}

// ── PUBLIC API ────────────────────────────────────────────────────────
module.exports = {
  // Engine 1
  rebuildProfile,
  rankDiscoverFeed,
  applyFeedback,
  getFeedbackStats,
  getColdStartStatus,

  // Engine 2
  generateGroupPlans,
  analyzeGroupCompatibility,

  // Utilities (re-exported for convenience)
  buildTasteVector,
  buildGroupSpectrum,
  normalizeWeatherData,
  getSuppressedSpotIds,
};
