// ─────────────────────────────────────────────────────────────────────
// rendezvous-engine/src/config.js
// All tunable parameters in one place. Adjust weights here based on
// real user data once the engine is running in production.
// ─────────────────────────────────────────────────────────────────────

// ── ENGINE 1: SIGNAL HIERARCHY WEIGHTS ───────────────────────────────
// Must sum to 1.0. Adjust based on measured prediction accuracy.
const SIGNAL_WEIGHTS = {
  spotify:      0.30,
  instagram:    0.22,
  mbti:         0.18,
  tiktok:       0.14,
  pinterest:    0.10,
  survey:       0.06,
};

// ── ENGINE 1: TASTE VECTOR DIMENSIONS ────────────────────────────────
// All dimensions are floats 0.0–1.0
const VECTOR_DIMS = [
  'energyLevel',        // 0 = very chill, 1 = high energy
  'socialOpenness',     // 0 = closed/intimate, 1 = open/social
  'spontaneity',        // 0 = structured, 1 = spontaneous
  'culturalAppetite',   // 0 = mainstream, 1 = underground/niche
  'foodPriority',       // 0 = food incidental, 1 = food is the event
  'outdoorPreference',  // 0 = strictly indoors, 1 = outdoors strongly preferred
  'budgetSensitivity',  // 0 = price-insensitive, 1 = very budget-conscious
  'nightOwlScore',      // 0 = morning person, 1 = night owl
  'activityDiversity',  // 0 = one type of activity, 1 = loves variety
  'noveltyAppetite',    // 0 = comfort of familiar, 1 = always wants new
  'groupSizePref',      // 0 = intimate small group, 1 = loves crowds
  'physicalEnergy',     // 0 = seated/relaxed, 1 = active/on-the-move
];

// ── ENGINE 1: SIGNAL DECAY ────────────────────────────────────────────
const DECAY = {
  // Half-life in days for each signal type
  halfLifeDays: {
    spotify:      90,
    instagram:    90,
    mbti:         365,  // personality baseline changes slowly
    tiktok:       60,
    pinterest:    90,
    survey:       180,
    feedback:     60,   // post-outing reactions decay faster
    behavioral:   45,   // passive scroll/save signals decay fastest
  },
  // Minimum weight floor — signals never decay to zero
  minWeight:    0.05,
  // Seasonal correction window (days) — detect patterns across this window
  seasonalWindowDays: 365,
};

// ── ENGINE 1: COLD START ──────────────────────────────────────────────
const COLD_START = {
  // Minimum confidence score before personalization kicks in
  minConfidenceThreshold: 0.25,
  // Scroll events required before feed begins shifting
  minScrollEvents: 15,
  // Confidence contribution per signal source (max values)
  confidenceContributions: {
    spotify:      0.20,
    instagram:    0.15,
    mbti:         0.15,
    tiktok:       0.10,
    pinterest:    0.10,
    survey:       0.10,
    scrollBehavior: 0.20,
  },
};

// ── ENGINE 1: FEEDBACK NUDGE STRENGTHS ───────────────────────────────
const FEEDBACK_NUDGE = {
  heart:           0.05,  // explicit "loved it"
  repeat:          0.03,  // explicit "want to go back"
  saved:           0.03,  // saved to shelf
  addedToParty:    0.05,  // added to an active party
  memoryPosted:    0.06,  // created a memory at this spot
  revisited:       0.08,  // visited the same spot again
  scrolledPast:   -0.01,  // repeatedly scrolled past without engaging
  negativeVote:   -0.02,  // voted against this plan option
  suppressDays:    30,    // days to suppress a repeatedly-skipped spot
};

// ── ENGINE 2: VIBE SPECTRUM ───────────────────────────────────────────
const VIBE_SPECTRUM = {
  // Tolerance radius around group centroid (how far a spot can deviate)
  defaultToleranceRadius: 0.30,
  // Conflict threshold — flag vibe disagreement above this std dev
  conflictThreshold: 0.35,
  // Primary matching dimensions (in order of importance)
  primaryDimensions: [
    'energyLevel',
    'socialOpenness',
    'physicalEnergy',
    'groupSizePref',
  ],
  // Secondary dimensions factored in after primary
  secondaryDimensions: [
    'nightOwlScore',
    'noveltyAppetite',
    'outdoorPreference',
    'activityDiversity',
  ],
};

// ── ENGINE 2: SPOT SCORING WEIGHTS ───────────────────────────────────
// Must sum to 1.0
const SPOT_SCORE_WEIGHTS = {
  vibeTagOverlap:      0.25,
  energyMatch:         0.20,
  socialDensityMatch:  0.15,
  noveltyFit:          0.12,
  categoryAffinity:    0.12,
  priorVisitBonus:     0.08,
  multiActivityBonus:  0.05,
  freshnessBonus:      0.03,
};

// ── ENGINE 2: CONTEXT MODIFIERS ───────────────────────────────────────
const CONTEXT = {
  weather: {
    rainOutdoorPenalty:    -0.20,
    coldOutdoorPenalty:    -0.15,  // below 45°F
    warmOutdoorBonus:      +0.15,  // above 65°F and clear
    extremeHeatPenalty:    -0.10,  // above 90°F
  },
  timeOfDay: {
    eveningEnergyBoost:    +0.10,  // Thu–Sat 8pm–midnight
    lateNightBoost:        +0.08,  // after midnight
    sundayMorningCalm:     -0.15,  // Sunday before noon — penalise high-energy
    weekdayModifier:       -0.05,  // Mon–Wed — softer vibe expected
  },
  repetition: {
    suppressAfterNSuggestions: 3,
    suppressDays:              30,
    lovedSpotBonus:           +0.15,
    repeatVisitBonus:         +0.10,
  },
  inactivity: {
    // Days since last group outing before novelty boost kicks in
    noveltyBoostAfterDays:  14,
    noveltyBoostStrength:   +0.10,
  },
  localEvents: {
    nearbyEventBonus:       +0.08,  // relevant event within 1 mile tonight
    eventRadiusMiles:        1.0,
  },
};

// ── ENGINE 2: ITINERARY ASSEMBLY ─────────────────────────────────────
const ITINERARY = {
  // Stop count based on availability window
  stopsForShortWindow:   2,  // < 2 hours
  stopsForLongWindow:    3,  // >= 2.5 hours
  availabilityThreshold: 150, // minutes
  // Walkability threshold
  walkableRadiusMiles:   0.75,
  // Budget hard cap multiplier (spot cost cannot exceed budget * this)
  budgetCapMultiplier:   1.0,  // strict — no soft warns at itinerary level
  // Diversity penalty for plan options sharing stops
  diversityPenalty:      0.30,
  // Plan option labels
  planLabels: ['Best match', 'Budget-friendly', 'Wildcard night'],
};

// ── MBTI DIMENSION MAPPINGS ───────────────────────────────────────────
const MBTI_MAP = {
  E: { socialOpenness: +0.30, energyLevel: +0.20, groupSizePref: +0.20 },
  I: { socialOpenness: -0.30, culturalAppetite: +0.10, groupSizePref: -0.20 },
  S: { foodPriority: +0.20, spontaneity: -0.10, noveltyAppetite: -0.10 },
  N: { culturalAppetite: +0.20, spontaneity: +0.10, noveltyAppetite: +0.15 },
  T: { activityDiversity: +0.10 },
  F: { culturalAppetite: +0.15, outdoorPreference: +0.10, socialOpenness: +0.05 },
  J: { spontaneity: -0.30, activityDiversity: -0.05 },
  P: { spontaneity: +0.30, activityDiversity: +0.10, noveltyAppetite: +0.10 },
};

// ── ACTIVITY → VECTOR MAPPINGS ────────────────────────────────────────
const ACTIVITY_MAP = {
  'food':         { foodPriority: +0.30, socialOpenness: +0.10 },
  'music':        { energyLevel: +0.20, culturalAppetite: +0.20, nightOwlScore: +0.10 },
  'thrifting':    { culturalAppetite: +0.15, activityDiversity: +0.10, noveltyAppetite: +0.10 },
  'art':          { culturalAppetite: +0.30, noveltyAppetite: +0.10 },
  'outdoor':      { outdoorPreference: +0.40, energyLevel: +0.10, physicalEnergy: +0.15 },
  'gaming':       { socialOpenness: +0.10, activityDiversity: +0.20, groupSizePref: +0.10 },
  'movies':       { activityDiversity: +0.10, groupSizePref: -0.05 },
  'events':       { spontaneity: +0.20, socialOpenness: +0.15, noveltyAppetite: +0.15 },
  'sports':       { energyLevel: +0.30, outdoorPreference: +0.20, physicalEnergy: +0.30 },
  'chill':        { energyLevel: -0.20, spontaneity: -0.10, physicalEnergy: -0.10 },
  'comics':       { culturalAppetite: +0.15, activityDiversity: +0.10 },
  'markets':      { culturalAppetite: +0.10, socialOpenness: +0.10, outdoorPreference: +0.10 },
  'comedy':       { socialOpenness: +0.20, energyLevel: +0.10, groupSizePref: +0.10 },
  'late-night':   { nightOwlScore: +0.30, spontaneity: +0.10, energyLevel: +0.10 },
  'coffee':       { culturalAppetite: +0.10, energyLevel: -0.10, groupSizePref: -0.05 },
  'dance':        { energyLevel: +0.30, socialOpenness: +0.20, nightOwlScore: +0.20, physicalEnergy: +0.20 },
};

// ── VIBE TAG → VECTOR MAPPINGS ────────────────────────────────────────
const VIBE_MAP = {
  'chill':        { energyLevel: -0.20, spontaneity: -0.10, physicalEnergy: -0.10 },
  'spontaneous':  { spontaneity: +0.35, noveltyAppetite: +0.10 },
  'adventurous':  { spontaneity: +0.20, activityDiversity: +0.20, outdoorPreference: +0.10, physicalEnergy: +0.10 },
  'outdoors':     { outdoorPreference: +0.35, physicalEnergy: +0.10 },
  'social':       { socialOpenness: +0.30, energyLevel: +0.10, groupSizePref: +0.15 },
  'indoors':      { outdoorPreference: -0.25, physicalEnergy: -0.05 },
  'creative':     { culturalAppetite: +0.20, noveltyAppetite: +0.10 },
  'low-key':      { energyLevel: -0.15, socialOpenness: -0.10, groupSizePref: -0.10 },
  'high-energy':  { energyLevel: +0.25, socialOpenness: +0.10, physicalEnergy: +0.15 },
  'planned':      { spontaneity: -0.30 },
};

// ── SPOTIFY GENRE → VECTOR MAPPINGS ──────────────────────────────────
const SPOTIFY_GENRE_MAP = [
  { patterns: ['hip-hop','r&b','afrobeats','reggaeton','dancehall','trap'],
    adjustments: { nightOwlScore: +0.15, socialOpenness: +0.10, energyLevel: +0.10, groupSizePref: +0.10 } },
  { patterns: ['classical','jazz','blues','folk','acoustic','singer-songwriter'],
    adjustments: { culturalAppetite: +0.20, energyLevel: -0.10, physicalEnergy: -0.05 } },
  { patterns: ['indie','alternative','art rock','experimental','post-rock'],
    adjustments: { culturalAppetite: +0.15, noveltyAppetite: +0.10 } },
  { patterns: ['lo-fi','ambient','chillhop','new age'],
    adjustments: { energyLevel: -0.20, physicalEnergy: -0.10 } },
  { patterns: ['electronic','edm','house','techno','drum and bass'],
    adjustments: { energyLevel: +0.20, nightOwlScore: +0.20, physicalEnergy: +0.15, groupSizePref: +0.10 } },
  { patterns: ['pop','mainstream'],
    adjustments: { socialOpenness: +0.10, groupSizePref: +0.05 } },
  { patterns: ['country','bluegrass','americana'],
    adjustments: { outdoorPreference: +0.10, activityDiversity: +0.05 } },
  { patterns: ['metal','hardcore','punk'],
    adjustments: { energyLevel: +0.25, culturalAppetite: +0.10, noveltyAppetite: +0.10 } },
  { patterns: ['gospel','soul','motown'],
    adjustments: { socialOpenness: +0.15, foodPriority: +0.05 } },
];

// ── INSTAGRAM HASHTAG → CATEGORY MAPPINGS ─────────────────────────────
const INSTAGRAM_HASHTAG_MAP = {
  food:     ['food','foodie','restaurant','brunch','dinner','lunch','cafe','coffee','eats','culinary','chef'],
  music:    ['music','concert','livemusic','vinyl','records','jazz','hiphop','rnb','festival'],
  art:      ['art','gallery','museum','artist','design','photography','creative','aesthetic'],
  outdoor:  ['outdoor','nature','hiking','park','adventure','travel','explore','wanderlust'],
  nightlife:['nightlife','bar','cocktails','rooftop','club','lateni','drinks'],
  culture:  ['culture','heritage','history','architecture','local','community'],
  shopping: ['thrift','thrifting','vintage','shopping','fashion','style','ootd'],
  events:   ['event','popup','market','festival','show','performance','opening'],
};

// ── ACTIVITY → SPOT CATEGORY MAPPINGS ────────────────────────────────
const ACTIVITY_TO_SPOT_CATEGORY = {
  food:       ['Restaurant','Café','Beer Garden','Food Market','Food Hall'],
  music:      ['Record Store','Music Venue','Arcade Bar','Jazz Club'],
  art:        ['Art Space','Art Studios','Gallery','Museum'],
  outdoor:    ['Beer Garden','Park','Outdoor Market','Rooftop Bar'],
  thrifting:  ['Thrift Store','Record Store','Vintage Shop','Market','Bookstore'],
  gaming:     ['Arcade Bar','Game Bar','Arcade','Bowling Alley'],
  events:     ['Pop-up','Event Space','Market','Music Venue','Comedy Club'],
  coffee:     ['Café','Coffee Shop','Roastery'],
  comics:     ['Bookstore','Comic Shop','Used Bookstore'],
  markets:    ['Market','Food Market','Flea Market','Farmers Market'],
  chill:      ['Café','Beer Garden','Bookstore','Park','Rooftop Bar'],
  dance:      ['Club','Dance Bar','Live Music Venue'],
};

module.exports = {
  SIGNAL_WEIGHTS,
  VECTOR_DIMS,
  DECAY,
  COLD_START,
  FEEDBACK_NUDGE,
  VIBE_SPECTRUM,
  SPOT_SCORE_WEIGHTS,
  CONTEXT,
  ITINERARY,
  MBTI_MAP,
  ACTIVITY_MAP,
  VIBE_MAP,
  SPOTIFY_GENRE_MAP,
  INSTAGRAM_HASHTAG_MAP,
  ACTIVITY_TO_SPOT_CATEGORY,
};
