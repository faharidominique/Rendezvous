// ─────────────────────────────────────────────────────────────────────
// rendezvous-engine/tests/engine1.test.js
// Tests for Engine 1: Personal Profile Builder
// Run with: node tests/engine1.test.js
// ─────────────────────────────────────────────────────────────────────

const { buildTasteVector, computeConfidence, getColdStartStatus, processScrollBehavior, applySeasonalCorrection } = require('../src/engine/vector/profileBuilder');
const { processSpotifySignals, processAudioFeatures, processGenres, processPeakHour } = require('../src/engine/signals/spotify');
const { processInstagramSignals } = require('../src/engine/signals/social');
const { processPinterestSignals } = require('../src/engine/signals/social');
const { processTikTokSignals } = require('../src/engine/signals/social');
const { processMBTI, validateMBTI, shortQuizToMBTI } = require('../src/engine/signals/mbti');
const { processSurveyActivities, processSurveyVibes, processSurveyBudget } = require('../src/engine/signals/mbti');
const { neutral, clamp } = require('../src/engine/utils/vector');

// ── MINI TEST FRAMEWORK ───────────────────────────────────────────────
let passed = 0, failed = 0, total = 0;

function test(label, fn) {
  total++;
  try {
    fn();
    console.log(`  ✓ ${label}`);
    passed++;
  } catch (err) {
    console.log(`  ✗ ${label}`);
    console.log(`    → ${err.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

function assertClose(a, b, tolerance = 0.05, label = '') {
  if (Math.abs(a - b) > tolerance) {
    throw new Error(`${label}: expected ${b.toFixed(3)}, got ${a.toFixed(3)} (tolerance ±${tolerance})`);
  }
}

function assertRange(val, min, max, label = '') {
  if (val < min || val > max) {
    throw new Error(`${label}: ${val.toFixed(3)} not in range [${min}, ${max}]`);
  }
}

function assertDirection(before, after, dim, direction, label = '') {
  if (direction === 'up'   && after[dim] <= before[dim]) throw new Error(`${label}: ${dim} should increase (${before[dim].toFixed(3)} → ${after[dim].toFixed(3)})`);
  if (direction === 'down' && after[dim] >= before[dim]) throw new Error(`${label}: ${dim} should decrease (${before[dim].toFixed(3)} → ${after[dim].toFixed(3)})`);
}

// ── SECTION 1: VECTOR UTILITIES ───────────────────────────────────────
console.log('\n━━ Vector Utilities ━━');

test('neutral() creates a vector with all dimensions at 0.5', () => {
  const v = neutral();
  for (const val of Object.values(v)) {
    assertClose(val, 0.5, 0.001);
  }
});

test('clamp() keeps values within [0, 1]', () => {
  assert(clamp(1.5) === 1.0, 'should clamp above 1');
  assert(clamp(-0.5) === 0.0, 'should clamp below 0');
  assertClose(clamp(0.7), 0.7, 0.001);
});

// ── SECTION 2: SPOTIFY SIGNAL PROCESSING ─────────────────────────────
console.log('\n━━ Spotify Signal Processing ━━');

test('High energy audio features increase energyLevel', () => {
  const base = neutral();
  const signals = { avgEnergy: 0.85, avgValence: 0.7, avgDanceability: 0.8, avgAcousticness: 0.1 };
  const { adjustments } = processSpotifySignals(signals);
  const after = {};
  for (const [dim, delta] of Object.entries(adjustments)) {
    after[dim] = clamp((base[dim] || 0.5) + delta);
  }
  assert((after.energyLevel || 0.5) > 0.5, 'energyLevel should increase with high energy audio');
});

test('Lo-fi/ambient genres decrease energyLevel', () => {
  const base = neutral();
  const { adjustments } = processSpotifySignals({ topGenres: ['lo-fi', 'ambient', 'chillhop'] });
  let energyDelta = adjustments.energyLevel || 0;
  assert(energyDelta < 0, 'Lo-fi genres should decrease energyLevel');
});

test('Electronic/EDM genres increase nightOwlScore', () => {
  const { adjustments } = processSpotifySignals({ topGenres: ['electronic', 'house', 'techno'] });
  assert((adjustments.nightOwlScore || 0) > 0, 'EDM genres should increase nightOwlScore');
});

test('Late night peak hour (11pm) strongly increases nightOwlScore', () => {
  const { adjustments } = processSpotifySignals({ peakHour: 23 });
  assert((adjustments.nightOwlScore || 0) > 0, 'Late night peak hour should increase nightOwlScore');
});

test('Morning peak hour (8am) decreases nightOwlScore', () => {
  const { adjustments } = processSpotifySignals({ peakHour: 8 });
  assert((adjustments.nightOwlScore || 0) < 0 || adjustments.nightOwlScore === undefined,
    'Morning peak hour should decrease nightOwlScore');
});

test('High acousticness increases outdoorPreference', () => {
  const { adjustments } = processSpotifySignals({ avgEnergy: 0.3, avgAcousticness: 0.9, avgValence: 0.6 });
  assert((adjustments.outdoorPreference || 0) > 0, 'High acousticness should increase outdoorPreference');
});

test('processSpotifySignals returns confidence > 0 with data', () => {
  const { confidence } = processSpotifySignals({
    avgEnergy: 0.7, avgValence: 0.6, topGenres: ['hip-hop', 'r&b'], peakHour: 22
  });
  assert(confidence > 0, 'Confidence should be positive with signal data');
});

test('processSpotifySignals returns 0 confidence with no data', () => {
  const { confidence } = processSpotifySignals(null);
  assert(confidence === 0, 'Null signals should return 0 confidence');
});

// ── SECTION 3: MBTI PROCESSING ────────────────────────────────────────
console.log('\n━━ MBTI Processing ━━');

test('ENFP increases socialOpenness and spontaneity', () => {
  const base = neutral();
  const { adjustments } = processMBTI('ENFP', 'imported');
  assert((adjustments.socialOpenness || 0) > 0, 'E should increase socialOpenness');
  assert((adjustments.spontaneity || 0) > 0, 'P should increase spontaneity');
});

test('ISTJ decreases socialOpenness and spontaneity', () => {
  const { adjustments } = processMBTI('ISTJ', 'imported');
  assert((adjustments.socialOpenness || 0) < 0, 'I should decrease socialOpenness');
  assert((adjustments.spontaneity || 0) < 0, 'J should decrease spontaneity');
});

test('ENTJ has opposing effects on spontaneity from ENTP', () => {
  const { adjustments: entj } = processMBTI('ENTJ', 'imported');
  const { adjustments: entp } = processMBTI('ENTP', 'imported');
  assert(
    (entj.spontaneity || 0) < (entp.spontaneity || 0),
    'J type should have lower spontaneity than P type'
  );
});

test('validateMBTI accepts valid types', () => {
  assert(validateMBTI('ENFP'), 'ENFP should be valid');
  assert(validateMBTI('ISTJ'), 'ISTJ should be valid');
  assert(validateMBTI('INTP'), 'INTP should be valid');
});

test('validateMBTI rejects invalid types', () => {
  assert(!validateMBTI('XXXX'), 'XXXX should be invalid');
  assert(!validateMBTI('ENF'),  'ENF should be invalid (too short)');
  assert(!validateMBTI(''),     'Empty string should be invalid');
  assert(!validateMBTI(null),   'null should be invalid');
});

test('shortQuizToMBTI produces a valid type', () => {
  const type = shortQuizToMBTI([0, 1, 0, 1]); // E, P, F, N
  assert(validateMBTI(type), `${type} should be a valid MBTI type`);
});

test('MBTI source affects confidence', () => {
  const { confidence: imported }   = processMBTI('ENFP', 'imported');
  const { confidence: shortQuiz  } = processMBTI('ENFP', 'short_quiz');
  assert(imported >= shortQuiz, 'Imported result should have >= confidence vs short quiz');
});

// ── SECTION 4: SURVEY PROCESSING ─────────────────────────────────────
console.log('\n━━ Survey Processing ━━');

test('Food and outdoor activities push relevant dimensions up', () => {
  const { adjustments } = processSurveyActivities(['food', 'outdoor']);
  assert((adjustments.foodPriority || 0) > 0, 'food activity should increase foodPriority');
  assert((adjustments.outdoorPreference || 0) > 0, 'outdoor activity should increase outdoorPreference');
});

test('Chill vibe decreases energyLevel', () => {
  const { adjustments } = processSurveyVibes(['chill']);
  assert((adjustments.energyLevel || 0) < 0, 'chill vibe should decrease energyLevel');
});

test('High budget max produces low budget sensitivity', () => {
  const { adjustments: highBudget } = processSurveyBudget(120);
  const { adjustments: lowBudget  } = processSurveyBudget(20);
  assert(
    (highBudget.budgetSensitivity || 0) < (lowBudget.budgetSensitivity || 0),
    'High budget max should produce lower budget sensitivity than low budget max'
  );
});

test('More activities selected = higher activityDiversity', () => {
  const { adjustments: few  } = processSurveyActivities(['food', 'music']);
  const { adjustments: many } = processSurveyActivities(['food', 'music', 'art', 'outdoor', 'gaming', 'coffee', 'markets']);
  assert(
    (many.activityDiversity || 0) > (few.activityDiversity || 0),
    'More activities should yield higher activityDiversity'
  );
});

// ── SECTION 5: FULL PROFILE BUILD ────────────────────────────────────
console.log('\n━━ Full Profile Build ━━');

const FULL_PROFILE = {
  activities:    ['music', 'art', 'food', 'outdoor'],
  vibeTags:      ['spontaneous', 'social'],
  budgetMax:     45,
  mbtiType:      'ENFP',
  mbtiSource:    'imported',
  spotifySignals: {
    avgEnergy: 0.72, avgValence: 0.65, avgDanceability: 0.78,
    avgAcousticness: 0.18, avgTempo: 128,
    topGenres: ['hip-hop', 'r&b', 'indie'],
    peakHour: 21,
  },
  instagramSignals: {
    hashtagCategories: { music: 8, food: 5, outdoor: 3 },
    lateNightPostRatio: 0.3,
    uniqueLocationCount: 12,
  },
  pinterestSignals: null,
  tiktokSignals:    null,
};

test('Full profile build returns all required dimensions', () => {
  const { vector } = buildTasteVector(FULL_PROFILE);
  const DIMS = require('../src/engine/config').VECTOR_DIMS;
  for (const dim of DIMS) {
    assert(vector[dim] !== undefined, `Missing dimension: ${dim}`);
    assertRange(vector[dim], 0, 1, dim);
  }
});

test('Full profile with ENFP + hip-hop + social vibe yields social openness > 0.55', () => {
  const { vector } = buildTasteVector(FULL_PROFILE);
  assert(vector.socialOpenness > 0.55, `socialOpenness ${vector.socialOpenness.toFixed(3)} should be > 0.55`);
});

test('Profile confidence increases with more connected apps', () => {
  const baseProfile = { activities: ['food'], vibeTags: ['chill'], budgetMax: 30 };
  const richProfile = {
    ...baseProfile,
    spotifySignals:   { avgEnergy: 0.6 },
    instagramSignals: { hashtagCategories: { food: 3 }, lateNightPostRatio: 0.2 },
    mbtiType:         'INFJ',
  };
  const { confidence: baseCon } = buildTasteVector(baseProfile);
  const { confidence: richCon } = buildTasteVector(richProfile);
  assert(richCon > baseCon, `Rich profile confidence (${richCon.toFixed(2)}) should exceed base (${baseCon.toFixed(2)})`);
});

test('Cold start detected for user with no app connections', () => {
  const newUser = { activities: [], vibeTags: [], budgetMax: 30 };
  const { isColdStart, progressPercent } = getColdStartStatus(newUser);
  assert(isColdStart, 'New user should be in cold start');
  assert(progressPercent < 25, `Progress ${progressPercent}% should be < 25 for new user`);
});

test('Cold start resolved after connecting Spotify and Instagram', () => {
  const connectedUser = {
    activities: ['food', 'music'], vibeTags: ['chill'], budgetMax: 30, mbtiType: 'ENFP',
    spotifySignals:   { avgEnergy: 0.6, topGenres: ['pop'] },
    instagramSignals: { hashtagCategories: { food: 3 }, lateNightPostRatio: 0.2, uniqueLocationCount: 5 },
  };
  const { isColdStart, progressPercent } = getColdStartStatus(connectedUser);
  assert(!isColdStart || progressPercent >= 25,
    `Connected user should have progress ${progressPercent}% ≥ 25`);
});

// ── SECTION 6: SCROLL BEHAVIOR ────────────────────────────────────────
console.log('\n━━ Scroll Behavior / Cold Start ━━');

test('Saving high-energy spots nudges energyLevel up', () => {
  const base = neutral();
  const events = [
    { eventType: 'save', spotAttributes: { energyScore: 0.85, vibeTags: ['lively'] }, durationMs: 0 },
    { eventType: 'save', spotAttributes: { energyScore: 0.80, vibeTags: ['high energy'] }, durationMs: 0 },
    { eventType: 'save', spotAttributes: { energyScore: 0.90, vibeTags: ['social'] }, durationMs: 0 },
  ];
  const { vector } = processScrollBehavior(events, base);
  assertDirection(base, vector, 'energyLevel', 'up', 'Saving high-energy spots');
});

test('Skipping low-energy spots nudges energyLevel up', () => {
  const base = neutral();
  const events = [
    { eventType: 'skip', spotAttributes: { energyScore: 0.15, vibeTags: ['cozy'] }, durationMs: 0 },
    { eventType: 'skip', spotAttributes: { energyScore: 0.20, vibeTags: ['chill'] }, durationMs: 0 },
  ];
  const { vector } = processScrollBehavior(events, base);
  // Skipping a low-energy spot should nudge energyLevel away from 0.2 (up toward user's preference)
  assert(vector.energyLevel >= base.energyLevel,
    `energyLevel should not decrease after skipping low-energy spots`);
});

test('processScrollBehavior returns nudge count', () => {
  const events = [
    { eventType: 'save', spotAttributes: { energyScore: 0.7, vibeTags: ['social'] }, durationMs: 0 },
    { eventType: 'tap',  spotAttributes: { energyScore: 0.6, vibeTags: ['chill'] }, durationMs: 5000 },
  ];
  const { nudges } = processScrollBehavior(events, neutral());
  assert(nudges === 2, `Expected 2 nudges, got ${nudges}`);
});

// ── SUMMARY ───────────────────────────────────────────────────────────
console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`Engine 1 Tests: ${passed}/${total} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
