// Rendezvous — Spot Matching & Itinerary Assembly Algorithm

const { prisma } = require('../services/db');

// ── SPOT SCORING ──────────────────────────────────────────────────────
// Weights must sum to 1.0
const SCORE_WEIGHTS = {
  energyMatch:    0.25,
  vibeTagOverlap: 0.20,
  categoryAffinity: 0.20,
  socialFit:      0.15,
  priorVisitBonus: 0.10,
  freshnessBonus:  0.05,
  wildcard:        0.05,
};

// Map user activity chips to spot categories
const ACTIVITY_TO_CATEGORY = {
  'food':     ['Restaurant', 'Café', 'Beer Garden', 'Food Market'],
  'music':    ['Record Store', 'Music Venue', 'Arcade Bar'],
  'art':      ['Art Space', 'Art Studios', 'Gallery', 'Museum'],
  'outdoor':  ['Beer Garden', 'Park', 'Market', 'Outdoor Venue'],
  'thrifting':['Thrift Store', 'Record Store', 'Vintage Shop', 'Market'],
  'gaming':   ['Arcade Bar', 'Game Bar', 'Arcade'],
  'events':   ['Pop-up', 'Event Space', 'Market', 'Music Venue'],
  'coffee':   ['Café', 'Coffee Shop'],
  'comics':   ['Bookstore', 'Comic Shop'],
  'markets':  ['Market', 'Food Market', 'Flea Market'],
  'chill':    ['Café', 'Beer Garden', 'Bookstore', 'Park'],
};

// ── JACCARD SIMILARITY ────────────────────────────────────────────────
function jaccard(setA, setB) {
  if (!setA.length || !setB.length) return 0;
  const a = new Set(setA.map(s => s.toLowerCase()));
  const b = new Set(setB.map(s => s.toLowerCase()));
  const intersection = [...a].filter(x => b.has(x)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

// ── CHECK IF SPOT IS OPEN ─────────────────────────────────────────────
function isSpotOpen(spot, availableFromMinutes) {
  if (!spot.hours) return true; // assume open if no hours
  const now = new Date();
  const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const today = dayNames[now.getDay()];
  const hours = spot.hours[today];
  if (!hours) return false;

  const [openStr, closeStr] = hours.split('-');
  const [openH, openM] = openStr.split(':').map(Number);
  const [closeH, closeM] = closeStr.split(':').map(Number);

  const openMins  = openH * 60 + (openM || 0);
  const closeMins = closeH * 60 + (closeM || 0);

  // Check if the spot will be open when the group is available
  return availableFromMinutes >= openMins && availableFromMinutes < closeMins - 30;
}

// ── SCORE A SINGLE SPOT ───────────────────────────────────────────────
function scoreSpot(spot, composite, groupActivities, visitedSpotIds, lovedSpotIds, isWildcard = false) {
  const v = composite.vector;
  let score = 0;

  // 1. Energy match (inverted distance)
  const energyDiff = Math.abs(spot.energyScore - v.energyLevel);
  score += (1 - energyDiff) * SCORE_WEIGHTS.energyMatch;

  // 2. Vibe tag overlap (Jaccard)
  const topVibes = getTopVibeTagsFromVector(v);
  const vibeScore = jaccard(spot.vibeTags || [], topVibes);
  score += vibeScore * SCORE_WEIGHTS.vibeTagOverlap;

  // 3. Category affinity
  let categoryMatch = 0;
  for (const activity of groupActivities) {
    const cats = ACTIVITY_TO_CATEGORY[activity.toLowerCase()] || [];
    if (cats.includes(spot.category)) { categoryMatch = 1; break; }
  }
  score += categoryMatch * SCORE_WEIGHTS.categoryAffinity;

  // 4. Social fit
  const socialDiff = Math.abs(spot.socialScore - v.socialOpenness);
  score += (1 - socialDiff) * SCORE_WEIGHTS.socialFit;

  // 5. Prior visit / loved bonus
  if (lovedSpotIds.includes(spot.id)) {
    score += 0.15; // loved = highest bonus
  } else if (visitedSpotIds.includes(spot.id)) {
    score += 0.05; // visited but no strong reaction
  }

  // 6. Freshness bonus (spots not visited recently)
  const daysSinceVerified = (Date.now() - new Date(spot.lastVerifiedAt)) / (1000 * 60 * 60 * 24);
  if (!visitedSpotIds.includes(spot.id) && daysSinceVerified < 90) {
    score += 0.05 * SCORE_WEIGHTS.freshnessBonus;
  }

  // 7. Wildcard random offset
  if (isWildcard) {
    score += Math.random() * 0.1;
  }

  return Math.min(1.0, score);
}

// ── DERIVE TOP VIBE TAGS FROM VECTOR ─────────────────────────────────
function getTopVibeTagsFromVector(v) {
  const tags = [];
  if (v.energyLevel > 0.65)     tags.push('lively', 'high energy');
  if (v.energyLevel < 0.4)      tags.push('cozy', 'chill', 'low-key');
  if (v.culturalAppetite > 0.65) tags.push('hidden gem', 'underground', 'avant-garde', 'creative');
  if (v.outdoorPreference > 0.6) tags.push('outdoor');
  if (v.nightOwlScore > 0.65)   tags.push('late night');
  if (v.socialOpenness > 0.65)  tags.push('social', 'group-friendly');
  if (v.spontaneity > 0.65)     tags.push('spontaneous');
  if (v.foodPriority > 0.65)    tags.push('foodie');
  return tags;
}

// ── FILTER ELIGIBLE SPOTS ─────────────────────────────────────────────
function filterEligibleSpots(spots, composite) {
  const { effectiveBudget, availableFromMinutes } = composite.constraints;
  return spots.filter(spot => {
    // Budget check: price_tier * ~$15 avg spend per tier
    const estimatedCost = spot.priceTier * 15;
    if (estimatedCost > effectiveBudget * 1.2) return false;

    // Hours check
    if (!isSpotOpen(spot, availableFromMinutes || 19 * 60)) return false;

    // Group size check
    const memberCount = composite.memberCount || 3;
    if (memberCount < spot.groupSizeMin || memberCount > spot.groupSizeMax) return false;

    return true;
  });
}

// ── CALCULATE DISTANCE (Haversine) ───────────────────────────────────
function distanceMiles(lat1, lng1, lat2, lng2) {
  const R = 3958.8;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── ASSEMBLE ITINERARY ────────────────────────────────────────────────
function assembleItinerary(primarySpot, allScoredSpots, composite, usedSpotIds = new Set()) {
  const stops = [primarySpot];
  usedSpotIds.add(primarySpot.id);

  const { availableFromMinutes } = composite.constraints;
  const availableHours = ((23 * 60) - (availableFromMinutes || 19 * 60)) / 60;
  const maxStops = availableHours >= 2.5 ? 3 : 2;

  // Stop 2: food/drinks anchor
  if (stops.length < maxStops) {
    const foodCategories = ['Restaurant', 'Café', 'Beer Garden', 'Food Market'];
    const foodSpot = allScoredSpots
      .filter(s => !usedSpotIds.has(s.spot.id) && foodCategories.includes(s.spot.category))
      .sort((a, b) => {
        // Prefer nearby food spots
        const distA = primarySpot.lat ? distanceMiles(primarySpot.lat, primarySpot.lng, a.spot.lat, a.spot.lng) : 999;
        const distB = primarySpot.lat ? distanceMiles(primarySpot.lat, primarySpot.lng, b.spot.lat, b.spot.lng) : 999;
        return (distA * 0.4 + (1 - a.score) * 0.6) - (distB * 0.4 + (1 - b.score) * 0.6);
      })[0];

    if (foodSpot) {
      stops.push(foodSpot.spot);
      usedSpotIds.add(foodSpot.spot.id);
    }
  }

  // Stop 3: wind-down (only if time allows)
  if (stops.length < maxStops && maxStops === 3) {
    const windDownCategories = ['Café', 'Beer Garden', 'Bar', 'Bookstore'];
    const windDown = allScoredSpots
      .filter(s => !usedSpotIds.has(s.spot.id) && windDownCategories.includes(s.spot.category) && s.spot.energyScore < 0.5)
      .sort((a, b) => b.score - a.score)[0];

    if (windDown) {
      stops.push(windDown.spot);
      usedSpotIds.add(windDown.spot.id);
    }
  }

  // Check walkability
  const isWalkable = stops.length > 1 && stops.every((s, i) => {
    if (i === 0) return true;
    return distanceMiles(stops[0].lat, stops[0].lng, s.lat, s.lng) < 0.75;
  });

  const totalDuration = stops.reduce((sum, s) => sum + (s.visitDuration || 90), 0);

  return { stops, isWalkable, totalDuration };
}

// ── GENERATE 3 PLAN OPTIONS ───────────────────────────────────────────
async function generatePlanOptions(composite, options = {}) {
  const {
    cityFilter,
    radiusMiles = 3,
    centerLat,
    centerLng,
    groupActivities = [],
    visitedSpotIds = [],
    lovedSpotIds = [],
  } = options;

  // Fetch spots from DB
  const whereClause = {
    isActive: true,
    ...(cityFilter ? { city: { contains: cityFilter, mode: 'insensitive' } } : {}),
  };

  const spots = await prisma.spot.findMany({ where: whereClause });

  // Filter by radius if coords provided
  const nearbySpots = centerLat && centerLng
    ? spots.filter(s => distanceMiles(centerLat, centerLng, s.lat, s.lng) <= radiusMiles)
    : spots;

  // Filter eligible
  const eligible = filterEligibleSpots(nearbySpots, composite);
  if (eligible.length < 3) {
    throw new Error('Not enough spots available for this group. Try expanding your search radius or adjusting filters.');
  }

  // Score all eligible spots
  const scored = eligible.map((spot, idx) => ({
    spot,
    score: scoreSpot(spot, composite, groupActivities, visitedSpotIds, lovedSpotIds),
    wildcardScore: scoreSpot(spot, composite, groupActivities, visitedSpotIds, lovedSpotIds, true),
  })).sort((a, b) => b.score - a.score);

  // ── OPTION 1: Best composite match ──
  const option1Primary = scored[0].spot;
  const option1 = assembleItinerary(option1Primary, scored, composite, new Set([option1Primary.id]));

  // ── OPTION 2: Budget-optimised variant ──
  const budgetScored = eligible
    .filter(s => s.id !== option1Primary.id)
    .map(spot => ({
      spot,
      score: scoreSpot(spot, composite, groupActivities, visitedSpotIds, lovedSpotIds) * (1 / (spot.priceTier || 1)),
    }))
    .sort((a, b) => b.score - a.score);

  const option2Primary = budgetScored[0]?.spot || scored[1]?.spot;
  const option2UsedIds = new Set([option2Primary.id]);
  // Diversity penalty: avoid spots already in option 1
  option1.stops.forEach(s => option2UsedIds.add(s.id));
  const option2 = assembleItinerary(option2Primary, scored, composite, option2UsedIds);

  // ── OPTION 3: Wildcard / spontaneity variant ──
  const wildcardScored = scored
    .filter(s => s.spot.id !== option1Primary.id && s.spot.id !== option2Primary.id)
    .sort((a, b) => b.wildcardScore - a.wildcardScore);

  const option3Primary = wildcardScored[0]?.spot || scored[2]?.spot;
  const option3UsedIds = new Set([...option1.stops.map(s => s.id), ...option2.stops.map(s => s.id), option3Primary.id]);
  const option3 = assembleItinerary(option3Primary, scored, composite, option3UsedIds);

  return [
    { ...option1, label: 'Best match',       index: 0, voteCount: 0 },
    { ...option2, label: 'Budget-friendly',  index: 1, voteCount: 0 },
    { ...option3, label: 'Wildcard night',   index: 2, voteCount: 0 },
  ];
}

module.exports = { generatePlanOptions, scoreSpot, filterEligibleSpots, buildGroupComposite: null };
