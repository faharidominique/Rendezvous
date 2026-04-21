// ─────────────────────────────────────────────────────────────────────
// rendezvous-engine/src/utils/vector.js
// Mathematical operations on taste vectors.
// All vectors are plain objects with VECTOR_DIMS keys, values 0.0–1.0.
// ─────────────────────────────────────────────────────────────────────
const { VECTOR_DIMS } = require('../config');

// ── CONSTRUCTION ──────────────────────────────────────────────────────

/** Create a blank vector with all dimensions at 0.5 (neutral midpoint) */
function neutral() {
  return Object.fromEntries(VECTOR_DIMS.map(d => [d, 0.5]));
}

/** Create a zero vector */
function zero() {
  return Object.fromEntries(VECTOR_DIMS.map(d => [d, 0.0]));
}

/** Clone a vector */
function clone(v) {
  return { ...v };
}

// ── CLAMPING ──────────────────────────────────────────────────────────

/** Clamp a single float to [0, 1] */
function clamp(val) {
  return Math.max(0.0, Math.min(1.0, val));
}

/** Clamp all dimensions of a vector */
function clampVector(v) {
  const result = {};
  for (const dim of VECTOR_DIMS) {
    result[dim] = clamp(v[dim] ?? 0.5);
  }
  return result;
}

// ── ARITHMETIC ────────────────────────────────────────────────────────

/**
 * Apply a partial adjustment object to a vector.
 * Only updates dimensions present in the adjustment.
 * Returns a new clamped vector.
 */
function apply(v, adjustments) {
  const result = clone(v);
  for (const [dim, delta] of Object.entries(adjustments)) {
    if (result[dim] !== undefined) {
      result[dim] = clamp(result[dim] + delta);
    }
  }
  return result;
}

/**
 * Weighted blend of two vectors.
 * result[dim] = v1[dim] * w1 + v2[dim] * w2
 */
function blend(v1, v2, w1 = 0.5, w2 = 0.5) {
  const result = {};
  for (const dim of VECTOR_DIMS) {
    result[dim] = clamp((v1[dim] ?? 0.5) * w1 + (v2[dim] ?? 0.5) * w2);
  }
  return result;
}

/**
 * Mean of an array of vectors (equal weights).
 */
function mean(vectors) {
  if (!vectors.length) return neutral();
  const result = {};
  for (const dim of VECTOR_DIMS) {
    result[dim] = clamp(vectors.reduce((sum, v) => sum + (v[dim] ?? 0.5), 0) / vectors.length);
  }
  return result;
}

/**
 * Weighted mean of an array of {vector, weight} pairs.
 */
function weightedMean(pairs) {
  if (!pairs.length) return neutral();
  const totalWeight = pairs.reduce((s, p) => s + p.weight, 0);
  if (totalWeight === 0) return neutral();
  const result = {};
  for (const dim of VECTOR_DIMS) {
    result[dim] = clamp(
      pairs.reduce((sum, { vector, weight }) => sum + (vector[dim] ?? 0.5) * weight, 0) / totalWeight
    );
  }
  return result;
}

// ── STATISTICS ────────────────────────────────────────────────────────

/**
 * Standard deviation of a single dimension across multiple vectors.
 */
function stdDev(vectors, dim) {
  const vals = vectors.map(v => v[dim] ?? 0.5);
  const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
  const variance = vals.reduce((s, v) => s + (v - avg) ** 2, 0) / vals.length;
  return Math.sqrt(variance);
}

/**
 * Compute conflict report: dimensions where std dev exceeds threshold.
 * Returns array of { dimension, stdDev, values } sorted by conflict severity.
 */
function findConflicts(vectors, threshold = 0.35) {
  const conflicts = [];
  for (const dim of VECTOR_DIMS) {
    const sd = stdDev(vectors, dim);
    if (sd > threshold) {
      conflicts.push({
        dimension: dim,
        stdDev: parseFloat(sd.toFixed(3)),
        values: vectors.map(v => parseFloat((v[dim] ?? 0.5).toFixed(2))),
      });
    }
  }
  return conflicts.sort((a, b) => b.stdDev - a.stdDev);
}

// ── SIMILARITY ────────────────────────────────────────────────────────

/**
 * Cosine similarity between two vectors (treating them as points in N-space).
 * Returns float 0.0–1.0 where 1.0 = identical.
 */
function cosineSimilarity(v1, v2) {
  let dot = 0, mag1 = 0, mag2 = 0;
  for (const dim of VECTOR_DIMS) {
    const a = v1[dim] ?? 0.5;
    const b = v2[dim] ?? 0.5;
    dot  += a * b;
    mag1 += a * a;
    mag2 += b * b;
  }
  const denom = Math.sqrt(mag1) * Math.sqrt(mag2);
  return denom === 0 ? 0 : clamp(dot / denom);
}

/**
 * Euclidean distance between two vectors, normalised to [0, 1].
 * 0 = identical, 1 = maximally different.
 */
function distance(v1, v2) {
  const sumSq = VECTOR_DIMS.reduce((s, dim) => {
    const diff = (v1[dim] ?? 0.5) - (v2[dim] ?? 0.5);
    return s + diff * diff;
  }, 0);
  return clamp(Math.sqrt(sumSq) / Math.sqrt(VECTOR_DIMS.length));
}

/**
 * Compute how well a spot's attributes match a target vector.
 * spotAttrs is a partial object with the spot's scored dimensions.
 * Returns float 0.0–1.0.
 */
function spotMatch(targetVector, spotAttrs) {
  const dims = Object.keys(spotAttrs).filter(k => VECTOR_DIMS.includes(k));
  if (!dims.length) return 0.5;
  const diffs = dims.map(dim => Math.abs((targetVector[dim] ?? 0.5) - (spotAttrs[dim] ?? 0.5)));
  return clamp(1 - (diffs.reduce((s, d) => s + d, 0) / dims.length));
}

// ── DECAY UTILITIES ───────────────────────────────────────────────────

/**
 * Compute decay multiplier for a signal based on its age.
 * Uses exponential decay with the configured half-life.
 * Returns float [minWeight, 1.0].
 */
function decayMultiplier(ageDays, halfLifeDays, minWeight = 0.05) {
  if (ageDays <= 0) return 1.0;
  const raw = Math.pow(0.5, ageDays / halfLifeDays);
  return Math.max(minWeight, raw);
}

/**
 * Apply decay to a set of weighted signal contributions.
 * signals: [{ vector, weight, updatedAt }]
 * halfLifeDays: number
 */
function applyDecay(signals, halfLifeDays, minWeight = 0.05) {
  const now = Date.now();
  return signals.map(s => {
    const ageDays = (now - new Date(s.updatedAt).getTime()) / (1000 * 60 * 60 * 24);
    const multiplier = decayMultiplier(ageDays, halfLifeDays, minWeight);
    return { ...s, effectiveWeight: s.weight * multiplier };
  });
}

// ── JACCARD SIMILARITY (for tag arrays) ───────────────────────────────
function jaccard(setA, setB) {
  if (!setA?.length || !setB?.length) return 0;
  const a = new Set(setA.map(s => s.toLowerCase()));
  const b = new Set(setB.map(s => s.toLowerCase()));
  const intersection = [...a].filter(x => b.has(x)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

// ── HAVERSINE DISTANCE ─────────────────────────────────────────────────
function haversineMiles(lat1, lng1, lat2, lng2) {
  const R = 3958.8;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

module.exports = {
  neutral, zero, clone, clamp, clampVector,
  apply, blend, mean, weightedMean,
  stdDev, findConflicts,
  cosineSimilarity, distance, spotMatch,
  decayMultiplier, applyDecay,
  jaccard, haversineMiles,
};
