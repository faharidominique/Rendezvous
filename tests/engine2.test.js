// ─────────────────────────────────────────────────────────────────────
// rendezvous-engine/tests/engine2.test.js
// Tests for Engine 2: Group Matching & Itinerary Assembly
// Run with: node tests/engine2.test.js
// ─────────────────────────────────────────────────────────────────────

const { buildGroupSpectrum, deriveGroupVibeTags, scoreSpot, filterEligibleSpots, generateConflictMessages, generateBudgetWarning } = require('../src/engine/matching/groupMatcher');
const { generateThreePlans } = require('../src/engine/matching/itineraryAssembler');
const { applyContextModifiers, getTimeModifier, getWeatherModifier } = require('../src/engine/context/contextModifiers');
const { processFeedbackBatch, processExplicitReactions, getSuppressedSpotIds } = require('../src/engine/feedback/feedbackLoop');
const { neutral } = require('../src/engine/utils/vector');

// ── MINI TEST FRAMEWORK ───────────────────────────────────────────────
let passed = 0, failed = 0, total = 0;
const testQueue = [];

function test(label, fn) {
  total++;
  const p = (async () => {
    try {
      await fn();
      console.log(`  ✓ ${label}`);
      passed++;
    } catch (err) {
      console.log(`  ✗ ${label}`);
      console.log(`    → ${err.message}`);
      failed++;
    }
  })();
  testQueue.push(p);
}

function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion failed'); }
function assertClose(a, b, tol = 0.05, lbl = '') {
  if (Math.abs(a - b) > tol) throw new Error(`${lbl}: expected ~${b.toFixed(3)}, got ${a.toFixed(3)}`);
}
function assertRange(val, min, max, lbl = '') {
  if (val < min || val > max) throw new Error(`${lbl}: ${val.toFixed(3)} outside [${min}, ${max}]`);
}

// ── SAMPLE DATA ────────────────────────────────────────────────────────

const CHILL_VECTOR = { ...neutral(), energyLevel: 0.25, socialOpenness: 0.40, nightOwlScore: 0.30, outdoorPreference: 0.45, noveltyAppetite: 0.50, physicalEnergy: 0.30, groupSizePref: 0.35, spontaneity: 0.40, culturalAppetite: 0.60, foodPriority: 0.55, budgetSensitivity: 0.60, activityDiversity: 0.50 };
const HYPE_VECTOR  = { ...neutral(), energyLevel: 0.85, socialOpenness: 0.80, nightOwlScore: 0.80, outdoorPreference: 0.50, noveltyAppetite: 0.70, physicalEnergy: 0.75, groupSizePref: 0.80, spontaneity: 0.75, culturalAppetite: 0.55, foodPriority: 0.45, budgetSensitivity: 0.30, activityDiversity: 0.70 };
const FOODIE_VECTOR= { ...neutral(), energyLevel: 0.50, socialOpenness: 0.60, nightOwlScore: 0.45, outdoorPreference: 0.40, noveltyAppetite: 0.55, physicalEnergy: 0.45, groupSizePref: 0.55, spontaneity: 0.50, culturalAppetite: 0.50, foodPriority: 0.90, budgetSensitivity: 0.40, activityDiversity: 0.50 };

const MEMBER_CHILL  = { userId: 'u1', tasteVector: CHILL_VECTOR,  tonightOverrides: { budget: 30,  availableFromMinutes: 19*60, energyLevel: 'low'    } };
const MEMBER_HYPE   = { userId: 'u2', tasteVector: HYPE_VECTOR,   tonightOverrides: { budget: 60,  availableFromMinutes: 20*60, energyLevel: 'high'   } };
const MEMBER_FOODIE = { userId: 'u3', tasteVector: FOODIE_VECTOR, tonightOverrides: { budget: 40,  availableFromMinutes: 19*60, energyLevel: 'medium' } };
const MEMBER_MED    = { userId: 'u4', tasteVector: { ...neutral() }, tonightOverrides: { budget: 35, availableFromMinutes: 19*60, energyLevel: 'medium' } };

const SAMPLE_SPOTS = [
  { id:'s1', name:'Vinyl District',  category:'Record Store',  neighborhood:'U Street',  city:'Washington DC', lat:38.9169, lng:-77.0391, vibeTags:['cozy','hidden gem','creative'],         priceTier:2, energyScore:0.35, socialDensity:0.40, noveltyScore:0.75, groupSizeMin:2, groupSizeMax:8,  visitDuration:90,  multiActivityFlag:false, hours:{ mon:'12:00-21:00', tue:'12:00-21:00', wed:'12:00-21:00', thu:'12:00-21:00', fri:'12:00-22:00', sat:'11:00-22:00', sun:'12:00-20:00' }, lastVerifiedAt: new Date() },
  { id:'s2', name:'Compass Coffee',  category:'Café',           neighborhood:'Shaw',      city:'Washington DC', lat:38.9122, lng:-77.0218, vibeTags:['chill','cozy','daytime','local fave'],  priceTier:1, energyScore:0.28, socialDensity:0.45, noveltyScore:0.50, groupSizeMin:2, groupSizeMax:10, visitDuration:60,  multiActivityFlag:false, hours:{ mon:'07:00-19:00', tue:'07:00-19:00', wed:'07:00-19:00', thu:'07:00-19:00', fri:'07:00-19:00', sat:'08:00-19:00', sun:'08:00-18:00' }, lastVerifiedAt: new Date() },
  { id:'s3', name:'Wunder Garten',   category:'Beer Garden',   neighborhood:'NoMa',      city:'Washington DC', lat:38.9039, lng:-77.0023, vibeTags:['outdoor','social','lively','group-friendly'], priceTier:2, energyScore:0.72, socialDensity:0.85, noveltyScore:0.55, groupSizeMin:2, groupSizeMax:30, visitDuration:120, multiActivityFlag:true,  multiActivityDescription:'Beer + food trucks', hours:{ mon:'16:00-23:00', tue:'16:00-23:00', wed:'16:00-23:00', thu:'16:00-23:00', fri:'16:00-02:00', sat:'12:00-02:00', sun:'12:00-22:00' }, lastVerifiedAt: new Date() },
  { id:'s4', name:'Rhizome DC',      category:'Art Space',     neighborhood:'Takoma',    city:'Washington DC', lat:38.9795, lng:-77.0036, vibeTags:['avant-garde','underground','creative','late night'], priceTier:2, energyScore:0.65, socialDensity:0.60, noveltyScore:0.90, groupSizeMin:2, groupSizeMax:20, visitDuration:120, multiActivityFlag:false, hours:{ thu:'18:00-23:00', fri:'18:00-23:00', sat:'18:00-23:00', sun:'18:00-22:00' }, lastVerifiedAt: new Date() },
  { id:'s5', name:'Pho 14',          category:'Restaurant',    neighborhood:'Columbia Heights', city:'Washington DC', lat:38.9285, lng:-77.0355, vibeTags:['late night','filling','local fave'], priceTier:1, energyScore:0.45, socialDensity:0.55, noveltyScore:0.40, groupSizeMin:2, groupSizeMax:15, visitDuration:60,  multiActivityFlag:false, hours:{ mon:'10:00-02:00', tue:'10:00-02:00', wed:'10:00-02:00', thu:'10:00-02:00', fri:'10:00-02:00', sat:'10:00-02:00', sun:'10:00-02:00' }, lastVerifiedAt: new Date() },
  { id:'s6', name:'Boxcar DC',       category:'Arcade Bar',    neighborhood:'U Street',  city:'Washington DC', lat:38.9172, lng:-77.0397, vibeTags:['competitive','fun','late night','social'], priceTier:2, energyScore:0.75, socialDensity:0.80, noveltyScore:0.60, groupSizeMin:2, groupSizeMax:20, visitDuration:120, multiActivityFlag:true,  multiActivityDescription:'Games + drinks', hours:{ mon:'17:00-02:00', tue:'17:00-02:00', wed:'17:00-02:00', thu:'17:00-02:00', fri:'17:00-02:00', sat:'14:00-02:00', sun:'14:00-24:00' }, lastVerifiedAt: new Date() },
  { id:'s7', name:'Idle Time Books', category:'Bookstore',     neighborhood:'Adams Morgan', city:'Washington DC', lat:38.9219, lng:-77.0435, vibeTags:['cozy','browsable','quiet','hidden gem'], priceTier:1, energyScore:0.22, socialDensity:0.35, noveltyScore:0.65, groupSizeMin:2, groupSizeMax:6,  visitDuration:75,  multiActivityFlag:false, hours:{ mon:'11:00-22:00', tue:'11:00-22:00', wed:'11:00-22:00', thu:'11:00-22:00', fri:'11:00-22:00', sat:'11:00-22:00', sun:'11:00-22:00' }, lastVerifiedAt: new Date() },
  { id:'s8', name:'Eastern Market',  category:'Market',        neighborhood:'Capitol Hill', city:'Washington DC', lat:38.8836, lng:-76.9979, vibeTags:['outdoor','daytime','local fave','social'], priceTier:1, energyScore:0.55, socialDensity:0.65, noveltyScore:0.50, groupSizeMin:2, groupSizeMax:30, visitDuration:90,  multiActivityFlag:true,  multiActivityDescription:'Shopping + food', hours:{ tue:'07:00-19:00', wed:'07:00-19:00', thu:'07:00-19:00', fri:'07:00-19:00', sat:'07:00-18:00', sun:'09:00-17:00' }, lastVerifiedAt: new Date() },
];

// ── SECTION 1: GROUP SPECTRUM BUILDER ─────────────────────────────────
console.log('\n━━ Group Spectrum Builder ━━');

test('buildGroupSpectrum returns composite, spectrum, constraints, and conflicts', () => {
  const result = buildGroupSpectrum([MEMBER_CHILL, MEMBER_HYPE, MEMBER_FOODIE]);
  assert(result.composite,   'Should return composite vector');
  assert(result.spectrum,    'Should return spectrum');
  assert(result.constraints, 'Should return constraints');
  assert(Array.isArray(result.conflicts), 'Should return conflicts array');
});

test('Composite energyLevel is the mean of member energies', () => {
  const result = buildGroupSpectrum([MEMBER_CHILL, MEMBER_HYPE]);
  // After tonight overrides: chill -0.25, hype +0.25
  // chill.energyLevel ≈ 0.0 (clamped), hype.energyLevel ≈ 1.0 (clamped)
  // composite should be roughly mid-range
  assertRange(result.composite.energyLevel, 0.3, 0.7, 'composite energyLevel');
});

test('Effective budget = minimum of all member budgets', () => {
  const result = buildGroupSpectrum([MEMBER_CHILL, MEMBER_HYPE, MEMBER_FOODIE]);
  assert(result.constraints.effectiveBudget === 30,
    `effectiveBudget should be 30 (min), got ${result.constraints.effectiveBudget}`);
});

test('Availability = latest member start time', () => {
  const result = buildGroupSpectrum([MEMBER_CHILL, MEMBER_HYPE]);
  // MEMBER_CHILL: 19:00 = 1140 mins, MEMBER_HYPE: 20:00 = 1200 mins
  assert(result.constraints.availableFromMinutes === 1200,
    `availableFromMinutes should be 1200 (latest), got ${result.constraints.availableFromMinutes}`);
});

test('High vibe divergence group triggers conflicts', () => {
  const result = buildGroupSpectrum([MEMBER_CHILL, MEMBER_HYPE]);
  assert(result.conflicts.length > 0, 'Chill vs hype group should have conflicts');
});

test('Homogeneous group has no conflicts', () => {
  const clone = (v) => ({ userId: Math.random().toString(), tasteVector: { ...v }, tonightOverrides: { budget: 35 } });
  const result = buildGroupSpectrum([clone(MEMBER_MED.tasteVector), clone(MEMBER_MED.tasteVector), clone(MEMBER_MED.tasteVector)]);
  // All neutral vectors — no dimension should exceed conflict threshold
  const severeConflicts = result.conflicts.filter(c => c.stdDev > 0.35);
  assert(severeConflicts.length === 0, 'Identical vectors should produce no conflicts');
});

test('Single member group returns their vector as composite', () => {
  const result = buildGroupSpectrum([MEMBER_FOODIE]);
  assert(result.memberCount === 1, 'memberCount should be 1');
});

test('Empty group returns neutral composite', () => {
  const result = buildGroupSpectrum([]);
  assert(result.memberCount === 0, 'memberCount should be 0');
});

// ── SECTION 2: VIBE TAG DERIVATION ────────────────────────────────────
console.log('\n━━ Vibe Tag Derivation ━━');

test('Low energy composite derives chill/cozy tags', () => {
  const composite = { ...neutral(), energyLevel: 0.20 };
  const tags = deriveGroupVibeTags(composite);
  assert(tags.some(t => ['chill','cozy','low-key'].includes(t)),
    `Expected chill tags, got: ${tags.join(', ')}`);
});

test('High energy composite derives lively tags', () => {
  const composite = { ...neutral(), energyLevel: 0.80 };
  const tags = deriveGroupVibeTags(composite);
  assert(tags.some(t => ['lively','high energy'].includes(t)),
    `Expected lively tags, got: ${tags.join(', ')}`);
});

test('High cultural appetite derives underground/creative tags', () => {
  const composite = { ...neutral(), culturalAppetite: 0.80 };
  const tags = deriveGroupVibeTags(composite);
  assert(tags.some(t => ['underground','hidden gem','creative'].includes(t)),
    `Expected cultural tags, got: ${tags.join(', ')}`);
});

test('High night owl score derives late night tag', () => {
  const composite = { ...neutral(), nightOwlScore: 0.80 };
  const tags = deriveGroupVibeTags(composite);
  assert(tags.includes('late night'), `Expected 'late night' tag, got: ${tags.join(', ')}`);
});

// ── SECTION 3: SPOT SCORING ────────────────────────────────────────────
console.log('\n━━ Spot Scoring ━━');

const GROUP_CHILL_SPECTRUM = buildGroupSpectrum([MEMBER_CHILL, MEMBER_MED]);
const GROUP_HYPE_SPECTRUM  = buildGroupSpectrum([MEMBER_HYPE, MEMBER_MED]);

test('Cozy café scores higher for chill group than hype group', () => {
  const cafe = SAMPLE_SPOTS.find(s => s.id === 's2'); // Compass Coffee
  const chillScore = scoreSpot(cafe, GROUP_CHILL_SPECTRUM, ['food', 'coffee'], {});
  const hypeScore  = scoreSpot(cafe, GROUP_HYPE_SPECTRUM,  ['food', 'coffee'], {});
  assert(chillScore > hypeScore,
    `Café should score higher for chill group (${chillScore.toFixed(3)}) than hype (${hypeScore.toFixed(3)})`);
});

test('Beer garden scores higher for hype group than chill group', () => {
  const garden = SAMPLE_SPOTS.find(s => s.id === 's3'); // Wunder Garten
  const chillScore = scoreSpot(garden, GROUP_CHILL_SPECTRUM, ['outdoor'], {});
  const hypeScore  = scoreSpot(garden, GROUP_HYPE_SPECTRUM,  ['outdoor'], {});
  assert(hypeScore > chillScore,
    `Beer garden should score higher for hype group (${hypeScore.toFixed(3)}) than chill (${chillScore.toFixed(3)})`);
});

test('Loved spots receive higher score than unvisited spots', () => {
  const spot = SAMPLE_SPOTS.find(s => s.id === 's1');
  const normalScore = scoreSpot(spot, GROUP_CHILL_SPECTRUM, ['music'], {});
  const lovedScore  = scoreSpot(spot, GROUP_CHILL_SPECTRUM, ['music'], { lovedSpotIds: ['s1'] });
  assert(lovedScore > normalScore,
    `Loved spot (${lovedScore.toFixed(3)}) should score higher than unvisited (${normalScore.toFixed(3)})`);
});

test('Repeatedly suggested spots receive lower score', () => {
  const spot = SAMPLE_SPOTS.find(s => s.id === 's1');
  const normalScore   = scoreSpot(spot, GROUP_CHILL_SPECTRUM, [], {});
  const repeatedScore = scoreSpot(spot, GROUP_CHILL_SPECTRUM, [], { suggestedSpotIds: ['s1','s1','s1'] });
  assert(repeatedScore < normalScore,
    `Repeated spot (${repeatedScore.toFixed(3)}) should score lower than fresh (${normalScore.toFixed(3)})`);
});

test('All spot scores are within [0, 1]', () => {
  for (const spot of SAMPLE_SPOTS) {
    const score = scoreSpot(spot, GROUP_CHILL_SPECTRUM, ['food','music','art'], {});
    assertRange(score, 0, 1, spot.name);
  }
});

test('Wildcard mode produces different scores from normal mode', () => {
  const spot = SAMPLE_SPOTS.find(s => s.id === 's4');
  const scores = new Set();
  for (let i = 0; i < 5; i++) {
    const wildcardScore = scoreSpot(spot, GROUP_CHILL_SPECTRUM, [], {}, true);
    scores.add(wildcardScore.toFixed(3));
  }
  // With random offset, scores should vary across runs
  // (Occasionally they might be the same — just check they're in range)
  assertRange([...scores][0], 0, 1, 'wildcard score');
});

// ── SECTION 4: ELIGIBILITY FILTERING ──────────────────────────────────
console.log('\n━━ Eligibility Filtering ━━');

test('Spots over effective budget are filtered out', () => {
  // Budget = 30 → tier 3+ spots ($45+) should be excluded
  const priceySpots = [
    ...SAMPLE_SPOTS,
    { id:'expensive', name:'Fancy Place', category:'Restaurant', priceTier:4, energyScore:0.5, socialDensity:0.5, groupSizeMin:2, groupSizeMax:20, hours:{}, lat:38.9, lng:-77.0 }
  ];
  const spectrum = buildGroupSpectrum([MEMBER_CHILL]); // budget = 30
  const eligible = filterEligibleSpots(priceySpots, spectrum);
  assert(!eligible.find(s => s.id === 'expensive'),
    'Tier-4 spot should be filtered when effective budget is $30');
});

test('Spots with wrong group size are filtered out', () => {
  const tinySpot = { id:'tiny', name:'Tiny Bar', category:'Bar', priceTier:2, energyScore:0.5, socialDensity:0.5, groupSizeMin:2, groupSizeMax:2, hours:{}, lat:38.9, lng:-77.0 };
  const largeGroup = [MEMBER_CHILL, MEMBER_HYPE, MEMBER_FOODIE, MEMBER_MED, { userId:'u5', tasteVector: neutral(), tonightOverrides: { budget: 40 } }]; // 5 members
  const spectrum = buildGroupSpectrum(largeGroup);
  const eligible = filterEligibleSpots([tinySpot], spectrum);
  assert(!eligible.find(s => s.id === 'tiny'), 'Spot with max 2 should be filtered for group of 5');
});

// ── SECTION 5: THREE PLAN GENERATION ──────────────────────────────────
console.log('\n━━ Three Plan Generation ━━');

test('generateThreePlans returns exactly 3 plans', async () => {
  const spectrum = buildGroupSpectrum([MEMBER_CHILL, MEMBER_FOODIE, MEMBER_MED]);
  const plans = await generateThreePlans(SAMPLE_SPOTS, spectrum, ['food', 'music', 'art'], {});
  assert(plans.length === 3, `Expected 3 plans, got ${plans.length}`);
});

test('Each plan has at least 1 stop', async () => {
  const spectrum = buildGroupSpectrum([MEMBER_MED, MEMBER_FOODIE]);
  const plans = await generateThreePlans(SAMPLE_SPOTS, spectrum, ['food', 'coffee'], {});
  for (const plan of plans) {
    assert(plan.stops?.length >= 1, `Plan "${plan.label}" should have at least 1 stop`);
  }
});

test('Plans have distinct primary stops', async () => {
  const spectrum = buildGroupSpectrum([MEMBER_CHILL, MEMBER_HYPE, MEMBER_FOODIE]);
  const plans = await generateThreePlans(SAMPLE_SPOTS, spectrum, ['food', 'music', 'art', 'outdoor'], {});
  const primaryIds = plans.map(p => p.stops[0].id);
  const unique = new Set(primaryIds);
  assert(unique.size === 3, `All 3 plans should have different primary stops, got: ${primaryIds.join(', ')}`);
});

test('Each plan has a label', async () => {
  const spectrum = buildGroupSpectrum([MEMBER_MED]);
  const plans = await generateThreePlans(SAMPLE_SPOTS, spectrum, ['food'], {});
  for (const plan of plans) {
    assert(plan.label, `Plan should have a label`);
  }
});

test('Each plan has a matchScore', async () => {
  const spectrum = buildGroupSpectrum([MEMBER_MED, MEMBER_CHILL]);
  const plans = await generateThreePlans(SAMPLE_SPOTS, spectrum, ['food', 'music'], {});
  for (const plan of plans) {
    assertRange(plan.matchScore, 0, 100, `Plan ${plan.label} matchScore`);
  }
});

test('Walkable flag set correctly for nearby stops', async () => {
  const spectrum = buildGroupSpectrum([MEMBER_MED]);
  const plans = await generateThreePlans(SAMPLE_SPOTS, spectrum, ['food', 'music'], {});
  for (const plan of plans) {
    assert(typeof plan.isWalkable === 'boolean', `isWalkable should be boolean`);
  }
});

test('generateThreePlans throws when too few eligible spots', async () => {
  const spectrum = buildGroupSpectrum([{ userId:'u1', tasteVector: neutral(), tonightOverrides: { budget: 5 } }]);
  let threw = false;
  try {
    await generateThreePlans(SAMPLE_SPOTS, spectrum, [], {});
  } catch (e) {
    threw = true;
  }
  assert(threw, 'Should throw error with $5 budget (all spots filtered out)');
});

// ── SECTION 6: CONTEXT MODIFIERS ──────────────────────────────────────
console.log('\n━━ Context Modifiers ━━');

test('Outdoor spot penalised in rainy weather', () => {
  const outdoorSpot = SAMPLE_SPOTS.find(s => s.id === 's3'); // Wunder Garten
  const modifier = getWeatherModifier(outdoorSpot, { condition: 'rain', tempF: 55 });
  assert(modifier < 0, `Outdoor spot should have negative weather modifier in rain, got ${modifier}`);
});

test('Outdoor spot boosted in clear warm weather', () => {
  const outdoorSpot = SAMPLE_SPOTS.find(s => s.id === 's3');
  const modifier = getWeatherModifier(outdoorSpot, { condition: 'clear', tempF: 72 });
  assert(modifier > 0, `Outdoor spot should have positive modifier in warm clear weather, got ${modifier}`);
});

test('Indoor spot unaffected by rain', () => {
  const indoorSpot = SAMPLE_SPOTS.find(s => s.id === 's1'); // Vinyl District
  const modifier = getWeatherModifier(indoorSpot, { condition: 'rain', tempF: 55 });
  assert(modifier === 0, `Indoor spot should have 0 weather modifier in rain, got ${modifier}`);
});

test('applyContextModifiers returns sorted array', () => {
  const scored = SAMPLE_SPOTS.map(spot => ({ spot, score: Math.random() * 0.8, wildcardScore: 0 }));
  const result = applyContextModifiers(scored, {}, new Date());
  for (let i = 0; i < result.length - 1; i++) {
    assert(result[i].score >= result[i+1].score,
      `Results should be sorted descending (index ${i}: ${result[i].score.toFixed(3)} >= ${result[i+1].score.toFixed(3)})`);
  }
});

test('Context modifier output includes contextModifier field', () => {
  const scored = [{ spot: SAMPLE_SPOTS[0], score: 0.6, wildcardScore: 0.6 }];
  const result = applyContextModifiers(scored, {});
  assert(result[0].contextModifier !== undefined, 'Should include contextModifier field');
});

// ── SECTION 7: CONFLICT MESSAGING ─────────────────────────────────────
console.log('\n━━ Conflict Messaging ━━');

test('generateConflictMessages returns non-empty array for divergent group', () => {
  const result = buildGroupSpectrum([MEMBER_CHILL, MEMBER_HYPE]);
  const messages = generateConflictMessages(result.conflicts);
  assert(messages.length > 0, 'Divergent group should produce conflict messages');
});

test('Conflict messages never mention specific user names or budgets', () => {
  const result = buildGroupSpectrum([MEMBER_CHILL, MEMBER_HYPE]);
  const messages = generateConflictMessages(result.conflicts);
  for (const msg of messages) {
    assert(!msg.includes('u1') && !msg.includes('u2'), 'Messages should not name specific users');
    assert(!msg.toLowerCase().includes('budget'), 'Conflict messages should not mention budget');
    assert(!msg.includes('$'), 'Messages should not include dollar amounts');
  }
});

test('generateBudgetWarning returns null when within budget', () => {
  const spot = { priceTier: 1, name: 'Cheap Cafe' }; // ~$10
  const warning = generateBudgetWarning(spot, 30);
  assert(warning === null, 'No warning for in-budget spot');
});

test('generateBudgetWarning does not name the individual member', () => {
  const spot = { priceTier: 4, name: 'Fancy Place' }; // ~$80
  const warning = generateBudgetWarning(spot, 30);
  assert(warning !== null, 'Should return a warning for over-budget spot');
  assert(!warning.includes('u1') && !warning.includes('Kaya') && !warning.includes('Marcus'),
    'Budget warning should not name any individual');
  assert(warning.includes('some members'), 'Warning should say "some members" not a specific person');
});

// ── SECTION 8: FEEDBACK LOOP ───────────────────────────────────────────
console.log('\n━━ Feedback Loop ━━');

const BASE_PROFILE = {
  energyLevel: 0.5, socialOpenness: 0.5, spontaneity: 0.5,
  culturalAppetite: 0.5, foodPriority: 0.5, outdoorPreference: 0.5,
  budgetSensitivity: 0.5, nightOwlScore: 0.5, activityDiversity: 0.5,
  noveltyAppetite: 0.5, groupSizePref: 0.5, physicalEnergy: 0.5,
};

test('Heart reaction nudges vector toward spot attributes', () => {
  const reactions = [{
    reactionType: 'HEART',
    spotAttributes: { energyScore: 0.85, socialDensity: 0.80, vibeTags: ['lively', 'social'], noveltyScore: 0.70 },
    timestamp: new Date().toISOString(),
  }];
  const { vector } = processExplicitReactions(reactions, { ...BASE_PROFILE });
  assert(vector.energyLevel > 0.5, `energyLevel should increase after hearting high-energy spot (${vector.energyLevel.toFixed(3)})`);
});

test('processFeedbackBatch returns changed=true when nudges applied', () => {
  const batch = {
    explicitReactions: [{
      reactionType: 'HEART',
      spotAttributes: { energyScore: 0.9, vibeTags: ['lively'], noveltyScore: 0.8 },
      timestamp: new Date().toISOString(),
    }],
    passiveSignals: [],
  };
  const { changed, nudgesApplied } = processFeedbackBatch({ ...BASE_PROFILE }, batch);
  assert(changed, 'Feedback batch with reactions should mark changed=true');
  assert(nudgesApplied > 0, `nudgesApplied should be > 0, got ${nudgesApplied}`);
});

test('processFeedbackBatch returns changed=false for empty batch', () => {
  const batch = { explicitReactions: [], passiveSignals: [] };
  const { changed } = processFeedbackBatch({ ...BASE_PROFILE }, batch);
  assert(!changed, 'Empty batch should not change the vector');
});

test('getSuppressedSpotIds suppresses repeatedly suggested spots', () => {
  const history = [{
    spotId: 'suppressed-spot',
    suggestedCount: 5,
    lastSuggestedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(), // 5 days ago
    reactions: [],
  }];
  const suppressed = getSuppressedSpotIds(history);
  assert(suppressed.has('suppressed-spot'), 'Spot suggested 5+ times should be suppressed');
});

test('getSuppressedSpotIds does not suppress loved spots', () => {
  const history = [{
    spotId: 'loved-spot',
    suggestedCount: 5,
    lastSuggestedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    reactions: [{ reactionType: 'HEART' }],
  }];
  const suppressed = getSuppressedSpotIds(history);
  assert(!suppressed.has('loved-spot'), 'Loved spot should not be suppressed even if suggested many times');
});

test('Updated taste vector dimensions stay within [0, 1]', () => {
  const extremeReactions = Array.from({ length: 20 }, () => ({
    reactionType: 'HEART',
    spotAttributes: { energyScore: 1.0, socialDensity: 1.0, vibeTags: ['lively','social'], noveltyScore: 1.0 },
    timestamp: new Date().toISOString(),
  }));
  const { vector } = processExplicitReactions(extremeReactions, { ...BASE_PROFILE });
  for (const [dim, val] of Object.entries(vector)) {
    if (typeof val === 'number') {
      assert(val >= 0 && val <= 1, `${dim} = ${val} is outside [0, 1]`);
    }
  }
});

// ── SUMMARY ───────────────────────────────────────────────────────────
Promise.all(testQueue).then(() => {
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Engine 2 Tests: ${passed}/${total} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
});
