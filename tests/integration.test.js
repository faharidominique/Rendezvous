// ─────────────────────────────────────────────────────────────────────
// rendezvous-engine/tests/integration.test.js
// End-to-end integration tests: full profile build → group matching → plans
// Run with: node tests/integration.test.js
// ─────────────────────────────────────────────────────────────────────

const { rebuildProfile, rankDiscoverFeed, generateGroupPlans, analyzeGroupCompatibility, applyFeedback } = require('../src/engine/engine');

// ── MINI TEST FRAMEWORK ───────────────────────────────────────────────
let passed = 0, failed = 0, total = 0;

function test(label, fn) {
  total++;
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result
        .then(() => { console.log(`  ✓ ${label}`); passed++; })
        .catch(err => { console.log(`  ✗ ${label}\n    → ${err.message}`); failed++; });
    }
    console.log(`  ✓ ${label}`);
    passed++;
  } catch (err) {
    console.log(`  ✗ ${label}\n    → ${err.message}`);
    failed++;
  }
  return Promise.resolve();
}

function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion failed'); }
function assertRange(val, min, max, lbl = '') {
  if (val < min || val > max) throw new Error(`${lbl}: ${val} outside [${min}, ${max}]`);
}

// ── TEST DATA ─────────────────────────────────────────────────────────

// James Hawthorne — music lover, chill-to-medium energy, culturally curious
const JAMES_PROFILE = {
  activities:    ['music', 'art', 'food', 'markets', 'coffee'],
  vibeTags:      ['spontaneous', 'chill'],
  budgetMax:     40,
  mbtiType:      'INFP',
  mbtiSource:    'imported',
  spotifySignals: {
    avgEnergy: 0.55, avgValence: 0.62, avgDanceability: 0.58,
    avgAcousticness: 0.42, avgTempo: 110,
    topGenres: ['indie', 'alternative', 'jazz', 'r&b'],
    peakHour: 20,
  },
  instagramSignals: {
    hashtagCategories: { music: 12, art: 8, food: 6, culture: 4 },
    lateNightPostRatio: 0.22,
    uniqueLocationCount: 18,
  },
  pinterestSignals: {
    boardCategories: { art: 5, music: 3, food: 4 },
    hasTravelBoards: true, hasFoodBoards: true, hasGoalBoards: true, hasAestheticBoards: true,
    uniqueCategoryCount: 6,
  },
};

// Kaya — foodie, social, medium energy, outdoor-leaning
const KAYA_PROFILE = {
  activities:    ['food', 'outdoor', 'markets', 'events', 'coffee'],
  vibeTags:      ['social', 'adventurous', 'outdoors'],
  budgetMax:     35,
  mbtiType:      'ENFJ',
  mbtiSource:    'imported',
  spotifySignals: {
    avgEnergy: 0.68, avgValence: 0.72, avgDanceability: 0.70,
    avgAcousticness: 0.28, avgTempo: 118,
    topGenres: ['pop', 'r&b', 'afrobeats', 'soul'],
    peakHour: 18,
  },
  instagramSignals: {
    hashtagCategories: { food: 15, outdoor: 9, events: 6, travel: 7 },
    lateNightPostRatio: 0.15,
    uniqueLocationCount: 24,
  },
};

// Marcus — high energy, loves live music and nightlife
const MARCUS_PROFILE = {
  activities:    ['music', 'dance', 'late-night', 'gaming', 'comedy'],
  vibeTags:      ['high-energy', 'social', 'spontaneous'],
  budgetMax:     55,
  mbtiType:      'ESTP',
  mbtiSource:    'imported',
  spotifySignals: {
    avgEnergy: 0.82, avgValence: 0.68, avgDanceability: 0.85,
    avgAcousticness: 0.12, avgTempo: 138,
    topGenres: ['hip-hop', 'electronic', 'afrobeats', 'reggaeton'],
    peakHour: 23,
  },
  instagramSignals: {
    hashtagCategories: { music: 18, nightlife: 10, sports: 5 },
    lateNightPostRatio: 0.48,
    uniqueLocationCount: 15,
  },
};

const SPOTS = [
  { id:'s1', name:'Vinyl District',  category:'Record Store',  neighborhood:'U Street', city:'Washington DC', lat:38.9169, lng:-77.0391, vibeTags:['cozy','hidden gem','creative','browsable'], priceTier:2, energyScore:0.35, socialDensity:0.40, noveltyScore:0.75, groupSizeMin:2, groupSizeMax:8,  visitDuration:90,  multiActivityFlag:false, hours:{ mon:'12:00-21:00', tue:'12:00-21:00', wed:'12:00-21:00', thu:'12:00-21:00', fri:'12:00-22:00', sat:'11:00-22:00', sun:'12:00-20:00' }, lastVerifiedAt:new Date() },
  { id:'s2', name:'Compass Coffee',  category:'Café',           neighborhood:'Shaw',      city:'Washington DC', lat:38.9122, lng:-77.0218, vibeTags:['chill','cozy','daytime','local fave'], priceTier:1, energyScore:0.28, socialDensity:0.45, noveltyScore:0.50, groupSizeMin:2, groupSizeMax:10, visitDuration:60,  multiActivityFlag:false, hours:{ mon:'07:00-19:00', tue:'07:00-19:00', wed:'07:00-19:00', thu:'07:00-19:00', fri:'07:00-19:00', sat:'08:00-19:00', sun:'08:00-18:00' }, lastVerifiedAt:new Date() },
  { id:'s3', name:'Wunder Garten',   category:'Beer Garden',   neighborhood:'NoMa',      city:'Washington DC', lat:38.9039, lng:-77.0023, vibeTags:['outdoor','social','lively','group-friendly'], priceTier:2, energyScore:0.72, socialDensity:0.85, noveltyScore:0.55, groupSizeMin:2, groupSizeMax:30, visitDuration:120, multiActivityFlag:true, multiActivityDescription:'Beer + food trucks', hours:{ mon:'16:00-23:00', tue:'16:00-23:00', wed:'16:00-23:00', thu:'16:00-23:00', fri:'16:00-02:00', sat:'12:00-02:00', sun:'12:00-22:00' }, lastVerifiedAt:new Date() },
  { id:'s4', name:'Rhizome DC',      category:'Art Space',     neighborhood:'Takoma',    city:'Washington DC', lat:38.9795, lng:-77.0036, vibeTags:['avant-garde','underground','creative','late night'], priceTier:2, energyScore:0.65, socialDensity:0.60, noveltyScore:0.90, groupSizeMin:2, groupSizeMax:20, visitDuration:120, multiActivityFlag:false, hours:{ thu:'18:00-23:00', fri:'18:00-23:00', sat:'18:00-23:00', sun:'18:00-22:00' }, lastVerifiedAt:new Date() },
  { id:'s5', name:'Pho 14',          category:'Restaurant',    neighborhood:'Columbia Heights', city:'Washington DC', lat:38.9285, lng:-77.0355, vibeTags:['late night','filling','local fave','quick'], priceTier:1, energyScore:0.45, socialDensity:0.55, noveltyScore:0.40, groupSizeMin:2, groupSizeMax:15, visitDuration:60,  multiActivityFlag:false, hours:{ mon:'10:00-02:00', tue:'10:00-02:00', wed:'10:00-02:00', thu:'10:00-02:00', fri:'10:00-02:00', sat:'10:00-02:00', sun:'10:00-02:00' }, lastVerifiedAt:new Date() },
  { id:'s6', name:'Boxcar DC',       category:'Arcade Bar',    neighborhood:'U Street',  city:'Washington DC', lat:38.9172, lng:-77.0397, vibeTags:['competitive','fun','late night','social'], priceTier:2, energyScore:0.75, socialDensity:0.80, noveltyScore:0.60, groupSizeMin:2, groupSizeMax:20, visitDuration:120, multiActivityFlag:true, multiActivityDescription:'Games + drinks', hours:{ mon:'17:00-02:00', tue:'17:00-02:00', wed:'17:00-02:00', thu:'17:00-02:00', fri:'17:00-02:00', sat:'14:00-02:00', sun:'14:00-24:00' }, lastVerifiedAt:new Date() },
  { id:'s7', name:'Idle Time Books', category:'Bookstore',     neighborhood:'Adams Morgan', city:'Washington DC', lat:38.9219, lng:-77.0435, vibeTags:['cozy','browsable','quiet','hidden gem'], priceTier:1, energyScore:0.22, socialDensity:0.35, noveltyScore:0.65, groupSizeMin:2, groupSizeMax:6,  visitDuration:75,  multiActivityFlag:false, hours:{ mon:'11:00-22:00', tue:'11:00-22:00', wed:'11:00-22:00', thu:'11:00-22:00', fri:'11:00-22:00', sat:'11:00-22:00', sun:'11:00-22:00' }, lastVerifiedAt:new Date() },
  { id:'s8', name:'Eastern Market',  category:'Market',        neighborhood:'Capitol Hill', city:'Washington DC', lat:38.8836, lng:-76.9979, vibeTags:['outdoor','daytime','local fave','social'], priceTier:1, energyScore:0.55, socialDensity:0.65, noveltyScore:0.50, groupSizeMin:2, groupSizeMax:30, visitDuration:90,  multiActivityFlag:true, multiActivityDescription:'Shopping + food', hours:{ tue:'07:00-19:00', wed:'07:00-19:00', thu:'07:00-19:00', fri:'07:00-19:00', sat:'07:00-18:00', sun:'09:00-17:00' }, lastVerifiedAt:new Date() },
  { id:'s9', name:'Dukem Ethiopian', category:'Restaurant',    neighborhood:'U Street',  city:'Washington DC', lat:38.9168, lng:-77.0294, vibeTags:['communal','cultural','filling','local fave'], priceTier:2, energyScore:0.50, socialDensity:0.75, noveltyScore:0.55, groupSizeMin:2, groupSizeMax:20, visitDuration:90,  multiActivityFlag:false, hours:{ mon:'11:00-23:00', tue:'11:00-23:00', wed:'11:00-23:00', thu:'11:00-23:00', fri:'11:00-24:00', sat:'11:00-24:00', sun:'11:00-23:00' }, lastVerifiedAt:new Date() },
];

// ── INTEGRATION TESTS ─────────────────────────────────────────────────

const tests = [];

console.log('\n━━ Engine 1: Profile Rebuild ━━');

tests.push(test('James profile rebuild returns valid vector', () => {
  const { vector, confidence, coldStartStatus } = rebuildProfile(JAMES_PROFILE, { triggerEvent: 'spotify_sync' });
  assert(vector && typeof vector === 'object', 'Should return a vector');
  assertRange(confidence, 0, 1, 'confidence');
  assert(coldStartStatus, 'Should return cold start status');
}));

tests.push(test('James vector reflects INFP + indie/jazz taste (cultural appetite elevated)', () => {
  const { vector } = rebuildProfile(JAMES_PROFILE);
  assert(vector.culturalAppetite > 0.5,
    `James culturalAppetite (${vector.culturalAppetite.toFixed(3)}) should be > 0.5 for indie/jazz/INFP`);
}));

tests.push(test('Marcus vector reflects ESTP + hip-hop + high energy', () => {
  const { vector } = rebuildProfile(MARCUS_PROFILE);
  assert(vector.energyLevel > 0.5, `Marcus energyLevel (${vector.energyLevel.toFixed(3)}) should be > 0.5`);
  assert(vector.nightOwlScore > 0.5, `Marcus nightOwlScore (${vector.nightOwlScore.toFixed(3)}) should be > 0.5`);
}));

tests.push(test('Kaya vector reflects ENFJ + foodie + outdoor', () => {
  const { vector } = rebuildProfile(KAYA_PROFILE);
  assert(vector.foodPriority > 0.5, `Kaya foodPriority (${vector.foodPriority.toFixed(3)}) should be > 0.5`);
  assert(vector.socialOpenness > 0.5, `Kaya socialOpenness (${vector.socialOpenness.toFixed(3)}) should be > 0.5`);
}));

console.log('\n━━ Engine 1: Discover Feed Ranking ━━');

tests.push(test('rankDiscoverFeed returns ranked spots for James', () => {
  const { vector } = rebuildProfile(JAMES_PROFILE);
  const feed = rankDiscoverFeed(vector, SPOTS, { limit: 5 });
  assert(feed.length <= 5, 'Should respect limit');
  assert(feed.every(s => s.matchScore >= 0 && s.matchScore <= 100), 'All match scores should be 0–100');
}));

tests.push(test('Vinyl District ranks higher for James than Boxcar DC', () => {
  const { vector } = rebuildProfile(JAMES_PROFILE);
  const feed = rankDiscoverFeed(vector, SPOTS);
  const vinylRank = feed.findIndex(s => s.id === 's1');
  const boxcarRank = feed.findIndex(s => s.id === 's6');
  assert(vinylRank < boxcarRank,
    `Vinyl District (rank ${vinylRank}) should rank higher than Boxcar (rank ${boxcarRank}) for music-loving James`);
}));

tests.push(test('Boxcar DC ranks higher for Marcus than for James', () => {
  const { vector: jVector } = rebuildProfile(JAMES_PROFILE);
  const { vector: mVector } = rebuildProfile(MARCUS_PROFILE);
  const jFeed = rankDiscoverFeed(jVector, SPOTS);
  const mFeed = rankDiscoverFeed(mVector, SPOTS);
  const jBoxcar = jFeed.findIndex(s => s.id === 's6');
  const mBoxcar = mFeed.findIndex(s => s.id === 's6');
  assert(mBoxcar <= jBoxcar,
    `Boxcar should rank higher (or equal) for Marcus (${mBoxcar}) vs James (${jBoxcar})`);
}));

console.log('\n━━ Engine 2: Group Plan Generation ━━');

const PARTY_MEMBERS = [
  { userId: 'james',  tasteProfile: JAMES_PROFILE,  tonightOverrides: { budget: 35, availableFromMinutes: 19*60, energyLevel: 'medium' } },
  { userId: 'kaya',   tasteProfile: KAYA_PROFILE,   tonightOverrides: { budget: 30, availableFromMinutes: 19*60, energyLevel: 'medium' } },
  { userId: 'marcus', tasteProfile: MARCUS_PROFILE, tonightOverrides: { budget: 50, availableFromMinutes: 20*60, energyLevel: 'high'   } },
];

tests.push(test('generateGroupPlans returns 3 plans with stops', async () => {
  const { plans } = await generateGroupPlans(PARTY_MEMBERS, SPOTS);
  assert(plans.length === 3, `Expected 3 plans, got ${plans.length}`);
  for (const plan of plans) {
    assert(plan.stops?.length >= 1, `Plan "${plan.label}" needs at least 1 stop`);
  }
}));

tests.push(test('generateGroupPlans respects effective budget (min = $30)', async () => {
  const { plans, effectiveBudget } = await generateGroupPlans(PARTY_MEMBERS, SPOTS);
  assert(effectiveBudget === 30, `effectiveBudget should be 30 (Kaya's budget), got ${effectiveBudget}`);
  for (const plan of plans) {
    for (const stop of plan.stops) {
      const tierCosts = { 1: 10, 2: 22, 3: 45, 4: 80 };
      const cost = tierCosts[stop.priceTier] || 22;
      assert(cost <= effectiveBudget * 1.1,
        `Stop "${stop.name}" (tier ${stop.priceTier}, ~$${cost}) exceeds effective budget ($${effectiveBudget})`);
    }
  }
}));

tests.push(test('generateGroupPlans returns groupVibeTags', async () => {
  const { groupVibeTags } = await generateGroupPlans(PARTY_MEMBERS, SPOTS);
  assert(Array.isArray(groupVibeTags) && groupVibeTags.length > 0,
    'Should return non-empty groupVibeTags array');
}));

tests.push(test('analyzeGroupCompatibility returns compatibility score', () => {
  const result = analyzeGroupCompatibility(PARTY_MEMBERS);
  assertRange(result.overallCompatibility, 0, 100, 'overallCompatibility');
  assert(result.groupVibeTags?.length > 0, 'Should return group vibe tags');
  assert(result.composite, 'Should return composite vector');
}));

tests.push(test('Plans have distinct labels (Best match, Budget-friendly, Wildcard night)', async () => {
  const { plans } = await generateGroupPlans(PARTY_MEMBERS, SPOTS);
  const labels = plans.map(p => p.label);
  assert(labels.includes('Best match'),        `Expected "Best match" label, got: ${labels.join(', ')}`);
  assert(labels.includes('Budget-friendly'),   `Expected "Budget-friendly" label`);
  assert(labels.includes('Wildcard night'),    `Expected "Wildcard night" label`);
}));

tests.push(test('Budget warning does not reveal which member has the lower budget', async () => {
  const { plans } = await generateGroupPlans(PARTY_MEMBERS, SPOTS);
  for (const plan of plans) {
    for (const warning of (plan.budgetWarnings || [])) {
      assert(!warning.includes('james') && !warning.includes('kaya') && !warning.includes('marcus'),
        'Budget warning should not name any individual');
      assert(!warning.includes('$30') && !warning.includes('$35'),
        'Budget warning should not reveal specific budget amounts');
    }
  }
}));

console.log('\n━━ Feedback Loop Integration ━━');

tests.push(test('applyFeedback updates profile after positive outing', () => {
  const batch = {
    explicitReactions: [
      { reactionType: 'HEART', spotAttributes: { energyScore: 0.65, socialDensity: 0.70, vibeTags: ['lively', 'social'], noveltyScore: 0.60 }, timestamp: new Date().toISOString() },
      { reactionType: 'REPEAT', spotAttributes: { energyScore: 0.50, vibeTags: ['communal'], noveltyScore: 0.55 }, timestamp: new Date().toISOString() },
    ],
    passiveSignals: [
      { type: 'memoryPosted', spotAttributes: { energyScore: 0.65, vibeTags: ['lively'], category: 'Restaurant' }, timestamp: new Date().toISOString() }
    ],
  };

  const flatProfile = {
    energyLevel: 0.5, socialOpenness: 0.5, spontaneity: 0.5,
    culturalAppetite: 0.5, foodPriority: 0.5, outdoorPreference: 0.5,
    budgetSensitivity: 0.5, nightOwlScore: 0.5, activityDiversity: 0.5,
    noveltyAppetite: 0.5, groupSizePref: 0.5, physicalEnergy: 0.5,
  };

  const { changed, nudgesApplied, updatedVector } = applyFeedback(flatProfile, batch);
  assert(changed, 'Profile should be marked as changed');
  assert(nudgesApplied >= 2, `At least 2 nudges should be applied, got ${nudgesApplied}`);

  for (const [dim, val] of Object.entries(updatedVector)) {
    if (typeof val === 'number') {
      assert(val >= 0 && val <= 1, `${dim} = ${val} outside [0, 1] after feedback`);
    }
  }
}));

// ── RUN ALL ASYNC TESTS AND SUMMARIZE ─────────────────────────────────
Promise.all(tests).then(() => {
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Integration Tests: ${passed}/${total} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
});
