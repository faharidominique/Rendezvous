// ─────────────────────────────────────────────────────────────────────
// rendezvous-engine/src/matching/itineraryAssembler.js
// Assembles scored spots into 3 distinct itinerary options.
// Option 1: Best composite match
// Option 2: Budget-optimised variant
// Option 3: Wildcard / spontaneity variant
// ─────────────────────────────────────────────────────────────────────
const { haversineMiles } = require('../utils/vector');
const { ITINERARY, ACTIVITY_TO_SPOT_CATEGORY } = require('../config');
const { scoreSpot, filterEligibleSpots, generateBudgetWarning } = require('./groupMatcher');

// ── STOP COUNT ────────────────────────────────────────────────────────
function getStopCount(availableFromMinutes) {
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const startMinutes = availableFromMinutes || currentMinutes;
  const availableMinutes = Math.max(0, (23 * 60) - startMinutes);
  return availableMinutes >= ITINERARY.availabilityThreshold
    ? ITINERARY.stopsForLongWindow
    : ITINERARY.stopsForShortWindow;
}

// ── FOOD STOP SELECTOR ────────────────────────────────────────────────
const FOOD_CATEGORIES = ['Restaurant', 'Café', 'Beer Garden', 'Food Market', 'Food Hall'];
const WINDDOWN_CATEGORIES = ['Café', 'Beer Garden', 'Bar', 'Bookstore', 'Coffee Shop'];

function selectFoodStop(primarySpot, scoredSpots, usedIds, effectiveBudget) {
  return scoredSpots
    .filter(s =>
      !usedIds.has(s.spot.id) &&
      FOOD_CATEGORIES.includes(s.spot.category) &&
      (s.spot.priceTier || 1) * 22 <= effectiveBudget * 1.1
    )
    .sort((a, b) => {
      // Prefer nearby food stops, then by score
      const distA = primarySpot.lat ? haversineMiles(primarySpot.lat, primarySpot.lng, a.spot.lat, a.spot.lng) : 99;
      const distB = primarySpot.lat ? haversineMiles(primarySpot.lat, primarySpot.lng, b.spot.lat, b.spot.lng) : 99;
      const distWeight = 0.4;
      const scoreWeight = 0.6;
      return (distA * distWeight + (1 - a.score) * scoreWeight) -
             (distB * distWeight + (1 - b.score) * scoreWeight);
    })[0] || null;
}

function selectWindDownStop(scoredSpots, usedIds, effectiveBudget) {
  return scoredSpots
    .filter(s =>
      !usedIds.has(s.spot.id) &&
      WINDDOWN_CATEGORIES.includes(s.spot.category) &&
      (s.spot.energyScore || 0.5) < 0.55 &&
      (s.spot.priceTier || 1) * 10 <= effectiveBudget
    )
    .sort((a, b) => b.score - a.score)[0] || null;
}

// ── WALKABILITY CHECK ─────────────────────────────────────────────────
function checkWalkability(stops) {
  if (stops.length < 2 || !stops[0].lat) return false;
  return stops.every((s, i) => {
    if (i === 0) return true;
    return haversineMiles(stops[0].lat, stops[0].lng, s.lat, s.lng) <= ITINERARY.walkableRadiusMiles;
  });
}

// ── SINGLE ITINERARY BUILDER ──────────────────────────────────────────
function buildItinerary(primarySpot, scoredSpots, groupSpectrum, usedIds = new Set(), label = 'Best match') {
  const stops = [primarySpot];
  const localUsed = new Set([...usedIds, primarySpot.id]);
  const { effectiveBudget, availableFromMinutes } = groupSpectrum.constraints;
  const maxStops = getStopCount(availableFromMinutes);

  // Stop 2: food/drinks anchor
  if (maxStops >= 2) {
    const foodStop = selectFoodStop(primarySpot, scoredSpots, localUsed, effectiveBudget);
    if (foodStop) {
      stops.push(foodStop.spot);
      localUsed.add(foodStop.spot.id);
    }
  }

  // Stop 3: wind-down (only if time allows and not already have 2 food stops)
  if (maxStops >= 3 && stops.length >= 2) {
    const windDown = selectWindDownStop(scoredSpots, localUsed, effectiveBudget);
    if (windDown) {
      stops.push(windDown.spot);
      localUsed.add(windDown.spot.id);
    }
  }

  const isWalkable  = checkWalkability(stops);
  const totalDuration = stops.reduce((s, spot) => s + (spot.visitDuration || 90), 0);

  // Budget warnings (private — no individual named)
  const budgetWarnings = stops
    .map(s => generateBudgetWarning(s, effectiveBudget))
    .filter(Boolean);

  return {
    label,
    stops,
    isWalkable,
    totalDuration,
    budgetWarnings,
    usedIds: localUsed,
  };
}

// ── DIVERSITY CHECK ────────────────────────────────────────────────────
function stopsOverlap(itinerary1, itinerary2) {
  const ids1 = new Set(itinerary1.stops.map(s => s.id));
  return itinerary2.stops.filter(s => ids1.has(s.id)).length;
}

// ── MAIN: GENERATE 3 PLAN OPTIONS ─────────────────────────────────────
/**
 * Generate 3 distinct itinerary options from scored spots.
 *
 * allSpots: spot[] — all spots in the database (unfiltered)
 * groupSpectrum: result from buildGroupSpectrum()
 * groupActivities: string[] — union of all member activity preferences
 * groupHistory: { visitedSpotIds, lovedSpotIds, suggestedSpotIds }
 * options: { centerLat?, centerLng?, radiusMiles? }
 */
async function generateThreePlans(allSpots, groupSpectrum, groupActivities = [], groupHistory = {}, options = {}) {
  // ── 1. Filter eligible spots ─────────────────────────────────────
  let eligible = filterEligibleSpots(allSpots, groupSpectrum);

  // Filter by radius if coordinates provided
  if (options.centerLat && options.centerLng) {
    const radius = options.radiusMiles || 3;
    eligible = eligible.filter(s =>
      s.lat && s.lng
        ? haversineMiles(options.centerLat, options.centerLng, s.lat, s.lng) <= radius
        : true
    );
  }

  if (eligible.length < 3) {
    throw new Error(
      `Not enough eligible spots for this group. Found ${eligible.length} — try expanding the search radius or relaxing filters.`
    );
  }

  // ── 2. Score all eligible spots ──────────────────────────────────
  const scored = eligible.map(spot => ({
    spot,
    score:         scoreSpot(spot, groupSpectrum, groupActivities, groupHistory, false),
    wildcardScore: scoreSpot(spot, groupSpectrum, groupActivities, groupHistory, true),
  })).sort((a, b) => b.score - a.score);

  // ── 3. OPTION 1: Best composite match ────────────────────────────
  // Primary stop = highest scored non-food spot
  const primaryCandidates = scored.filter(s => !FOOD_CATEGORIES.includes(s.spot.category));
  const option1Primary = (primaryCandidates[0] || scored[0]).spot;
  const option1 = buildItinerary(option1Primary, scored, groupSpectrum, new Set(), ITINERARY.planLabels[0]);

  // ── 4. OPTION 2: Budget-optimised variant ────────────────────────
  // Score with extra weight on low price tier
  const budgetScored = eligible
    .filter(s => s.id !== option1Primary.id)
    .map(spot => ({
      spot,
      score: scoreSpot(spot, groupSpectrum, groupActivities, groupHistory, false) * (2 / (spot.priceTier || 1)),
    }))
    .sort((a, b) => b.score - a.score);

  const option2Candidates = budgetScored.filter(s => !FOOD_CATEGORIES.includes(s.spot.category));
  let option2Primary = (option2Candidates[0] || budgetScored[0]).spot;

  // Ensure diversity from Option 1 primary stop
  const option2StartingIds = new Set([option1Primary.id]);
  const option2 = buildItinerary(option2Primary, scored, groupSpectrum, option2StartingIds, ITINERARY.planLabels[1]);

  // If too much overlap with Option 1, try the next candidate
  if (stopsOverlap(option1, option2) >= 2 && option2Candidates.length > 1) {
    const retryPrimary = option2Candidates[1].spot;
    const retry = buildItinerary(
      retryPrimary, scored, groupSpectrum,
      new Set([option1Primary.id, retryPrimary.id]),
      ITINERARY.planLabels[1]
    );
    if (stopsOverlap(option1, retry) < stopsOverlap(option1, option2)) {
      option2Primary = retryPrimary;
      Object.assign(option2, retry);
    }
  }

  // ── 5. OPTION 3: Wildcard / spontaneity ──────────────────────────
  // Derive excluded ids from actual assembled stops (not stale primary variables)
  const excludedIds = new Set([
    ...option1.stops.map(s => s.id),
    ...option2.stops.map(s => s.id),
  ]);

  const wildcardCandidates = eligible
    .filter(s => !excludedIds.has(s.id) && !FOOD_CATEGORIES.includes(s.category))
    .map(spot => ({
      spot,
      wildcardScore: scoreSpot(spot, groupSpectrum, groupActivities, groupHistory, true),
    }))
    .sort((a, b) => b.wildcardScore - a.wildcardScore);

  // Fallback to any non-food spot not already used
  const option3Primary = wildcardCandidates[0]?.spot ||
    scored.filter(s => !FOOD_CATEGORIES.includes(s.spot.category) && !excludedIds.has(s.spot.id))[0]?.spot ||
    scored.filter(s => !excludedIds.has(s.spot.id))[0]?.spot;

  const option3 = option3Primary
    ? buildItinerary(option3Primary, scored, groupSpectrum, new Set([...excludedIds, option3Primary.id]), ITINERARY.planLabels[2])
    : option2; // absolute fallback — shouldn't happen with a proper database

  // ── 6. Compute match scores for display ──────────────────────────
  function planMatchScore(itinerary) {
    if (!itinerary.stops.length) return 0;
    const primaryScore = scored.find(s => s.spot.id === itinerary.stops[0].id)?.score || 0;
    return Math.round(primaryScore * 100);
  }

  return [
    { ...option1, index: 0, matchScore: planMatchScore(option1), votes: 0, voted: false },
    { ...option2, index: 1, matchScore: planMatchScore(option2), votes: 0, voted: false },
    { ...option3, index: 2, matchScore: planMatchScore(option3), votes: 0, voted: false },
  ];
}

module.exports = { generateThreePlans, buildItinerary, checkWalkability, getStopCount };
