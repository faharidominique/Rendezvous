// ─────────────────────────────────────────────────────────────────────
// rendezvous-engine/src/context/contextModifiers.js
// Applies real-world context signals to spot scores after primary matching.
// ─────────────────────────────────────────────────────────────────────
const { CONTEXT } = require('../config');
const { clamp, haversineMiles } = require('../utils/vector');

// ── TIME OF DAY MODIFIER ──────────────────────────────────────────────
/**
 * Adjust spot scores based on current day and time.
 * Returns a modifier float (negative = penalty, positive = bonus).
 */
function getTimeModifier(spot, now = new Date()) {
  const hour    = now.getHours();
  const dayOfWeek = now.getDay(); // 0 = Sunday, 6 = Saturday
  const isWeekend = dayOfWeek === 5 || dayOfWeek === 6; // Fri, Sat
  const isThursday = dayOfWeek === 4;
  const isSunday  = dayOfWeek === 0;
  const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 3; // Mon–Wed

  let modifier = 0;

  // Evening energy boost (Thu–Sat, 8pm–midnight)
  if ((isWeekend || isThursday) && hour >= 20 && hour < 24) {
    if (spot.energyScore > 0.5) {
      modifier += CONTEXT.timeOfDay.eveningEnergyBoost;
    }
  }

  // Late night boost (after midnight)
  if (hour >= 0 && hour < 4) {
    if (spot.vibeTags?.includes('late night') || spot.vibeTags?.includes('late-night')) {
      modifier += CONTEXT.timeOfDay.lateNightBoost;
    }
  }

  // Sunday morning — penalise high-energy spots
  if (isSunday && hour < 12) {
    if (spot.energyScore > 0.6) {
      modifier += CONTEXT.timeOfDay.sundayMorningCalm;
    }
  }

  // Weekday softener (Mon–Wed)
  if (isWeekday && spot.energyScore > 0.7) {
    modifier += CONTEXT.timeOfDay.weekdayModifier;
  }

  // Time window compatibility: match spot's best time to current time
  if (spot.timeWindows?.length) {
    const timeWindow = getCurrentTimeWindow(hour);
    if (spot.timeWindows.includes(timeWindow)) {
      modifier += 0.05; // small bonus for spots that peak at this time
    } else if (!spot.timeWindows.includes(timeWindow)) {
      modifier -= 0.03; // small penalty for off-peak spots
    }
  }

  return modifier;
}

function getCurrentTimeWindow(hour) {
  if (hour >= 6  && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'late-night';
}

// ── WEATHER MODIFIER ──────────────────────────────────────────────────
/**
 * Adjust spot scores based on current weather conditions.
 * weather: { condition: 'rain'|'clear'|'cloudy'|'snow', tempF: number }
 */
function getWeatherModifier(spot, weather) {
  if (!weather) return 0;
  const isOutdoor = spot.vibeTags?.some(t => ['outdoor', 'outdoors', 'beer garden'].includes(t.toLowerCase())) ||
                    spot.category === 'Beer Garden' || spot.category === 'Park';

  let modifier = 0;

  if (isOutdoor) {
    if (weather.condition === 'rain' || weather.condition === 'snow') {
      modifier += CONTEXT.weather.rainOutdoorPenalty;
    } else if (weather.condition === 'clear') {
      if (weather.tempF >= 65 && weather.tempF <= 85) {
        modifier += CONTEXT.weather.warmOutdoorBonus;
      } else if (weather.tempF > 90) {
        modifier += CONTEXT.weather.extremeHeatPenalty;
      } else if (weather.tempF < 45) {
        modifier += CONTEXT.weather.coldOutdoorPenalty;
      }
    } else if (weather.condition === 'cloudy' && weather.tempF < 55) {
      modifier += CONTEXT.weather.coldOutdoorPenalty * 0.5;
    }
  }

  return modifier;
}

// ── LOCAL EVENTS MODIFIER ─────────────────────────────────────────────
/**
 * Boost spots near relevant local events happening tonight.
 * events: [{ title, lat, lng, category, startTime }]
 * spot: spot object with lat/lng
 */
function getEventsModifier(spot, events = []) {
  if (!events.length || !spot.lat || !spot.lng) return 0;

  const nearbyEvents = events.filter(event => {
    if (!event.lat || !event.lng) return false;
    const dist = haversineMiles(spot.lat, spot.lng, event.lat, event.lng);
    return dist <= CONTEXT.localEvents.eventRadiusMiles;
  });

  if (nearbyEvents.length > 0) {
    return CONTEXT.localEvents.nearbyEventBonus;
  }

  return 0;
}

// ── REPETITION MODIFIER ───────────────────────────────────────────────
/**
 * Adjust scores based on how often a spot has been suggested/visited.
 * spotHistory: { suggestedCount, visitedCount, isLoved, lastSuggestedAt }
 */
function getRepetitionModifier(spot, spotHistory) {
  if (!spotHistory) return 0;
  let modifier = 0;

  if (spotHistory.isLoved) {
    modifier += CONTEXT.repetition.lovedSpotBonus;
  }

  if (spotHistory.visitedCount > 0 && !spotHistory.isLoved) {
    modifier += CONTEXT.repetition.repeatVisitBonus * 0.5;
  }

  if (spotHistory.suggestedCount >= CONTEXT.repetition.suppressAfterNSuggestions) {
    // Check if suggestion was recent
    const daysSinceLastSuggested = spotHistory.lastSuggestedAt
      ? (Date.now() - new Date(spotHistory.lastSuggestedAt).getTime()) / (1000 * 60 * 60 * 24)
      : 999;

    if (daysSinceLastSuggested < CONTEXT.repetition.suppressDays) {
      modifier -= 0.20; // suppress heavily
    }
  }

  return modifier;
}

// ── INACTIVITY NOVELTY BOOST ──────────────────────────────────────────
/**
 * Apply novelty boost when a group hasn't hung out in a while.
 * lastOutingDate: Date or null
 * spot: spot object (boost applied to high-novelty spots)
 */
function getInactivityModifier(spot, lastOutingDate) {
  if (!lastOutingDate) return 0;

  const daysSince = (Date.now() - new Date(lastOutingDate).getTime()) / (1000 * 60 * 60 * 24);
  if (daysSince < CONTEXT.inactivity.noveltyBoostAfterDays) return 0;

  // Boost novel spots when group has been inactive
  const noveltyScore = spot.noveltyScore || 0.5;
  if (noveltyScore > 0.6) {
    return CONTEXT.inactivity.noveltyBoostStrength;
  }

  return 0;
}

// ── APPLY ALL CONTEXT MODIFIERS ───────────────────────────────────────
/**
 * Apply all context modifiers to a scored spot list.
 * Returns new list with contextualScore = baseScore + modifiers.
 *
 * scoredSpots: [{ spot, score }]
 * context: { weather, events, spotHistories: { [spotId]: history }, lastOutingDate }
 */
function applyContextModifiers(scoredSpots, context = {}, now = new Date()) {
  return scoredSpots.map(({ spot, score, wildcardScore }) => {
    let modifier = 0;

    // Time of day
    modifier += getTimeModifier(spot, now);

    // Weather
    if (context.weather) {
      modifier += getWeatherModifier(spot, context.weather);
    }

    // Local events
    if (context.events) {
      modifier += getEventsModifier(spot, context.events);
    }

    // Repetition / history
    if (context.spotHistories?.[spot.id]) {
      modifier += getRepetitionModifier(spot, context.spotHistories[spot.id]);
    }

    // Inactivity novelty
    if (context.lastOutingDate) {
      modifier += getInactivityModifier(spot, context.lastOutingDate);
    }

    return {
      spot,
      score:         clamp(score + modifier),
      wildcardScore: clamp((wildcardScore || score) + modifier),
      contextModifier: parseFloat(modifier.toFixed(3)),
    };
  }).sort((a, b) => b.score - a.score);
}

// ── WEATHER API NORMALIZER ────────────────────────────────────────────
/**
 * Normalize weather data from OpenWeatherMap API response.
 */
function normalizeWeatherData(owmResponse) {
  if (!owmResponse) return null;
  const main = owmResponse.weather?.[0]?.main?.toLowerCase() || 'clear';
  const tempF = ((owmResponse.main?.temp || 293) - 273.15) * 9 / 5 + 32;

  let condition = 'clear';
  if (main.includes('rain') || main.includes('drizzle')) condition = 'rain';
  else if (main.includes('snow'))  condition = 'snow';
  else if (main.includes('cloud')) condition = 'cloudy';
  else if (main.includes('clear') || main.includes('sun')) condition = 'clear';

  return { condition, tempF: Math.round(tempF), raw: owmResponse };
}

module.exports = {
  applyContextModifiers,
  getTimeModifier,
  getWeatherModifier,
  getEventsModifier,
  getRepetitionModifier,
  getInactivityModifier,
  normalizeWeatherData,
  getCurrentTimeWindow,
};
