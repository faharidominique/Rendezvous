// ─────────────────────────────────────────────────────────────────────
// rendezvous-engine/src/signals/mbti.js
// Processes MBTI type and in-app survey data into vector adjustments.
// ─────────────────────────────────────────────────────────────────────
const { MBTI_MAP, ACTIVITY_MAP, VIBE_MAP, SIGNAL_WEIGHTS } = require('../config');
const { clamp } = require('../utils/vector');

/**
 * Process a 4-letter MBTI type into taste vector adjustments.
 * mbtiType: string — e.g. 'ENFP', 'ISTJ'
 * mbtiSource: 'imported' | 'full_quiz' | 'short_quiz'
 */
function processMBTI(mbtiType, mbtiSource = 'imported') {
  if (!mbtiType || mbtiType.length !== 4) {
    return { adjustments: {}, confidence: 0 };
  }

  const type   = mbtiType.toUpperCase();
  const adj    = {};

  // Apply each letter's adjustments
  for (const letter of type) {
    const letterAdj = MBTI_MAP[letter];
    if (letterAdj) {
      for (const [dim, delta] of Object.entries(letterAdj)) {
        adj[dim] = (adj[dim] || 0) + delta;
      }
    }
  }

  // Scale by MBTI's signal weight
  const scaled = {};
  for (const [dim, delta] of Object.entries(adj)) {
    scaled[dim] = delta * SIGNAL_WEIGHTS.mbti;
  }

  // Confidence varies by source quality
  const confidenceBySource = {
    imported:   0.15,   // User imported a verified result
    full_quiz:  0.15,   // Completed full 16-question in-app quiz
    short_quiz: 0.08,   // Completed 4-question quick quiz
  };
  const confidence = confidenceBySource[mbtiSource] || 0.08;

  return { adjustments: scaled, confidence, type };
}

/**
 * Validate that a string is a valid MBTI type.
 */
function validateMBTI(type) {
  if (!type || type.length !== 4) return false;
  const t = type.toUpperCase();
  return (
    'EI'.includes(t[0]) &&
    'SN'.includes(t[1]) &&
    'TF'.includes(t[2]) &&
    'JP'.includes(t[3])
  );
}

/**
 * Map a short quiz response pattern to an MBTI type.
 * answers: array of 4 choices, each 0 or 1 (first or second option)
 * Quiz questions in order:
 *   Q1: At a party — 0 = work the whole room (E), 1 = stick with small group (I)
 *   Q2: Ideal Saturday — 0 = packed with plans (J), 1 = see how it unfolds (P)
 *   Q3: Process feelings — 0 = talk it through (F), 1 = think alone (T)
 *   Q4: Prefer to — 0 = have a clear plan (S/J), 1 = decide in the moment (N/P)
 */
function shortQuizToMBTI(answers) {
  if (!answers || answers.length !== 4) return null;
  const ei = answers[0] === 0 ? 'E' : 'I';
  const sn = answers[3] === 0 ? 'S' : 'N';
  const tf = answers[2] === 0 ? 'F' : 'T';
  const jp = answers[1] === 0 ? 'J' : 'P';
  return `${ei}${sn}${tf}${jp}`;
}

// ─────────────────────────────────────────────────────────────────────
// rendezvous-engine/src/signals/survey.js
// Processes in-app survey responses (activities, vibes, budget).
// Ranked last in the hierarchy — serves as cold-start baseline.
// ─────────────────────────────────────────────────────────────────────

/**
 * Process activity chip selections into vector adjustments.
 * activities: string[] — e.g. ['food', 'music', 'art']
 */
function processSurveyActivities(activities = []) {
  if (!activities.length) return { adjustments: {}, confidence: 0 };
  const adj = {};

  for (const activity of activities) {
    const key = activity.toLowerCase().replace(/[^a-z-]/g, '');
    const actAdj = ACTIVITY_MAP[key];
    if (actAdj) {
      for (const [dim, delta] of Object.entries(actAdj)) {
        adj[dim] = (adj[dim] || 0) + delta;
      }
    }
  }

  // Activity diversity: fraction of available categories selected
  adj.activityDiversity = clamp(activities.length / 16);

  // Scale by survey's signal weight
  const scaled = {};
  for (const [dim, delta] of Object.entries(adj)) {
    scaled[dim] = delta * SIGNAL_WEIGHTS.survey;
  }

  const confidence = Math.min(0.05, activities.length * 0.003);
  return { adjustments: scaled, confidence };
}

/**
 * Process vibe chip selections into vector adjustments.
 * vibes: string[] — e.g. ['chill', 'spontaneous', 'outdoors']
 */
function processSurveyVibes(vibes = []) {
  if (!vibes.length) return { adjustments: {}, confidence: 0 };
  const adj = {};

  for (const vibe of vibes) {
    const key = vibe.toLowerCase();
    const vibeAdj = VIBE_MAP[key];
    if (vibeAdj) {
      for (const [dim, delta] of Object.entries(vibeAdj)) {
        adj[dim] = (adj[dim] || 0) + delta;
      }
    }
  }

  const scaled = {};
  for (const [dim, delta] of Object.entries(adj)) {
    scaled[dim] = delta * SIGNAL_WEIGHTS.survey;
  }

  const confidence = Math.min(0.03, vibes.length * 0.005);
  return { adjustments: scaled, confidence };
}

/**
 * Process budget slider value into budget sensitivity adjustment.
 * budgetMax: integer — e.g. 35 (dollars per outing)
 */
function processSurveyBudget(budgetMax) {
  if (budgetMax === undefined || budgetMax === null) {
    return { adjustments: {}, confidence: 0 };
  }
  // Higher budget max = lower budget sensitivity
  // $0 → sensitivity 1.0 (very budget-conscious)
  // $150 → sensitivity 0.0 (price-insensitive)
  const sensitivity = clamp(1 - budgetMax / 150);
  const adj = { budgetSensitivity: (sensitivity - 0.5) * SIGNAL_WEIGHTS.survey };
  return { adjustments: adj, confidence: 0.02 };
}

module.exports = { processMBTI, validateMBTI, shortQuizToMBTI, processSurveyActivities, processSurveyVibes, processSurveyBudget };
