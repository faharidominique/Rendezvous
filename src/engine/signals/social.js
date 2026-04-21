// ─────────────────────────────────────────────────────────────────────
// rendezvous-engine/src/signals/instagram.js
// ─────────────────────────────────────────────────────────────────────
const { INSTAGRAM_HASHTAG_MAP, SIGNAL_WEIGHTS, ACTIVITY_MAP } = require('../config');

function processInstagramSignals(signals) {
  if (!signals) return { adjustments: {}, confidence: 0 };

  const adj = {};
  let dataPoints = 0;

  // Hashtag category distribution
  if (signals.hashtagCategories) {
    for (const [category, count] of Object.entries(signals.hashtagCategories)) {
      const activityAdj = ACTIVITY_MAP[category.toLowerCase()];
      if (activityAdj && count > 0) {
        // Weight by count but cap contribution per category
        const weight = Math.min(0.25, count * 0.04);
        for (const [dim, delta] of Object.entries(activityAdj)) {
          adj[dim] = (adj[dim] || 0) + delta * weight;
        }
        dataPoints += count;
      }
    }
  }

  // Late night posting pattern → night owl signal
  if (signals.lateNightPostRatio !== undefined) {
    // lateNightPostRatio: fraction of posts between 10pm–4am
    adj.nightOwlScore = (adj.nightOwlScore || 0) + (signals.lateNightPostRatio - 0.15) * 0.6;
    dataPoints += 2;
  }

  // Saved content categories (strongest Instagram signal)
  if (signals.savedCategories) {
    for (const [category, count] of Object.entries(signals.savedCategories)) {
      const activityAdj = ACTIVITY_MAP[category.toLowerCase()];
      if (activityAdj && count > 0) {
        // Saved content gets 1.5x weight vs regular posts — stronger intent signal
        const weight = Math.min(0.35, count * 0.06);
        for (const [dim, delta] of Object.entries(activityAdj)) {
          adj[dim] = (adj[dim] || 0) + delta * weight * 1.5;
        }
        dataPoints += count * 2;
      }
    }
  }

  // Location tag diversity → outdoor/exploration preference
  if (signals.uniqueLocationCount !== undefined) {
    // Many different tagged locations = explorer tendency
    const explorationScore = Math.min(1.0, signals.uniqueLocationCount / 20);
    adj.noveltyAppetite    = (adj.noveltyAppetite || 0) + explorationScore * 0.15;
    adj.outdoorPreference  = (adj.outdoorPreference || 0) + explorationScore * 0.10;
    dataPoints += 2;
  }

  // Scale by Instagram's signal weight
  const scaled = {};
  for (const [dim, delta] of Object.entries(adj)) {
    scaled[dim] = delta * SIGNAL_WEIGHTS.instagram;
  }

  const confidence = Math.min(0.15, dataPoints * 0.008);
  return { adjustments: scaled, confidence };
}

/**
 * Extract signals from raw Instagram Basic Display API response.
 * media: array of media objects with caption, timestamp, media_type
 */
function extractFromInstagramAPI(media, savedMedia = []) {
  const signals = {};
  const hashtagCounts = {};
  const savedCategoryCounts = {};
  let lateNightCount = 0;
  const locationSet = new Set();

  // Process regular posts
  for (const item of media) {
    // Extract hashtags from caption
    const hashtags = (item.caption || '').match(/#[\w]+/g) || [];
    for (const tag of hashtags) {
      const cleanTag = tag.slice(1).toLowerCase();
      // Map to categories
      for (const [category, keywords] of Object.entries(INSTAGRAM_HASHTAG_MAP)) {
        if (keywords.some(k => cleanTag.includes(k))) {
          hashtagCounts[category] = (hashtagCounts[category] || 0) + 1;
        }
      }
    }

    // Late night posting
    if (item.timestamp) {
      const hour = new Date(item.timestamp).getHours();
      if (hour >= 22 || hour <= 4) lateNightCount++;
    }

    // Location tags
    if (item.id) locationSet.add(item.id.split('_')[0]);
  }

  signals.hashtagCategories = hashtagCounts;
  signals.lateNightPostRatio = media.length > 0 ? lateNightCount / media.length : 0;
  signals.uniqueLocationCount = locationSet.size;
  signals.postCount = media.length;

  // Process saved content (higher weight)
  for (const item of savedMedia) {
    const hashtags = (item.caption || '').match(/#[\w]+/g) || [];
    for (const tag of hashtags) {
      const cleanTag = tag.slice(1).toLowerCase();
      for (const [category, keywords] of Object.entries(INSTAGRAM_HASHTAG_MAP)) {
        if (keywords.some(k => cleanTag.includes(k))) {
          savedCategoryCounts[category] = (savedCategoryCounts[category] || 0) + 1;
        }
      }
    }
  }
  signals.savedCategories = savedCategoryCounts;

  return signals;
}

module.exports = { processInstagramSignals, extractFromInstagramAPI };


// ─────────────────────────────────────────────────────────────────────
// rendezvous-engine/src/signals/pinterest.js
// ─────────────────────────────────────────────────────────────────────
const pinterestConfig = require('../config');

function processPinterestSignals(signals) {
  if (!signals) return { adjustments: {}, confidence: 0 };

  const adj = {};
  let dataPoints = 0;

  // Board category distribution
  if (signals.boardCategories) {
    for (const [category, count] of Object.entries(signals.boardCategories)) {
      const activityAdj = pinterestConfig.ACTIVITY_MAP[category.toLowerCase()];
      if (activityAdj && count > 0) {
        const weight = Math.min(0.25, count * 0.05);
        for (const [dim, delta] of Object.entries(activityAdj)) {
          adj[dim] = (adj[dim] || 0) + delta * weight;
        }
        dataPoints += count;
      }
    }
  }

  // Travel boards → outdoor + novelty
  if (signals.hasTravelBoards) {
    adj.outdoorPreference = (adj.outdoorPreference || 0) + 0.15;
    adj.noveltyAppetite   = (adj.noveltyAppetite || 0) + 0.10;
    adj.spontaneity       = (adj.spontaneity || 0) + 0.08;
    dataPoints += 3;
  }

  // Food boards → food priority
  if (signals.hasFoodBoards) {
    adj.foodPriority = (adj.foodPriority || 0) + 0.15;
    dataPoints += 2;
  }

  // "Places to go" / "bucket list" style boards → high novelty appetite
  if (signals.hasGoalBoards) {
    adj.noveltyAppetite = (adj.noveltyAppetite || 0) + 0.15;
    adj.spontaneity     = (adj.spontaneity || 0) + 0.10;
    dataPoints += 2;
  }

  // Aesthetic boards (interior design, fashion, etc.) → cultural appetite
  if (signals.hasAestheticBoards) {
    adj.culturalAppetite = (adj.culturalAppetite || 0) + 0.12;
    dataPoints += 2;
  }

  // Pin count diversity → activity diversity
  if (signals.uniqueCategoryCount !== undefined) {
    const diversityScore = Math.min(1.0, signals.uniqueCategoryCount / 10);
    adj.activityDiversity = (adj.activityDiversity || 0) + diversityScore * 0.15;
    dataPoints += 1;
  }

  const scaled = {};
  for (const [dim, delta] of Object.entries(adj)) {
    scaled[dim] = delta * pinterestConfig.SIGNAL_WEIGHTS.pinterest;
  }

  const confidence = Math.min(0.10, dataPoints * 0.007);
  return { adjustments: scaled, confidence };
}

/**
 * Extract Pinterest signals from boards and pins API data.
 */
function extractFromPinterestAPI(boards, pins = []) {
  const signals = {};
  const categoryCounts = {};
  const TRAVEL_KEYWORDS   = ['travel','trip','vacation','places','destinations','bucket','adventure','explore','wanderlust'];
  const FOOD_KEYWORDS     = ['food','recipe','eat','kitchen','cook','restaurant','brunch','dinner'];
  const GOAL_KEYWORDS     = ['places to go','want to visit','someday','bucket list','to do','goals'];
  const AESTHETIC_KEYWORDS= ['aesthetic','decor','interior','fashion','style','outfit','design','art'];

  let hasTravelBoards = false, hasFoodBoards = false, hasGoalBoards = false, hasAestheticBoards = false;

  for (const board of boards) {
    const name = (board.name || '').toLowerCase();
    const desc = (board.description || '').toLowerCase();
    const combined = `${name} ${desc}`;

    if (TRAVEL_KEYWORDS.some(k => combined.includes(k)))   hasTravelBoards = true;
    if (FOOD_KEYWORDS.some(k => combined.includes(k)))     hasFoodBoards = true;
    if (GOAL_KEYWORDS.some(k => combined.includes(k)))     hasGoalBoards = true;
    if (AESTHETIC_KEYWORDS.some(k => combined.includes(k))) hasAestheticBoards = true;

    // Map board category to activity categories
    const category = mapBoardToCategory(name);
    if (category) categoryCounts[category] = (categoryCounts[category] || 0) + 1;
  }

  // Process pins for additional signals
  for (const pin of pins) {
    const title = (pin.title || '').toLowerCase();
    const category = mapBoardToCategory(title);
    if (category) categoryCounts[category] = (categoryCounts[category] || 0) + 0.5;
  }

  signals.boardCategories     = categoryCounts;
  signals.hasTravelBoards     = hasTravelBoards;
  signals.hasFoodBoards       = hasFoodBoards;
  signals.hasGoalBoards       = hasGoalBoards;
  signals.hasAestheticBoards  = hasAestheticBoards;
  signals.uniqueCategoryCount = Object.keys(categoryCounts).length;
  signals.boardCount          = boards.length;

  return signals;
}

function mapBoardToCategory(text) {
  const t = text.toLowerCase();
  if (['food','recipe','restaurant','eat','cook','cafe','coffee'].some(k => t.includes(k)))  return 'food';
  if (['music','concert','vinyl','record','playlist'].some(k => t.includes(k)))              return 'music';
  if (['art','gallery','museum','creative','design'].some(k => t.includes(k)))               return 'art';
  if (['outdoor','hiking','nature','garden','park'].some(k => t.includes(k)))                return 'outdoor';
  if (['thrift','vintage','shop','fashion','style'].some(k => t.includes(k)))               return 'thrifting';
  if (['book','read','literature','library'].some(k => t.includes(k)))                       return 'comics';
  if (['event','festival','market','fair'].some(k => t.includes(k)))                         return 'events';
  if (['sport','fitness','workout','gym','yoga'].some(k => t.includes(k)))                   return 'sports';
  return null;
}

module.exports.processPinterestSignals = processPinterestSignals;
module.exports.extractFromPinterestAPI = extractFromPinterestAPI;


// ─────────────────────────────────────────────────────────────────────
// rendezvous-engine/src/signals/tiktok.js
// ─────────────────────────────────────────────────────────────────────
const tiktokConfig = require('../config');

function processTikTokSignals(signals) {
  if (!signals) return { adjustments: {}, confidence: 0 };

  const adj = {};
  let dataPoints = 0;

  // Liked video categories
  if (signals.likedCategories) {
    for (const [category, count] of Object.entries(signals.likedCategories)) {
      const activityAdj = tiktokConfig.ACTIVITY_MAP[category.toLowerCase()];
      if (activityAdj && count > 0) {
        const weight = Math.min(0.20, count * 0.035);
        for (const [dim, delta] of Object.entries(activityAdj)) {
          adj[dim] = (adj[dim] || 0) + delta * weight;
        }
        dataPoints += count;
      }
    }
  }

  // Creator niches followed
  if (signals.followedNiches) {
    for (const [niche, count] of Object.entries(signals.followedNiches)) {
      const activityAdj = tiktokConfig.ACTIVITY_MAP[niche.toLowerCase()];
      if (activityAdj && count > 0) {
        // Following is a stronger signal than liking
        const weight = Math.min(0.25, count * 0.05);
        for (const [dim, delta] of Object.entries(activityAdj)) {
          adj[dim] = (adj[dim] || 0) + delta * weight * 1.3;
        }
        dataPoints += count * 2;
      }
    }
  }

  // Video sound/music affinity
  if (signals.topSoundGenres?.length) {
    // Reuse Spotify genre processing for music signals from TikTok sounds
    const { processGenres } = require('./spotify');
    const musicAdj = processGenres(signals.topSoundGenres);
    for (const [dim, delta] of Object.entries(musicAdj)) {
      // TikTok music signals are weaker than Spotify — scale down
      adj[dim] = (adj[dim] || 0) + delta * 0.5;
    }
    dataPoints += signals.topSoundGenres.length;
  }

  const scaled = {};
  for (const [dim, delta] of Object.entries(adj)) {
    scaled[dim] = delta * tiktokConfig.SIGNAL_WEIGHTS.tiktok;
  }

  const confidence = Math.min(0.10, dataPoints * 0.006);
  return { adjustments: scaled, confidence };
}

/**
 * Extract TikTok signals from API data.
 * likedVideos: array of liked video objects
 * followedCreators: array of followed creator objects
 */
function extractFromTikTokAPI(likedVideos = [], followedCreators = []) {
  const signals = {};
  const NICHE_KEYWORDS = {
    food:     ['food','cooking','recipe','restaurant','mukbang','foodie','chef'],
    music:    ['music','musician','dj','concert','band','producer','vinyl'],
    art:      ['art','artist','painting','drawing','creative','design','pottery'],
    outdoor:  ['outdoor','hiking','camping','travel','nature','adventure'],
    fashion:  ['fashion','outfit','style','thrift','vintage','ootd','closet'],
    fitness:  ['fitness','gym','workout','yoga','sports','athlete'],
    comedy:   ['comedy','funny','humor','skit','sketch'],
    gaming:   ['gaming','gamer','twitch','esports','videogames'],
    culture:  ['culture','history','documentary','education','facts'],
  };

  const likedCategoryCounts = {};
  const soundCounts = {};
  const followedNicheCounts = {};

  for (const video of likedVideos) {
    const desc = (video.description || video.desc || '').toLowerCase();
    const hashtags = (desc.match(/#[\w]+/g) || []).map(t => t.slice(1));
    const allText = `${desc} ${hashtags.join(' ')}`;

    for (const [niche, keywords] of Object.entries(NICHE_KEYWORDS)) {
      if (keywords.some(k => allText.includes(k))) {
        likedCategoryCounts[niche] = (likedCategoryCounts[niche] || 0) + 1;
      }
    }

    if (video.music?.genre) soundCounts[video.music.genre] = (soundCounts[video.music.genre] || 0) + 1;
  }

  for (const creator of followedCreators) {
    const bio = (creator.bio || creator.signature || '').toLowerCase();
    for (const [niche, keywords] of Object.entries(NICHE_KEYWORDS)) {
      if (keywords.some(k => bio.includes(k))) {
        followedNicheCounts[niche] = (followedNicheCounts[niche] || 0) + 1;
      }
    }
  }

  signals.likedCategories = likedCategoryCounts;
  signals.followedNiches  = followedNicheCounts;
  signals.topSoundGenres  = Object.entries(soundCounts).sort((a,b) => b[1]-a[1]).slice(0,10).map(([g]) => g);
  signals.likedCount      = likedVideos.length;

  return signals;
}

module.exports.processTikTokSignals = processTikTokSignals;
module.exports.extractFromTikTokAPI = extractFromTikTokAPI;
