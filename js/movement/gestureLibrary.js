/**
 * Kinetic Notation — Gesture Library
 *
 * Unified storage and selection for both biomechanical and video-imported gestures.
 *
 * PRIORITY SYSTEM:
 *   1. If imported video data exists for a vocabulary → use that
 *   2. Else → generate from biomechanical model
 *   3. Apply musical modulation (intensity, tempo variation) to either source
 *
 * STORAGE FORMAT:
 *   {
 *     source: 'biomechanical' | 'video',
 *     vocabulary: 'whale' | 'wing' | 'leaf' | etc.,
 *     name: 'breach' | 'custom_import',
 *     path: [{x, y, t, intensity}],
 *     duration: number,
 *     metadata: { duration, intensity_range, description }
 *   }
 *
 * MULTI-VARIATION:
 *   Each vocabulary can store MULTIPLE gesture variations.
 *   Selection picks randomly, weighted by intensity match.
 */

import { generateBiomechanicalGesture, BIOMECHANICAL_MODELS } from './biomechanicalModels.js';

// ── Lazy import to avoid circular dependency with naturalMotions.js ──
// naturalMotions.js imports from biomechanicalModels.js but not from us.
// We access naturalMotions functions lazily via dynamic import cache.
let _naturalMotions = null;

async function _getNaturalMotions() {
    if (!_naturalMotions) {
        _naturalMotions = await import('./naturalMotions.js');
    }
    return _naturalMotions;
}

// Synchronous accessors (fall back to empty if module not yet loaded)
function _hasImportedGesture(vocabulary) {
    try {
        return _naturalMotions?.hasImportedGesture(vocabulary) ?? false;
    } catch { return false; }
}

function _getImportedGesture(vocabulary) {
    try {
        return _naturalMotions?.getImportedGesture(vocabulary) ?? null;
    } catch { return null; }
}

function _listImported() {
    try {
        return _naturalMotions?.listImported() ?? [];
    } catch { return []; }
}

// Eagerly load on module init
_getNaturalMotions().catch(() => {});

// ═══════════════════════════════════════════════════
//  LIBRARY STORE
// ═══════════════════════════════════════════════════

/**
 * Map of vocabulary → Array of gesture entries.
 * Each entry follows the storage format above.
 * @type {Object<string, Array>}
 */
const _library = {};

/**
 * Pre-generated biomechanical variations per vocabulary.
 * Generated on first request, cached thereafter.
 * @type {Object<string, Array>}
 */
const _bioCache = {};

/** Number of bio variations to pre-generate per vocabulary. */
const BIO_VARIATIONS = 4;

// ═══════════════════════════════════════════════════
//  PUBLIC API
// ═══════════════════════════════════════════════════

/**
 * Get the best gesture for a vocabulary + musical context.
 *
 * Priority:
 *   1. Video-imported gesture (if exists)
 *   2. Biomechanical model (always available)
 *
 * @param {string}  vocabulary   e.g. 'whale', 'wing'
 * @param {Object}  [musical]    optional musical context
 * @param {number}  [musical.intensity]   0–1 desired intensity
 * @param {number}  [musical.duration]    desired duration in seconds
 * @param {number}  [musical.tempo]       BPM (affects speed modulation)
 * @param {boolean} [preferImported=true] false = always use biomechanical
 * @returns {{source: string, vocabulary: string, path: Array, duration: number}}
 */
export function getGesture(vocabulary, musical = {}, preferImported = true) {
    const intensity = musical.intensity ?? 0.5;
    const duration = musical.duration ?? _defaultDuration(vocabulary, intensity);

    // ── Priority 1: video-imported data ──
    if (preferImported && _hasImportedGesture(vocabulary)) {
        const imported = _getImportedGesture(vocabulary);
        if (imported && imported.path.length >= 2) {
            // Apply musical modulation to the imported path
            const modulated = applyMusicalModulation(imported.path, musical);
            return {
                source: 'video',
                vocabulary,
                name: imported.name,
                path: modulated,
                duration: imported.duration,
            };
        }
    }

    // ── Priority 2: biomechanical model ──
    const bioGesture = _getBiomechanical(vocabulary, intensity, duration);
    const modulated = applyMusicalModulation(bioGesture.path, musical);

    return {
        source: 'biomechanical',
        vocabulary,
        name: bioGesture.name,
        path: modulated,
        duration: bioGesture.duration,
    };
}

/**
 * Get the active source for a vocabulary.
 * @param {string} vocabulary
 * @returns {'video'|'biomechanical'}
 */
export function getActiveSource(vocabulary) {
    return _hasImportedGesture(vocabulary) ? 'video' : 'biomechanical';
}

/**
 * Get summary of all vocabularies and their active sources.
 * @returns {Array<{vocabulary: string, source: string, hasVideo: boolean, hasBio: boolean, videoName?: string}>}
 */
export function getLibrarySummary() {
    const imported = _listImported();
    const importedMap = {};
    for (const g of imported) {
        importedMap[g.vocabulary] = g;
    }

    const vocabs = Object.keys(BIOMECHANICAL_MODELS);
    return vocabs.map(v => ({
        vocabulary: v,
        source: importedMap[v] ? 'video' : 'biomechanical',
        hasVideo: !!importedMap[v],
        hasBio: true,
        videoName: importedMap[v]?.name,
        videoPoints: importedMap[v]?.pointCount,
    }));
}

/**
 * Force regeneration of biomechanical cache for a vocabulary.
 * Useful after changing parameters.
 * @param {string} vocabulary
 */
export function invalidateBioCache(vocabulary) {
    delete _bioCache[vocabulary];
}

// ═══════════════════════════════════════════════════
//  MUSICAL MODULATION
// ═══════════════════════════════════════════════════

/**
 * Apply musical modulation to a base path.
 * Adjusts amplitude (scale), timing, and adds subtle variation.
 *
 * @param {Array<{x:number, y:number, t:number, intensity:number}>} basePath
 * @param {Object} [features]
 * @param {number} [features.intensity]  0–1 overall energy
 * @param {number} [features.tempo]      BPM (affects timing)
 * @param {number} [features.brightness] 0–1 tonal brightness
 * @returns {Array<{x:number, y:number, t:number, intensity:number}>}
 */
export function applyMusicalModulation(basePath, features = {}) {
    if (!basePath || basePath.length < 2) return basePath;

    const intensity = features.intensity ?? 0.5;
    const tempo = features.tempo ?? 120;
    const brightness = features.brightness ?? 0.5;

    // ── Amplitude scaling by intensity ──
    // Higher intensity = larger displacement from center
    const ampScale = 0.6 + intensity * 0.8;  // 0.6x to 1.4x

    // ── Tempo-based time scaling ──
    // Faster tempo = slightly faster gesture playback
    const tempoScale = 0.8 + (tempo / 120) * 0.4;  // 0.8x at 60bpm, 1.2x at 180bpm

    // ── Subtle variation seed ──
    const varSeed = Math.random() * 1000;
    const variationAmount = 0.15;  // ±15% position jitter

    // Find center of the path for scaling
    let cx = 0, cy = 0;
    for (const p of basePath) {
        cx += p.x;
        cy += p.y;
    }
    cx /= basePath.length;
    cy /= basePath.length;

    return basePath.map((p, i) => {
        // Scale displacement from center
        const dx = (p.x - cx) * ampScale;
        const dy = (p.y - cy) * ampScale;

        // Add subtle per-point variation
        const varAngle = Math.sin(varSeed + i * 0.37) * variationAmount;
        const varRadius = Math.cos(varSeed * 1.3 + i * 0.23) * variationAmount * 0.02;

        return {
            x: clamp01(cx + dx + varRadius * Math.cos(varAngle)),
            y: clamp01(cy + dy + varRadius * Math.sin(varAngle)),
            t: p.t / tempoScale,
            intensity: clamp01(p.intensity * (0.7 + intensity * 0.6)),
        };
    });
}

// ═══════════════════════════════════════════════════
//  PATH PROCESSING UTILITIES
// ═══════════════════════════════════════════════════

/**
 * Smooth a path using moving average filter.
 * Reduces jagginess from video extraction.
 *
 * @param {Array<{x:number, y:number, t:number, intensity:number}>} path
 * @param {number} [windowSize=5]  filter window (odd number recommended)
 * @returns {Array<{x:number, y:number, t:number, intensity:number}>}
 */
export function smoothPath(path, windowSize = 5) {
    if (path.length < windowSize) return path;

    const half = Math.floor(windowSize / 2);
    const result = [];

    for (let i = 0; i < path.length; i++) {
        let sx = 0, sy = 0, si = 0, count = 0;
        for (let j = Math.max(0, i - half); j <= Math.min(path.length - 1, i + half); j++) {
            sx += path[j].x;
            sy += path[j].y;
            si += path[j].intensity;
            count++;
        }
        result.push({
            x: sx / count,
            y: sy / count,
            t: path[i].t,  // preserve original timing
            intensity: si / count,
        });
    }

    return result;
}

/**
 * Resample a path to a target duration with uniform time steps.
 * Normalizes from video framerate timing to target duration.
 *
 * @param {Array<{x:number, y:number, t:number, intensity:number}>} path
 * @param {number} targetDuration   desired duration in seconds
 * @param {number} [targetPoints]   number of output points (default: same as input)
 * @returns {Array<{x:number, y:number, t:number, intensity:number}>}
 */
export function resamplePath(path, targetDuration, targetPoints) {
    if (path.length < 2) return path;

    const numPoints = targetPoints || path.length;
    const srcDuration = path[path.length - 1].t - path[0].t;
    if (srcDuration <= 0) return path;

    const result = [];

    for (let i = 0; i < numPoints; i++) {
        const tNorm = i / (numPoints - 1);  // 0–1
        const srcTime = path[0].t + tNorm * srcDuration;

        // Find bounding points in source
        let lo = 0, hi = path.length - 1;
        while (lo < hi - 1) {
            const mid = (lo + hi) >> 1;
            if (path[mid].t <= srcTime) lo = mid;
            else hi = mid;
        }

        const p0 = path[lo];
        const p1 = path[hi];
        const span = p1.t - p0.t;
        const frac = span > 0.001 ? (srcTime - p0.t) / span : 0;

        result.push({
            x: p0.x + (p1.x - p0.x) * frac,
            y: p0.y + (p1.y - p0.y) * frac,
            t: tNorm * targetDuration,
            intensity: p0.intensity + (p1.intensity - p0.intensity) * frac,
        });
    }

    return result;
}

/**
 * Add random start position offset to prevent dense overlap.
 *
 * @param {Array<{x:number, y:number, t:number, intensity:number}>} path
 * @param {number} [maxOffset=0.15]  maximum offset in normalized space
 * @returns {Array<{x:number, y:number, t:number, intensity:number}>}
 */
export function applyStartOffset(path, maxOffset = 0.15) {
    if (path.length === 0) return path;

    const offsetX = (Math.random() - 0.5) * maxOffset * 2;
    const offsetY = (Math.random() - 0.5) * maxOffset * 2;

    return path.map(p => ({
        x: clamp01(p.x + offsetX),
        y: clamp01(p.y + offsetY),
        t: p.t,
        intensity: p.intensity,
    }));
}

// ═══════════════════════════════════════════════════
//  INTERNALS
// ═══════════════════════════════════════════════════

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

/**
 * Get a biomechanical gesture, using cache for performance.
 * Generates multiple variations and picks one semi-randomly.
 */
function _getBiomechanical(vocabulary, intensity, duration) {
    // Generate cache for this vocabulary if needed
    if (!_bioCache[vocabulary]) {
        _bioCache[vocabulary] = [];
        for (let i = 0; i < BIO_VARIATIONS; i++) {
            _bioCache[vocabulary].push(
                generateBiomechanicalGesture(vocabulary, 0.5, duration, i * 127.3)
            );
        }
    }

    const variations = _bioCache[vocabulary];

    // Pick variation weighted by intensity match
    let bestIdx = 0;
    let bestScore = Infinity;
    for (let i = 0; i < variations.length; i++) {
        const meta = variations[i].metadata;
        if (!meta || !meta.intensity_range) continue;
        const [lo, hi] = meta.intensity_range;
        const midI = (lo + hi) / 2;
        const dist = Math.abs(midI - intensity);
        // Add small random jitter to prevent always picking the same one
        const score = dist + Math.random() * 0.15;
        if (score < bestScore) {
            bestScore = score;
            bestIdx = i;
        }
    }

    return variations[bestIdx];
}

/**
 * Default duration for a vocabulary based on its character.
 */
function _defaultDuration(vocabulary, intensity) {
    const DEFAULTS = {
        whale:    8 + (1 - intensity) * 4,    // 8–12s
        wing:     2 + (1 - intensity) * 2,    // 2–4s
        leaf:     6 + (1 - intensity) * 4,    // 6–10s
        fish:     2 + (1 - intensity) * 2,    // 2–4s
        spiral:   4 + (1 - intensity) * 2,    // 4–6s
        surge:    2 + (1 - intensity) * 2,    // 2–4s
        cascade:  4 + (1 - intensity) * 3,    // 4–7s
        ribbon:   4 + (1 - intensity) * 3,    // 4–7s
        bloom:    3 + (1 - intensity) * 2,    // 3–5s
        pendulum: 3 + (1 - intensity) * 2,    // 3–5s
        scatter:  1 + (1 - intensity) * 1,    // 1–2s
        crackle:  1 + (1 - intensity) * 1,    // 1–2s
    };
    return DEFAULTS[vocabulary] || 5;
}
