// ─────────────────────────────────────────────────────────────────────
// rendezvous-engine/src/vector/profileBuilder.js
// ENGINE 1 — Personal Profile Engine
//
// Builds and maintains each user's taste vector from all available
// signal sources. Handles cold start, signal decay, and event-driven
// rebuilds. This is the core of Engine 1.
// ─────────────────────────────────────────────────────────────────────
const { neutral, apply, clampVector, weightedMean, applyDecay, decayMultiplier } = require('../utils/vector');
const { SIGNAL_WEIGHTS, COLD_START, DECAY, VECTOR_DIMS } = require('../config');
const { processSpotifySignals }   = require('../signals/spotify');
const { processInstagramSignals } = require('../signals/social');
const { processPinterestSignals, processTikTokSignals } = require('../signals/social');
const { processMBTI }             = require('../signals/mbti');
const { processSurveyActivities, processSurveyVibes, processSurveyBudget } = require('../signals/mbti');

// ── CONFIDENCE CALCULATOR ─────────────────────────────────────────────
/**
 * Compute overall profile confidence (0.0–1.0) from available data.
 * Higher confidence = more personalized feed, more accurate matching.
 */
function computeConfidence(profile) {
  let score = 0;

  // App connections
  if (profile.spotifySignals)       score += COLD_START.confidenceContributions.spotify;
  if (profile.instagramSignals)     score += COLD_START.confidenceContributions.instagram;
  if (profile.mbtiType)             score += COLD_START.confidenceContributions.mbti;
  if (profile.tiktokSignals)        score += COLD_START.confidenceContributions.tiktok;
  if (profile.pinterestSignals)     score += COLD_START.confidenceContributions.pinterest;

  // Survey completeness
  if (profile.activities?.length > 2)  score += COLD_START.confidenceContributions.survey * 0.6;
  if (profile.vibeTags?.length > 0)    score += COLD_START.confidenceContributions.survey * 0.4;

  // Scroll behavior (passed in separately)
  if (profile.scrollEventCount > 0) {
    const scrollContrib = Math.min(
      COLD_START.confidenceContributions.scrollBehavior,
      profile.scrollEventCount * 0.01
    );
    score += scrollContrib;
  }

  return Math.min(1.0, score);
}

// ── COLD START DETECTION ──────────────────────────────────────────────
/**
 * Determine if a user is in cold start mode.
 * Returns: { isColdStart, progressPercent, missingSignals }
 */
function getColdStartStatus(profile) {
  const confidence = computeConfidence(profile);
  const isColdStart = confidence < COLD_START.minConfidenceThreshold;
  const progressPercent = Math.round(confidence * 100);

  const missingSignals = [];
  if (!profile.spotifySignals)    missingSignals.push({ provider: 'spotify',   weight: COLD_START.confidenceContributions.spotify });
  if (!profile.instagramSignals)  missingSignals.push({ provider: 'instagram', weight: COLD_START.confidenceContributions.instagram });
  if (!profile.mbtiType)          missingSignals.push({ provider: 'mbti',      weight: COLD_START.confidenceContributions.mbti });
  if (!profile.tiktokSignals)     missingSignals.push({ provider: 'tiktok',    weight: COLD_START.confidenceContributions.tiktok });
  if (!profile.pinterestSignals)  missingSignals.push({ provider: 'pinterest', weight: COLD_START.confidenceContributions.pinterest });

  // Sort by which signal would add the most confidence
  missingSignals.sort((a, b) => b.weight - a.weight);

  return { isColdStart, progressPercent, confidence, missingSignals, topRecommendation: missingSignals[0]?.provider };
}

// ── DECAY-WEIGHTED SIGNAL ASSEMBLY ────────────────────────────────────
/**
 * Assemble all signals with decay weighting into a final taste vector.
 * profile: full taste profile from database
 * Returns: { vector, confidence, signalBreakdown }
 */
function buildTasteVector(profile) {
  const base     = neutral();
  const signalBreakdown = {};
  let totalConfidence = 0;

  // Helper: process one signal source and track its contribution
  function processSignal(name, processor, rawSignals, updatedAt) {
    const { adjustments, confidence } = processor(rawSignals);
    if (!Object.keys(adjustments).length) return;

    // Apply time decay
    const ageDays = updatedAt
      ? (Date.now() - new Date(updatedAt).getTime()) / (1000 * 60 * 60 * 24)
      : 0;
    const halfLife = DECAY.halfLifeDays[name] || 90;
    const decayFactor = decayMultiplier(ageDays, halfLife, DECAY.minWeight);

    // Scale adjustments by decay
    const decayed = {};
    for (const [dim, delta] of Object.entries(adjustments)) {
      decayed[dim] = delta * decayFactor;
    }

    // Apply to base vector
    Object.assign(base, apply(base, decayed));

    const effectiveConfidence = confidence * decayFactor;
    signalBreakdown[name] = { confidence: effectiveConfidence, decayFactor, ageDays: Math.round(ageDays) };
    totalConfidence += effectiveConfidence;
  }

  // Process signals in hierarchy order
  // 1. Spotify (weight 0.30)
  if (profile.spotifySignals) {
    processSignal('spotify', processSpotifySignals, profile.spotifySignals, profile.spotifyUpdatedAt);
  }

  // 2. Instagram (weight 0.22)
  if (profile.instagramSignals) {
    processSignal('instagram', processInstagramSignals, profile.instagramSignals, profile.instagramUpdatedAt);
  }

  // 3. MBTI (weight 0.18)
  if (profile.mbtiType) {
    const mbtiProcessor = (signals) => processMBTI(signals.type, signals.source);
    processSignal('mbti', mbtiProcessor, { type: profile.mbtiType, source: profile.mbtiSource }, profile.mbtiUpdatedAt);
  }

  // 4. TikTok (weight 0.14)
  if (profile.tiktokSignals) {
    processSignal('tiktok', processTikTokSignals, profile.tiktokSignals, profile.tiktokUpdatedAt);
  }

  // 5. Pinterest (weight 0.10)
  if (profile.pinterestSignals) {
    processSignal('pinterest', processPinterestSignals, profile.pinterestSignals, profile.pinterestUpdatedAt);
  }

  // 6. In-app survey (weight 0.06)
  if (profile.activities?.length || profile.vibeTags?.length || profile.budgetMax !== undefined) {
    const { adjustments: actAdj } = processSurveyActivities(profile.activities);
    const { adjustments: vibeAdj } = processSurveyVibes(profile.vibeTags);
    const { adjustments: budgetAdj } = processSurveyBudget(profile.budgetMax);
    const surveyAdj = {};
    for (const adj of [actAdj, vibeAdj, budgetAdj]) {
      for (const [dim, delta] of Object.entries(adj)) {
        surveyAdj[dim] = (surveyAdj[dim] || 0) + delta;
      }
    }
    Object.assign(base, apply(base, surveyAdj));
    signalBreakdown['survey'] = { confidence: 0.06 };
    totalConfidence += 0.06;
  }

  const confidence = computeConfidence({ ...profile });
  const vector = clampVector(base);

  return { vector, confidence, signalBreakdown };
}

// ── EVENT-DRIVEN REBUILD ──────────────────────────────────────────────
/**
 * Determine which dimensions to rebuild when a specific event occurs.
 * Returns rebuild priority: 'full' | 'partial' | 'lightweight'
 */
function getRebuildScope(triggerEvent) {
  const FULL_REBUILD = ['spotify_sync', 'instagram_sync', 'mbti_updated', 'tiktok_sync', 'pinterest_sync'];
  const PARTIAL_REBUILD = ['survey_updated', 'scroll_behavior_batch'];
  const LIGHTWEIGHT = ['spot_saved', 'spot_viewed', 'feedback_submitted'];

  if (FULL_REBUILD.includes(triggerEvent))    return 'full';
  if (PARTIAL_REBUILD.includes(triggerEvent)) return 'partial';
  if (LIGHTWEIGHT.includes(triggerEvent))     return 'lightweight';
  return 'full';
}

// ── SCROLL BEHAVIOR PROCESSOR ─────────────────────────────────────────
/**
 * Process scroll interaction events into lightweight vector nudges.
 * Used for cold start profile building via the Discover feed.
 *
 * events: [{ spotId, spotAttributes, eventType, durationMs, timestamp }]
 * eventType: 'view' | 'save' | 'skip' | 'tap'
 */
function processScrollBehavior(events, currentVector) {
  if (!events?.length) return { vector: currentVector, nudges: 0 };

  let vector = { ...currentVector };
  let nudgeCount = 0;

  for (const event of events) {
    const attrs = event.spotAttributes;
    if (!attrs) continue;

    let nudgeStrength = 0;
    let positive = true;

    switch (event.eventType) {
      case 'save':
        nudgeStrength = 0.03;
        break;
      case 'tap':
        // Time spent viewing — longer = stronger positive signal
        nudgeStrength = Math.min(0.025, (event.durationMs || 0) / 60000 * 0.02);
        break;
      case 'view':
        nudgeStrength = Math.min(0.015, (event.durationMs || 0) / 30000 * 0.01);
        break;
      case 'skip':
        nudgeStrength = 0.008;
        positive = false;
        break;
    }

    if (nudgeStrength > 0 && attrs.energyScore !== undefined) {
      const direction = positive ? 1 : -1;
      // Nudge energyLevel toward the spot's energy
      const energyDiff = (attrs.energyScore - vector.energyLevel) * nudgeStrength * direction;
      vector.energyLevel = Math.max(0, Math.min(1, vector.energyLevel + energyDiff));

      // Apply vibe tag adjustments
      if (attrs.vibeTags && positive) {
        const { VIBE_MAP } = require('../config');
        for (const tag of attrs.vibeTags) {
          const tagAdj = VIBE_MAP[tag.toLowerCase()];
          if (tagAdj) {
            for (const [dim, delta] of Object.entries(tagAdj)) {
              if (vector[dim] !== undefined) {
                vector[dim] = Math.max(0, Math.min(1, vector[dim] + delta * nudgeStrength * 0.5));
              }
            }
          }
        }
      }

      nudgeCount++;
    }
  }

  return { vector: clampVector(vector), nudges: nudgeCount };
}

// ── SEASONAL CORRECTION ───────────────────────────────────────────────
/**
 * Detect seasonal patterns in historical feedback and apply corrections.
 * historicalFeedback: [{ timestamp, spotAttributes, reactionType }]
 * currentMonth: 0–11
 */
function applySeasonalCorrection(vector, historicalFeedback, currentMonth) {
  if (!historicalFeedback?.length) return vector;

  // Group feedback by season
  const SEASONS = {
    spring: [2, 3, 4],
    summer: [5, 6, 7],
    fall:   [8, 9, 10],
    winter: [11, 0, 1],
  };

  const currentSeason = Object.entries(SEASONS).find(([, months]) => months.includes(currentMonth))?.[0];
  if (!currentSeason) return vector;

  // Compute outdoor preference by season
  const seasonalOutdoor = {};
  for (const feedback of historicalFeedback) {
    const month = new Date(feedback.timestamp).getMonth();
    const season = Object.entries(SEASONS).find(([, months]) => months.includes(month))?.[0];
    if (!season || feedback.reactionType !== 'HEART') continue;
    if (!seasonalOutdoor[season]) seasonalOutdoor[season] = [];
    seasonalOutdoor[season].push(feedback.spotAttributes?.energyScore || 0.5);
  }

  const currentSeasonData = seasonalOutdoor[currentSeason];
  if (!currentSeasonData?.length) return vector;

  const avgEnergy = currentSeasonData.reduce((s, v) => s + v, 0) / currentSeasonData.length;
  const corrected = { ...vector };

  // Gentle seasonal nudge — not a full override
  corrected.energyLevel = Math.max(0, Math.min(1, vector.energyLevel * 0.85 + avgEnergy * 0.15));

  // Summer → outdoor boost
  if (currentSeason === 'summer') {
    corrected.outdoorPreference = Math.min(1, vector.outdoorPreference + 0.05);
  } else if (currentSeason === 'winter') {
    corrected.outdoorPreference = Math.max(0, vector.outdoorPreference - 0.05);
  }

  return clampVector(corrected);
}

module.exports = {
  buildTasteVector,
  computeConfidence,
  getColdStartStatus,
  getRebuildScope,
  processScrollBehavior,
  applySeasonalCorrection,
};
