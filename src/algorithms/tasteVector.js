// Rendezvous — Taste Vector Algorithm
// Converts raw signals (survey, MBTI, app data) into a normalised taste vector

// ── CONSTANTS ─────────────────────────────────────────────────────────
const MBTI_ADJUSTMENTS = {
  E: { socialOpenness: +0.30, energyLevel: +0.20 },
  I: { socialOpenness: -0.30, culturalAppetite: +0.10 },
  S: { foodPriority: +0.20, spontaneity: -0.10 },
  N: { culturalAppetite: +0.20, spontaneity: +0.10 },
  T: { activityDiversity: +0.10 },
  F: { culturalAppetite: +0.20, outdoorPreference: +0.10 },
  J: { spontaneity: -0.30 },
  P: { spontaneity: +0.30, activityDiversity: +0.10 },
};

const ACTIVITY_VECTOR_MAP = {
  'food':         { foodPriority: +0.3, socialOpenness: +0.1 },
  'music':        { energyLevel: +0.2, culturalAppetite: +0.2, nightOwlScore: +0.1 },
  'thrifting':    { culturalAppetite: +0.15, activityDiversity: +0.1 },
  'art':          { culturalAppetite: +0.3 },
  'outdoor':      { outdoorPreference: +0.4, energyLevel: +0.1 },
  'gaming':       { socialOpenness: +0.1, activityDiversity: +0.2 },
  'movies':       { activityDiversity: +0.1 },
  'events':       { spontaneity: +0.2, socialOpenness: +0.15 },
  'sports':       { energyLevel: +0.3, outdoorPreference: +0.2 },
  'chill':        { energyLevel: -0.2, spontaneity: -0.1 },
  'comics':       { culturalAppetite: +0.15 },
  'markets':      { culturalAppetite: +0.1, socialOpenness: +0.1, outdoorPreference: +0.1 },
  'comedy':       { socialOpenness: +0.2, energyLevel: +0.1 },
  'late-night':   { nightOwlScore: +0.3, spontaneity: +0.1 },
  'coffee':       { culturalAppetite: +0.1, energyLevel: -0.1 },
  'dance':        { energyLevel: +0.3, socialOpenness: +0.2, nightOwlScore: +0.2 },
};

const VIBE_VECTOR_MAP = {
  'chill':       { energyLevel: -0.2, spontaneity: -0.1 },
  'spontaneous': { spontaneity: +0.35 },
  'adventurous': { spontaneity: +0.2, activityDiversity: +0.2, outdoorPreference: +0.1 },
  'outdoors':    { outdoorPreference: +0.35 },
  'social':      { socialOpenness: +0.3, energyLevel: +0.1 },
  'indoors':     { outdoorPreference: -0.25 },
};

// ── HELPERS ───────────────────────────────────────────────────────────
function clamp(val) {
  return Math.max(0.0, Math.min(1.0, val));
}

function emptyVector() {
  return {
    energyLevel: 0.5,
    socialOpenness: 0.5,
    spontaneity: 0.5,
    culturalAppetite: 0.5,
    foodPriority: 0.5,
    outdoorPreference: 0.5,
    budgetSensitivity: 0.5,
    nightOwlScore: 0.5,
    activityDiversity: 0.5,
  };
}

function applyAdjustments(vector, adjustments) {
  const result = { ...vector };
  for (const [dim, delta] of Object.entries(adjustments)) {
    if (result[dim] !== undefined) {
      result[dim] = clamp(result[dim] + delta);
    }
  }
  return result;
}

// ── MBTI → VECTOR ─────────────────────────────────────────────────────
function applyMBTI(vector, mbtiType) {
  if (!mbtiType || mbtiType.length !== 4) return vector;
  let result = { ...vector };
  const type = mbtiType.toUpperCase();
  for (const letter of type) {
    if (MBTI_ADJUSTMENTS[letter]) {
      result = applyAdjustments(result, MBTI_ADJUSTMENTS[letter]);
    }
  }
  return result;
}

// ── SURVEY → VECTOR ───────────────────────────────────────────────────
function applyActivityChips(vector, activities = []) {
  let result = { ...vector };
  for (const activity of activities) {
    const key = activity.toLowerCase().replace(/[^a-z-]/g, '');
    const adjustments = ACTIVITY_VECTOR_MAP[key];
    if (adjustments) {
      result = applyAdjustments(result, adjustments);
    }
  }
  // Diversity score: more activities = higher diversity
  result.activityDiversity = clamp(activities.length / 16);
  return result;
}

function applyVibeChips(vector, vibes = []) {
  let result = { ...vector };
  for (const vibe of vibes) {
    const key = vibe.toLowerCase();
    const adjustments = VIBE_VECTOR_MAP[key];
    if (adjustments) {
      result = applyAdjustments(result, adjustments);
    }
  }
  return result;
}

function applyBudget(vector, budgetMax = 50) {
  // Higher budget max = lower budget sensitivity
  const sensitivity = 1 - Math.min(1, budgetMax / 150);
  return { ...vector, budgetSensitivity: clamp(sensitivity) };
}

// ── SPOTIFY → VECTOR ──────────────────────────────────────────────────
function applySpotifySignals(vector, signals) {
  if (!signals) return vector;
  let result = { ...vector };

  // Audio features (0-1 scale from Spotify)
  if (signals.avgEnergy !== undefined) {
    result.energyLevel = clamp(result.energyLevel * 0.5 + signals.avgEnergy * 0.5);
  }
  if (signals.avgValence !== undefined) {
    // High valence (happy) → more social
    result.socialOpenness = clamp(result.socialOpenness + (signals.avgValence - 0.5) * 0.3);
  }
  if (signals.avgDanceability !== undefined) {
    result.nightOwlScore = clamp(result.nightOwlScore + signals.avgDanceability * 0.2);
    result.energyLevel = clamp(result.energyLevel + signals.avgDanceability * 0.15);
  }
  if (signals.avgAcousticness !== undefined) {
    // High acousticness → more chill, outdoor
    result.outdoorPreference = clamp(result.outdoorPreference + signals.avgAcousticness * 0.2);
    result.energyLevel = clamp(result.energyLevel - signals.avgAcousticness * 0.1);
  }

  // Genre signals
  if (signals.topGenres) {
    const genres = signals.topGenres.map(g => g.toLowerCase());
    if (genres.some(g => ['hip-hop', 'r&b', 'afrobeats', 'reggaeton', 'dancehall'].some(k => g.includes(k)))) {
      result.nightOwlScore   = clamp(result.nightOwlScore + 0.15);
      result.socialOpenness  = clamp(result.socialOpenness + 0.1);
      result.energyLevel     = clamp(result.energyLevel + 0.1);
    }
    if (genres.some(g => ['classical', 'jazz', 'blues', 'folk', 'acoustic'].some(k => g.includes(k)))) {
      result.culturalAppetite = clamp(result.culturalAppetite + 0.2);
      result.energyLevel      = clamp(result.energyLevel - 0.1);
    }
    if (genres.some(g => ['indie', 'alternative', 'art rock', 'experimental'].some(k => g.includes(k)))) {
      result.culturalAppetite = clamp(result.culturalAppetite + 0.15);
    }
    if (genres.some(g => ['lo-fi', 'ambient', 'chillhop'].some(k => g.includes(k)))) {
      result.energyLevel = clamp(result.energyLevel - 0.2);
    }
  }

  // Listening time of day
  if (signals.peakHour !== undefined) {
    if (signals.peakHour >= 22 || signals.peakHour <= 3) {
      result.nightOwlScore = clamp(result.nightOwlScore + 0.25);
    } else if (signals.peakHour >= 6 && signals.peakHour <= 11) {
      result.nightOwlScore = clamp(result.nightOwlScore - 0.15);
    }
  }

  return result;
}

// ── INSTAGRAM → VECTOR ────────────────────────────────────────────────
function applyInstagramSignals(vector, signals) {
  if (!signals) return vector;
  let result = { ...vector };

  if (signals.hashtagCategories) {
    for (const [category, count] of Object.entries(signals.hashtagCategories)) {
      const weight = Math.min(0.3, count * 0.05);
      const key = category.toLowerCase();
      if (ACTIVITY_VECTOR_MAP[key]) {
        for (const [dim, delta] of Object.entries(ACTIVITY_VECTOR_MAP[key])) {
          result[dim] = clamp(result[dim] + delta * weight);
        }
      }
    }
  }

  // Late night posts = night owl
  if (signals.lateNightPostRatio !== undefined) {
    result.nightOwlScore = clamp(result.nightOwlScore + signals.lateNightPostRatio * 0.3);
  }

  return result;
}

// ── PINTEREST → VECTOR ────────────────────────────────────────────────
function applyPinterestSignals(vector, signals) {
  if (!signals) return vector;
  let result = { ...vector };

  if (signals.boardCategories) {
    for (const [category, count] of Object.entries(signals.boardCategories)) {
      const weight = Math.min(0.25, count * 0.06);
      const key = category.toLowerCase();
      if (ACTIVITY_VECTOR_MAP[key]) {
        for (const [dim, delta] of Object.entries(ACTIVITY_VECTOR_MAP[key])) {
          result[dim] = clamp(result[dim] + delta * weight);
        }
      }
    }
  }

  // Travel boards → outdoor preference
  if (signals.hasTravelBoards) {
    result.outdoorPreference = clamp(result.outdoorPreference + 0.15);
    result.spontaneity       = clamp(result.spontaneity + 0.1);
  }

  return result;
}

// ── COMPUTE SIGNAL CONFIDENCE ──────────────────────────────────────────
function computeConfidence(tasteProfile) {
  let score = 0.1; // baseline for completing survey
  if (tasteProfile.activities?.length > 3)  score += 0.1;
  if (tasteProfile.vibeTags?.length > 0)    score += 0.05;
  if (tasteProfile.mbtiType)                score += 0.15;
  if (tasteProfile.spotifySignals)          score += 0.2;
  if (tasteProfile.appleMusicSignals)       score += 0.15;
  if (tasteProfile.instagramSignals)        score += 0.15;
  if (tasteProfile.tiktokSignals)           score += 0.1;
  if (tasteProfile.pinterestSignals)        score += 0.1;
  return Math.min(1.0, score);
}

// ── MAIN: BUILD TASTE VECTOR ──────────────────────────────────────────
function buildTasteVector(tasteProfile) {
  let vector = emptyVector();

  // 1. Apply survey responses
  vector = applyActivityChips(vector, tasteProfile.activities);
  vector = applyVibeChips(vector, tasteProfile.vibeTags);
  vector = applyBudget(vector, tasteProfile.budgetMax);

  // 2. Apply MBTI
  if (tasteProfile.mbtiType) {
    vector = applyMBTI(vector, tasteProfile.mbtiType);
  }

  // 3. Apply app signals (weighted by confidence)
  const confidence = computeConfidence(tasteProfile);
  const appWeight  = Math.min(0.8, confidence);
  const surveyWeight = 1 - appWeight;

  if (tasteProfile.spotifySignals) {
    const spotifyVector = applySpotifySignals({ ...emptyVector() }, tasteProfile.spotifySignals);
    for (const dim of Object.keys(vector)) {
      vector[dim] = clamp(vector[dim] * surveyWeight + spotifyVector[dim] * appWeight * 0.5);
    }
  }

  if (tasteProfile.instagramSignals) {
    vector = applyInstagramSignals(vector, tasteProfile.instagramSignals);
  }

  if (tasteProfile.pinterestSignals) {
    vector = applyPinterestSignals(vector, tasteProfile.pinterestSignals);
  }

  return { vector, confidence: computeConfidence(tasteProfile) };
}

// ── GROUP COMPOSITE VECTOR ────────────────────────────────────────────
function buildGroupComposite(members, tasteProfiles) {
  if (!members.length) return { vector: emptyVector(), constraints: {}, conflicts: [] };

  const vectors = members.map(member => {
    const profile = tasteProfiles.find(p => p.userId === member.userId);
    if (!profile) return emptyVector();

    let v = buildTasteVector(profile).vector;

    // Tonight overrides — these are session-specific adjustments
    if (member.energyLevel === 'low')    v.energyLevel = Math.max(0, v.energyLevel - 0.2);
    if (member.energyLevel === 'high')   v.energyLevel = Math.min(1, v.energyLevel + 0.2);

    // Budget sensitivity from tonight's stated budget
    if (member.budget) {
      v.budgetSensitivity = clamp(1 - member.budget / 100);
    }

    return v;
  });

  // Mean composite
  const composite = emptyVector();
  for (const dim of Object.keys(composite)) {
    composite[dim] = vectors.reduce((sum, v) => sum + (v[dim] || 0.5), 0) / vectors.length;
  }

  // Hard constraints
  const budgets = members.filter(m => m.budget).map(m => m.budget);
  const effectiveBudget = budgets.length ? Math.min(...budgets) : 50;

  // Availability window: all members must overlap
  const availTimes = members.filter(m => m.availableFrom).map(m => {
    const [h, min] = m.availableFrom.split(':').map(Number);
    return h * 60 + (min || 0);
  });
  const availableFromMinutes = availTimes.length ? Math.max(...availTimes) : 19 * 60;

  // Detect conflicts
  const conflicts = [];
  for (const dim of Object.keys(composite)) {
    const vals = vectors.map(v => v[dim]);
    const mean = composite[dim];
    const stdDev = Math.sqrt(vals.reduce((sum, v) => sum + (v - mean) ** 2, 0) / vals.length);
    if (stdDev > 0.25) {
      conflicts.push({ dimension: dim, stdDev: stdDev.toFixed(2) });
    }
  }

  return {
    vector: composite,
    constraints: { effectiveBudget, availableFromMinutes },
    conflicts,
    memberCount: members.length,
  };
}

// ── POST-OUTING FEEDBACK ──────────────────────────────────────────────
function applyFeedback(vector, reactions) {
  const result = { ...vector };
  for (const reaction of reactions) {
    const delta = reaction.type === 'HEART' ? 0.05 : reaction.type === 'REPEAT' ? 0.03 : -0.03;
    if (reaction.spotAttributes) {
      const attrs = reaction.spotAttributes;
      if (attrs.energyScore !== undefined) {
        // Nudge toward the energy of spots they liked
        result.energyLevel = clamp(result.energyLevel + (attrs.energyScore - result.energyLevel) * Math.abs(delta));
      }
      if (attrs.vibeTags) {
        for (const tag of attrs.vibeTags) {
          const key = tag.toLowerCase();
          if (VIBE_VECTOR_MAP[key]) {
            for (const [dim, adjustment] of Object.entries(VIBE_VECTOR_MAP[key])) {
              result[dim] = clamp(result[dim] + adjustment * Math.abs(delta));
            }
          }
        }
      }
    }
  }
  return result;
}

module.exports = {
  buildTasteVector,
  buildGroupComposite,
  applyFeedback,
  applyMBTI,
  applyActivityChips,
  applyVibeChips,
  applySpotifySignals,
  applyInstagramSignals,
  applyPinterestSignals,
  emptyVector,
};
