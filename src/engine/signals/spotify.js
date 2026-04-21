// ─────────────────────────────────────────────────────────────────────
// rendezvous-engine/src/signals/spotify.js
// Processes raw Spotify API data into taste vector adjustments.
// Input: raw signal object stored after Spotify sync
// Output: partial vector adjustments + confidence delta
// ─────────────────────────────────────────────────────────────────────
const { apply, clamp, neutral } = require('../utils/vector');
const { SPOTIFY_GENRE_MAP, SIGNAL_WEIGHTS } = require('../config');

/**
 * Process Spotify audio features into vector adjustments.
 * audioFeatures: { avgEnergy, avgValence, avgDanceability, avgAcousticness,
 *                  avgTempo, avgLoudness, avgSpeechiness, avgInstrumentalness }
 */
function processAudioFeatures(audioFeatures) {
  const adj = {};

  if (audioFeatures.avgEnergy !== undefined) {
    // Energy maps directly to energyLevel and physicalEnergy
    adj.energyLevel   = (audioFeatures.avgEnergy - 0.5) * 0.6;
    adj.physicalEnergy = (audioFeatures.avgEnergy - 0.5) * 0.3;
  }

  if (audioFeatures.avgValence !== undefined) {
    // High valence (happy) → more social, slightly more outdoor
    adj.socialOpenness  = (audioFeatures.avgValence - 0.5) * 0.3;
    adj.outdoorPreference = (audioFeatures.avgValence - 0.5) * 0.1;
  }

  if (audioFeatures.avgDanceability !== undefined) {
    // High danceability → night owl, social, energetic
    adj.nightOwlScore  = audioFeatures.avgDanceability * 0.25;
    adj.energyLevel    = (adj.energyLevel || 0) + audioFeatures.avgDanceability * 0.15;
    adj.groupSizePref  = (audioFeatures.avgDanceability - 0.5) * 0.15;
  }

  if (audioFeatures.avgAcousticness !== undefined) {
    // High acousticness → more chill, outdoor, cultural
    adj.outdoorPreference  = (adj.outdoorPreference || 0) + audioFeatures.avgAcousticness * 0.20;
    adj.energyLevel        = (adj.energyLevel || 0) - audioFeatures.avgAcousticness * 0.15;
    adj.culturalAppetite   = audioFeatures.avgAcousticness * 0.10;
  }

  if (audioFeatures.avgInstrumentalness !== undefined) {
    // High instrumentalness → more introspective, cultural
    adj.culturalAppetite  = (adj.culturalAppetite || 0) + audioFeatures.avgInstrumentalness * 0.10;
    adj.socialOpenness    = (adj.socialOpenness || 0) - audioFeatures.avgInstrumentalness * 0.05;
  }

  if (audioFeatures.avgTempo !== undefined) {
    // Tempo > 140 BPM correlates with high energy and dance culture
    if (audioFeatures.avgTempo > 140) {
      adj.energyLevel   = (adj.energyLevel || 0) + 0.10;
      adj.nightOwlScore = (adj.nightOwlScore || 0) + 0.08;
    } else if (audioFeatures.avgTempo < 90) {
      adj.energyLevel = (adj.energyLevel || 0) - 0.08;
    }
  }

  return adj;
}

/**
 * Process Spotify genre list into vector adjustments.
 * genres: string[] — e.g. ['hip-hop', 'r&b', 'jazz']
 */
function processGenres(genres) {
  if (!genres?.length) return {};
  const adj = {};
  const lowerGenres = genres.map(g => g.toLowerCase());

  for (const { patterns, adjustments } of SPOTIFY_GENRE_MAP) {
    const matchCount = patterns.filter(p => lowerGenres.some(g => g.includes(p))).length;
    if (matchCount > 0) {
      // Scale adjustment by how many patterns matched (up to 1.0)
      const scale = Math.min(1.0, matchCount / 2);
      for (const [dim, delta] of Object.entries(adjustments)) {
        adj[dim] = (adj[dim] || 0) + delta * scale;
      }
    }
  }

  return adj;
}

/**
 * Process listening time of day into night owl score adjustment.
 * peakHour: 0–23 (hour of day when user listens most)
 * listeningHourDistribution: optional array of 24 values (counts per hour)
 */
function processPeakHour(peakHour, listeningHourDistribution) {
  const adj = {};

  if (peakHour !== undefined) {
    if (peakHour >= 22 || peakHour <= 3) {
      adj.nightOwlScore = +0.25;
    } else if (peakHour >= 20) {
      adj.nightOwlScore = +0.15;
    } else if (peakHour >= 6 && peakHour <= 10) {
      adj.nightOwlScore = -0.15;
    } else if (peakHour >= 11 && peakHour <= 14) {
      adj.nightOwlScore = -0.05;
    }
  }

  // If we have full distribution, compute a richer night owl score
  if (listeningHourDistribution?.length === 24) {
    const total = listeningHourDistribution.reduce((s, v) => s + v, 0);
    if (total > 0) {
      const lateNightShare = listeningHourDistribution
        .slice(21).concat(listeningHourDistribution.slice(0, 4))
        .reduce((s, v) => s + v, 0) / total;
      adj.nightOwlScore = (lateNightShare - 0.2) * 0.8; // 20% late-night listening = neutral
    }
  }

  return adj;
}

/**
 * Main Spotify signal processor.
 * signals: raw object from database (stored after Spotify API sync)
 * Returns: { adjustments, confidence }
 */
function processSpotifySignals(signals) {
  if (!signals) return { adjustments: {}, confidence: 0 };

  const parts = [];
  let dataPoints = 0;

  // Audio features (highest signal quality)
  if (signals.avgEnergy !== undefined) {
    parts.push(processAudioFeatures(signals));
    dataPoints += 5; // counts for 5 data points — rich signal
  }

  // Genres
  if (signals.topGenres?.length) {
    parts.push(processGenres(signals.topGenres));
    dataPoints += signals.topGenres.length;
  }

  // Peak listening hour
  if (signals.peakHour !== undefined) {
    parts.push(processPeakHour(signals.peakHour, signals.listeningHourDistribution));
    dataPoints += 1;
  }

  // Merge all adjustments (sum them, then scale by weight)
  const merged = {};
  for (const adj of parts) {
    for (const [dim, delta] of Object.entries(adj)) {
      merged[dim] = (merged[dim] || 0) + delta;
    }
  }

  // Scale by Spotify's signal weight
  const scaled = {};
  for (const [dim, delta] of Object.entries(merged)) {
    scaled[dim] = delta * SIGNAL_WEIGHTS.spotify;
  }

  // Confidence contribution based on data richness
  const confidence = Math.min(0.20, dataPoints * 0.01);

  return { adjustments: scaled, confidence };
}

/**
 * Extract required signals from raw Spotify API responses.
 * Use this to normalize API data before storing in the database.
 */
function extractFromSpotifyAPI(topTracks, topArtists, recentlyPlayed, audioFeatures) {
  const signals = {};

  // Audio features from tracks
  if (audioFeatures?.length) {
    const valid = audioFeatures.filter(Boolean);
    if (valid.length) {
      signals.avgEnergy          = avg(valid.map(f => f.energy));
      signals.avgValence         = avg(valid.map(f => f.valence));
      signals.avgDanceability    = avg(valid.map(f => f.danceability));
      signals.avgAcousticness    = avg(valid.map(f => f.acousticness));
      signals.avgInstrumentalness= avg(valid.map(f => f.instrumentalness));
      signals.avgTempo           = avg(valid.map(f => f.tempo));
      signals.avgLoudness        = avg(valid.map(f => f.loudness));
      signals.trackCount         = valid.length;
    }
  }

  // Genres from top artists
  if (topArtists?.length) {
    const genreCounts = {};
    topArtists.forEach(artist => {
      (artist.genres || []).forEach(genre => {
        genreCounts[genre] = (genreCounts[genre] || 0) + 1;
      });
    });
    signals.topGenres = Object.entries(genreCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([genre]) => genre);
    signals.genreCount = Object.keys(genreCounts).length;
  }

  // Listening hour distribution from recently played
  if (recentlyPlayed?.length) {
    const hourDist = new Array(24).fill(0);
    recentlyPlayed.forEach(item => {
      const hour = new Date(item.played_at).getHours();
      hourDist[hour]++;
    });
    signals.listeningHourDistribution = hourDist;
    signals.peakHour = hourDist.indexOf(Math.max(...hourDist));
  }

  return signals;
}

function avg(arr) {
  if (!arr?.length) return undefined;
  return arr.reduce((s, v) => s + (v || 0), 0) / arr.length;
}

module.exports = { processSpotifySignals, extractFromSpotifyAPI, processAudioFeatures, processGenres, processPeakHour };
