// ─────────────────────────────────────────────────────────────────────
// rendezvous-engine/src/feedback/feedbackLoop.js
// Processes post-outing feedback and scroll behavior to update
// taste vectors. Implements signal decay and seasonal correction.
// ─────────────────────────────────────────────────────────────────────
const { apply, clampVector, decayMultiplier } = require('../utils/vector');
const { FEEDBACK_NUDGE, DECAY, VIBE_MAP, ACTIVITY_MAP } = require('../config');

// ── EXPLICIT REACTION PROCESSOR ───────────────────────────────────────
/**
 * Process explicit post-outing reactions (heart / repeat).
 * reactions: [{ spotId, spotAttributes, reactionType, timestamp }]
 * currentVector: user's current taste vector
 * Returns: { vector, nudges: number }
 */
function processExplicitReactions(reactions, currentVector) {
  if (!reactions?.length) return { vector: currentVector, nudges: 0 };

  let vector = { ...currentVector };
  let nudgeCount = 0;

  for (const reaction of reactions) {
    const nudgeStrength = FEEDBACK_NUDGE[reaction.reactionType?.toLowerCase()] || 0;
    if (nudgeStrength === 0) continue;

    const attrs = reaction.spotAttributes;
    if (!attrs) continue;

    // Apply decay based on when the reaction happened
    const ageDays = reaction.timestamp
      ? (Date.now() - new Date(reaction.timestamp).getTime()) / (1000 * 60 * 60 * 24)
      : 0;
    const decayFactor = decayMultiplier(ageDays, DECAY.halfLifeDays.feedback, DECAY.minWeight);
    const effectiveNudge = nudgeStrength * decayFactor;

    // Nudge energy level toward the spot's energy
    if (attrs.energyScore !== undefined) {
      const energyDiff = attrs.energyScore - vector.energyLevel;
      vector.energyLevel = Math.max(0, Math.min(1, vector.energyLevel + energyDiff * effectiveNudge));
    }

    // Nudge social openness
    if (attrs.socialDensity !== undefined) {
      const socialDiff = attrs.socialDensity - vector.socialOpenness;
      vector.socialOpenness = Math.max(0, Math.min(1, vector.socialOpenness + socialDiff * effectiveNudge));
    }

    // Nudge based on vibe tags
    if (attrs.vibeTags?.length) {
      for (const tag of attrs.vibeTags) {
        const tagAdj = VIBE_MAP[tag.toLowerCase()];
        if (tagAdj) {
          for (const [dim, delta] of Object.entries(tagAdj)) {
            if (vector[dim] !== undefined) {
              vector[dim] = Math.max(0, Math.min(1, vector[dim] + delta * effectiveNudge * 0.6));
            }
          }
        }
      }
    }

    // Nudge cultural appetite based on novelty score
    if (attrs.noveltyScore !== undefined) {
      const noveltyDiff = attrs.noveltyScore - vector.noveltyAppetite;
      vector.noveltyAppetite = Math.max(0, Math.min(1, vector.noveltyAppetite + noveltyDiff * effectiveNudge * 0.5));
    }

    // Adjust night owl score based on when the reaction was (late night visit = night owl signal)
    if (reaction.timestamp) {
      const visitHour = new Date(reaction.timestamp).getHours();
      if (visitHour >= 22 || visitHour <= 3) {
        vector.nightOwlScore = Math.min(1, vector.nightOwlScore + effectiveNudge * 0.3);
      }
    }

    nudgeCount++;
  }

  return { vector: clampVector(vector), nudges: nudgeCount };
}

// ── PASSIVE BEHAVIORAL SIGNAL PROCESSOR ───────────────────────────────
/**
 * Process passive behavioral signals (saves, views, skips, revisits).
 * signals: [{ type, spotId, spotAttributes, timestamp, durationMs? }]
 *   type: 'saved' | 'addedToParty' | 'memoryPosted' | 'revisited' |
 *         'scrolledPast' | 'negativeVote'
 */
function processPassiveBehavior(signals, currentVector) {
  if (!signals?.length) return { vector: currentVector, nudges: 0 };

  let vector = { ...currentVector };
  let nudgeCount = 0;

  for (const signal of signals) {
    const nudgeStrength = FEEDBACK_NUDGE[signal.type] || 0;
    if (nudgeStrength === 0) continue;

    // Scrolled past accumulates over multiple sessions — only apply after 3+ instances
    if (signal.type === 'scrolledPast' && (signal.count || 1) < 3) continue;

    const attrs = signal.spotAttributes;
    if (!attrs) continue;

    const ageDays = signal.timestamp
      ? (Date.now() - new Date(signal.timestamp).getTime()) / (1000 * 60 * 60 * 24)
      : 0;
    const decayFactor = decayMultiplier(ageDays, DECAY.halfLifeDays.behavioral, DECAY.minWeight);
    const effectiveNudge = Math.abs(nudgeStrength) * decayFactor;
    const isPositive = nudgeStrength > 0;

    if (attrs.energyScore !== undefined) {
      const direction = isPositive ? 1 : -1;
      const energyDiff = (attrs.energyScore - vector.energyLevel) * effectiveNudge * direction;
      vector.energyLevel = Math.max(0, Math.min(1, vector.energyLevel + energyDiff));
    }

    if (attrs.vibeTags?.length && isPositive) {
      for (const tag of attrs.vibeTags) {
        const tagAdj = VIBE_MAP[tag.toLowerCase()];
        if (tagAdj) {
          for (const [dim, delta] of Object.entries(tagAdj)) {
            if (vector[dim] !== undefined) {
              vector[dim] = Math.max(0, Math.min(1, vector[dim] + delta * effectiveNudge * 0.4));
            }
          }
        }
      }
    }

    // Category affinity adjustment
    if (attrs.category && isPositive) {
      // Find which activity this category maps to and nudge accordingly
      for (const [activity, cats] of Object.entries(require('../config').ACTIVITY_TO_SPOT_CATEGORY)) {
        if (cats.includes(attrs.category)) {
          const actAdj = ACTIVITY_MAP[activity];
          if (actAdj) {
            for (const [dim, delta] of Object.entries(actAdj)) {
              if (vector[dim] !== undefined) {
                vector[dim] = Math.max(0, Math.min(1, vector[dim] + delta * effectiveNudge * 0.3));
              }
            }
          }
          break;
        }
      }
    }

    nudgeCount++;
  }

  return { vector: clampVector(vector), nudges: nudgeCount };
}

// ── BATCH FEEDBACK PROCESSOR ──────────────────────────────────────────
/**
 * Process a batch of feedback for weekly profile updates.
 * This is the main entry point called by the weekly cron job.
 *
 * profile: full user taste profile from DB
 * feedbackBatch: {
 *   explicitReactions: [...],
 *   passiveSignals: [...],
 *   historicalFeedback: [...],  // for seasonal correction
 * }
 */
function processFeedbackBatch(profile, feedbackBatch) {
  const currentVector = {
    energyLevel:       profile.energyLevel,
    socialOpenness:    profile.socialOpenness,
    spontaneity:       profile.spontaneity,
    culturalAppetite:  profile.culturalAppetite,
    foodPriority:      profile.foodPriority,
    outdoorPreference: profile.outdoorPreference,
    budgetSensitivity: profile.budgetSensitivity,
    nightOwlScore:     profile.nightOwlScore,
    activityDiversity: profile.activityDiversity,
    noveltyAppetite:   profile.noveltyAppetite || 0.5,
    groupSizePref:     profile.groupSizePref || 0.5,
    physicalEnergy:    profile.physicalEnergy || 0.5,
  };

  let vector = { ...currentVector };
  let totalNudges = 0;

  // Process explicit reactions
  if (feedbackBatch.explicitReactions?.length) {
    const { vector: v1, nudges: n1 } = processExplicitReactions(feedbackBatch.explicitReactions, vector);
    vector = v1;
    totalNudges += n1;
  }

  // Process passive behavioral signals
  if (feedbackBatch.passiveSignals?.length) {
    const { vector: v2, nudges: n2 } = processPassiveBehavior(feedbackBatch.passiveSignals, vector);
    vector = v2;
    totalNudges += n2;
  }

  // Apply seasonal correction
  if (feedbackBatch.historicalFeedback?.length) {
    const { applySeasonalCorrection } = require('../vector/profileBuilder');
    vector = applySeasonalCorrection(vector, feedbackBatch.historicalFeedback, new Date().getMonth());
  }

  return {
    updatedVector: clampVector(vector),
    nudgesApplied: totalNudges,
    changed:       JSON.stringify(vector) !== JSON.stringify(currentVector),
  };
}

// ── SPOT SUPPRESSION TRACKER ──────────────────────────────────────────
/**
 * Determine which spots should be suppressed from suggestions.
 * Called before plan generation to exclude repeatedly-skipped spots.
 *
 * spotHistory: [{ spotId, suggestedCount, lastSuggestedAt, reactions: [] }]
 * Returns: Set of spotIds to suppress
 */
function getSuppressedSpotIds(spotHistory) {
  const suppressed = new Set();
  const now = Date.now();

  for (const history of spotHistory) {
    if (history.suggestedCount < FEEDBACK_NUDGE.suppressAfterNSuggestions) continue;

    const daysSince = history.lastSuggestedAt
      ? (now - new Date(history.lastSuggestedAt).getTime()) / (1000 * 60 * 60 * 24)
      : 999;

    if (daysSince < FEEDBACK_NUDGE.suppressDays) {
      // Check if it was explicitly loved — loved spots are never suppressed
      const hasPositiveReaction = history.reactions?.some(r =>
        r.reactionType === 'HEART' || r.reactionType === 'REPEAT'
      );
      if (!hasPositiveReaction) {
        suppressed.add(history.spotId);
      }
    }
  }

  return suppressed;
}

// ── FEEDBACK STATS ────────────────────────────────────────────────────
/**
 * Compute feedback statistics for a user over a time window.
 * Used for analytics and algorithm tuning.
 */
function computeFeedbackStats(reactions, windowDays = 90) {
  const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
  const recent = reactions.filter(r => new Date(r.timestamp).getTime() > cutoff);

  const hearts   = recent.filter(r => r.reactionType === 'HEART').length;
  const repeats  = recent.filter(r => r.reactionType === 'REPEAT').length;
  const total    = recent.length;

  // Category breakdown of loved spots
  const categoryLove = {};
  for (const r of recent.filter(r => r.reactionType === 'HEART')) {
    const cat = r.spotAttributes?.category;
    if (cat) categoryLove[cat] = (categoryLove[cat] || 0) + 1;
  }

  return {
    totalReactions:    total,
    hearts,
    repeats,
    heartRate:         total > 0 ? (hearts / total) : 0,
    repeatRate:        total > 0 ? (repeats / total) : 0,
    topLovedCategories: Object.entries(categoryLove).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([cat]) => cat),
    windowDays,
  };
}

module.exports = {
  processExplicitReactions,
  processPassiveBehavior,
  processFeedbackBatch,
  getSuppressedSpotIds,
  computeFeedbackStats,
};
