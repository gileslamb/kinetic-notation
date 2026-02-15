/**
 * Kinetic Notation — Natural Motion Implementations
 *
 * DUAL-SOURCE SYSTEM:
 *   1. MATH FALLBACK — original algorithmic paths (whale parabola, leaf sine, etc.)
 *   2. IMPORTED DATA — real motion paths extracted from video (or loaded from JSON)
 *
 * When imported data exists for a vocabulary type, it overrides the math pathFn.
 * Otherwise the mathematical model is used as fallback.
 *
 * IMPORTED PATH FORMAT:
 *   { name, vocabulary, path: [{x, y, t, intensity}], duration }
 *   x,y are normalized 0–1, t is timestamp in seconds.
 *
 * The pathFn contract is:
 *   (t: 0–1 progress, clip) → {x, y, weight}
 *   where x,y are absolute canvas positions and weight is 0–1 line thickness.
 */

import Config from '../utils/config.js';
import { generateBiomechanicalGesture } from './biomechanicalModels.js';

// ── Inline smoothing utility (avoids circular import with gestureLibrary) ──
function _smoothPath(path, windowSize = 5) {
    if (!path || path.length < windowSize) return path;
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
        result.push({ x: sx / count, y: sy / count, t: path[i].t, intensity: si / count });
    }
    return result;
}

// ══════════════════════════════════════════════════════
//  IMPORTED GESTURE STORE
// ══════════════════════════════════════════════════════

/**
 * Map of vocabulary → imported gesture data.
 * When a key exists here, the corresponding TEMPLATES[vocab].pathFn
 * uses the real data instead of the math model.
 */
const _importedGestures = {};

// Track first usage per vocabulary for debug logging
const _loggedFirstUse = {};

// ── Source preference flag ──
// When true: imported video → biomechanical → math fallback
// When false: biomechanical → math fallback (skip video imports)
let _useVideoImports = true;

/**
 * Toggle whether video-imported data is used.
 * When false, biomechanical models are used even if video data exists.
 * @param {boolean} use
 */
export function setUseVideoImports(use) {
    _useVideoImports = use;
    console.log(`[NaturalMotions] Video imports: ${use ? 'ON' : 'OFF'}`);
}

/** @returns {boolean} */
export function getUseVideoImports() {
    return _useVideoImports;
}

/**
 * Load an extracted gesture into a vocabulary slot.
 *
 * @param {Object} gestureData  the exported gesture object from VideoMotionExtractor
 *   { name, vocabulary, path: [{x,y,t,intensity}], duration }
 * @returns {boolean} success
 */
export function loadGestureFromData(gestureData) {
    if (!gestureData || !gestureData.path || !gestureData.vocabulary) {
        console.warn('[NaturalMotions] Invalid gesture data');
        return false;
    }

    const vocab = gestureData.vocabulary;
    let path = gestureData.path;

    if (path.length < 2) {
        console.warn(`[NaturalMotions] Path too short (${path.length} points)`);
        return false;
    }

    // Pre-process: ensure sorted by t
    path.sort((a, b) => a.t - b.t);

    // ── Normalize path to full 0–1 range ──
    // Raw extractor data may be clustered in a small region of the frame.
    // Remap so the full x/y range maps to 0–1 for maximum visual impact.
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of path) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
    }
    const rangeX = maxX - minX || 0.001;
    const rangeY = maxY - minY || 0.001;

    path = path.map(p => ({
        x: (p.x - minX) / rangeX,
        y: (p.y - minY) / rangeY,
        t: p.t,
        intensity: p.intensity,
    }));

    console.log(
        `[NaturalMotions] Normalized path: x=[${minX.toFixed(3)}→${maxX.toFixed(3)}] ` +
        `y=[${minY.toFixed(3)}→${maxY.toFixed(3)}] → full 0–1 range`
    );

    _importedGestures[vocab] = {
        name: gestureData.name,
        path,
        duration: gestureData.duration || path[path.length - 1].t,
    };

    // Reset first-use log so we log again for this vocab
    _loggedFirstUse[vocab] = false;

    // Persist to localStorage
    _persistToStorage();

    console.log(
        `%c[NaturalMotions] ✓ Loaded "${gestureData.name}" → ${vocab} ` +
        `(${path.length} points, ${_importedGestures[vocab].duration.toFixed(1)}s) — ACTIVE NOW`,
        'color: #6bff9f; font-weight: bold; font-size: 13px;'
    );

    return true;
}

/**
 * Remove imported gesture for a vocabulary type (revert to math).
 * @param {string} vocabulary
 */
export function unloadGesture(vocabulary) {
    if (_importedGestures[vocabulary]) {
        console.log(`[NaturalMotions] Unloaded "${_importedGestures[vocabulary].name}" from ${vocabulary}`);
        delete _importedGestures[vocabulary];
        _persistToStorage();
    }
}

/**
 * Check if a vocabulary has imported data.
 * @param {string} vocabulary
 * @returns {boolean}
 */
export function hasImportedGesture(vocabulary) {
    return vocabulary in _importedGestures;
}

/**
 * Get list of all imported vocabularies.
 * @returns {Array<{vocabulary:string, name:string, pointCount:number}>}
 */
export function listImported() {
    return Object.entries(_importedGestures).map(([vocab, g]) => ({
        vocabulary: vocab,
        name: g.name,
        pointCount: g.path.length,
    }));
}

/**
 * Get raw imported path data for a vocabulary (for continuous line modulation).
 * @param {string} vocabulary
 * @returns {{path: Array, duration: number, name: string}|null}
 */
export function getImportedGesture(vocabulary) {
    return _importedGestures[vocabulary] || null;
}

/**
 * Get any available imported gesture (picks first one).
 * @returns {{path: Array, duration: number, name: string, vocabulary: string}|null}
 */
export function getAnyImportedGesture() {
    const entries = Object.entries(_importedGestures);
    if (entries.length === 0) return null;
    const [vocab, g] = entries[0];
    return { ...g, vocabulary: vocab };
}

// ══════════════════════════════════════════════════════
//  PERSISTENCE — localStorage
// ══════════════════════════════════════════════════════

const STORAGE_KEY = 'kn_imported_gestures';

/** Save all imported gestures to localStorage. */
function _persistToStorage() {
    try {
        const data = {};
        for (const [vocab, g] of Object.entries(_importedGestures)) {
            data[vocab] = { name: g.name, path: g.path, duration: g.duration };
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        console.log(`[NaturalMotions] Persisted ${Object.keys(data).length} gesture(s) to localStorage`);
    } catch (e) {
        console.warn('[NaturalMotions] Failed to persist to localStorage:', e);
    }
}

/** Restore imported gestures from localStorage on module load. */
function _restoreFromStorage() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const data = JSON.parse(raw);
        let count = 0;
        for (const [vocab, g] of Object.entries(data)) {
            if (g.path && g.path.length >= 2) {
                _importedGestures[vocab] = {
                    name: g.name,
                    path: g.path,
                    duration: g.duration || g.path[g.path.length - 1].t,
                };
                count++;
                console.log(
                    `%c[NaturalMotions] Restored "${g.name}" → ${vocab} (${g.path.length} pts)`,
                    'color: #6bff9f;'
                );
            }
        }
        if (count > 0) {
            console.log(
                `%c[NaturalMotions] ✓ ${count} imported gesture(s) restored from localStorage`,
                'color: #6bff9f; font-weight: bold;'
            );
        }
    } catch (e) {
        console.warn('[NaturalMotions] Failed to restore from localStorage:', e);
    }
}

// Auto-restore on module load
_restoreFromStorage();

// ══════════════════════════════════════════════════════
//  PATH INTERPOLATION FROM IMPORTED DATA
// ══════════════════════════════════════════════════════

/**
 * Create a pathFn that selects from the dual gesture system.
 *
 * PRIORITY:
 *   1. Imported video data (if exists for this vocabulary)
 *   2. Biomechanical model (parametric, always available)
 *   3. Original template pathFn (legacy math fallback)
 *
 * @param {string} vocabulary
 * @param {Function} originalPathFn  the legacy math fallback
 * @returns {Function} pathFn(t, clip) → {x, y, weight}
 */
export function createHybridPathFn(vocabulary, originalPathFn) {
    // Pre-generate a biomechanical gesture for this vocabulary
    // (lazy — will regenerate with proper intensity/duration when first used)
    let _bioGesture = null;
    let _bioSeed = 0;

    return function hybridPath(t, clip) {
        // ── Priority 1: imported video data (if toggle is on) ──
        const imported = _useVideoImports ? _importedGestures[vocabulary] : null;
        if (imported) {
            if (!_loggedFirstUse[vocabulary]) {
                _loggedFirstUse[vocabulary] = true;
                console.log(
                    `%c[NaturalMotions] ★ Using imported "${imported.name}" for ${vocabulary} clip!`,
                    'color: #ffcc00; font-weight: bold;'
                );
            }
            return _sampleImportedPath(imported, t, clip);
        }

        // ── Priority 2: biomechanical model ──
        // Generate once per clip (keyed by clip variation seed)
        const clipSeed = clip.variation || 0;
        if (!_bioGesture || _bioSeed !== clipSeed) {
            _bioSeed = clipSeed;
            const bio = generateBiomechanicalGesture(
                vocabulary,
                clip.intensity || 0.5,
                clip.duration || 6,
                clipSeed * 999
            );
            // Apply smoothing to the bio path
            _bioGesture = {
                name: bio.name,
                path: _smoothPath(bio.path, 5),
                duration: bio.duration,
            };

            if (!_loggedFirstUse[`bio_${vocabulary}`]) {
                _loggedFirstUse[`bio_${vocabulary}`] = true;
                console.log(
                    `%c[NaturalMotions] ◆ Using biomechanical model for ${vocabulary} clip`,
                    'color: #80b0ff; font-weight: bold;'
                );
            }
        }

        return _sampleImportedPath(_bioGesture, t, clip);
    };
}

/**
 * Sample the imported path array at normalized progress t.
 * Handles looping (sustain), scaling to canvas, and interpolation.
 *
 * Path coordinates are pre-normalized to 0–1 (full range) by loadGestureFromData.
 * They map to canvas positions centered on the clip's origin, scaled by clip.scale.
 *
 * ORGANIC VARIATION:
 *   - TIME STRETCH: path plays at 0.3× speed (3.3× slower than raw video)
 *   - SMOOTHING: Hermite interpolation softens frame-to-frame jitter
 *   - DRIFT: each playthrough shifts origin via Perlin noise so it never retraces
 *   - SCALE VARIATION: per-clip random scale factor (0.6–1.4×) for variety
 */
function _sampleImportedPath(imported, t, clip) {
    const { path, duration } = imported;
    const { origin, heading, scale, intensity, variation } = clip;

    // ── Time stretch: slow the playback down ──
    // Raw video motion is too fast — stretch by 3.3× (use 30% of time)
    const timeStretch = 0.3;
    const tStretched = t * timeStretch;

    // When looping (sustain), use fractional part
    const tNorm = tStretched % 1;

    // ── Drift: shift origin each cycle so loops don't retrace ──
    const cycle = Math.floor(tStretched);
    const driftSeed = (variation || 0) * 1000 + cycle * 137.5;
    const driftX = Math.sin(driftSeed) * scale * 60 + Math.cos(driftSeed * 0.7) * scale * 30;
    const driftY = Math.cos(driftSeed * 1.3) * scale * 40 + Math.sin(driftSeed * 0.4) * scale * 20;

    // ── Sample path with Hermite (smooth) interpolation ──
    const targetTime = tNorm * duration;
    let lo = 0, hi = path.length - 1;

    while (lo < hi - 1) {
        const mid = (lo + hi) >> 1;
        if (path[mid].t <= targetTime) lo = mid;
        else hi = mid;
    }

    // Gather 4 control points for Hermite smoothing
    const i0 = Math.max(lo - 1, 0);
    const i1 = lo;
    const i2 = hi;
    const i3 = Math.min(hi + 1, path.length - 1);

    const p0 = path[i0], p1 = path[i1], p2 = path[i2], p3 = path[i3];

    const span = p2.t - p1.t;
    const frac = span > 0.001 ? (targetTime - p1.t) / span : 0;

    // Hermite interpolation (Catmull-Rom) — much smoother than linear
    const nx = _hermite(p0.x, p1.x, p2.x, p3.x, frac);
    const ny = _hermite(p0.y, p1.y, p2.y, p3.y, frac);
    const ni = p1.intensity + (p2.intensity - p1.intensity) * frac;

    // ── Scale variation: each clip has slightly different size ──
    const scaleVar = 0.6 + (variation || 0.5) * 0.8;  // 0.6× to 1.4×
    const range = scale * 250 * scaleVar;

    const dx = (nx - 0.5) * range;
    const dy = (ny - 0.5) * range;

    // Rotate by clip heading
    const cosH = Math.cos(heading);
    const sinH = Math.sin(heading);
    const rx = dx * cosH - dy * sinH;
    const ry = dx * sinH + dy * cosH;

    // Final position = clip origin + rotated displacement + cycle drift
    const x = origin.x + rx + driftX;
    const y = origin.y + ry + driftY;

    const weight = 0.2 + Math.min(ni * intensity, 0.8);
    return { x, y, weight };
}

/** Catmull-Rom hermite interpolation for smooth curve through 4 points. */
function _hermite(p0, p1, p2, p3, t) {
    const t2 = t * t;
    const t3 = t2 * t;
    return (
        (2 * t3 - 3 * t2 + 1) * p1 +
        (t3 - 2 * t2 + t) * 0.5 * (p2 - p0) +
        (-2 * t3 + 3 * t2) * p2 +
        (t3 - t2) * 0.5 * (p3 - p1)
    );
}

// ══════════════════════════════════════════════════════
//  ORIGINAL MATH FUNCTIONS (kept as fallbacks)
// ══════════════════════════════════════════════════════

/** Drift — like a leaf on gentle wind. */
export function drift(time, params = {}) {
    const amp = params.amplitude || 1;
    const freq = params.frequency || 0.5;
    return {
        dx: Math.sin(time * freq * 0.7) * 30 * amp + Math.sin(time * freq * 1.9) * 10 * amp,
        dy: Math.cos(time * freq * 0.5) * 20 * amp + Math.sin(time * freq * 1.3) * 8 * amp,
    };
}

/** Pulse — rhythmic expansion/contraction. */
export function pulse(time, params = {}) {
    const rate = params.rate || 1;
    const strength = params.strength || 1;
    const s = Math.sin(time * rate * Math.PI * 2);
    return { dx: s * 15 * strength, dy: s * 15 * strength };
}

/** Spiral — rotational with variable radius. */
export function spiral(time, params = {}) {
    const speed = params.speed || 1;
    const r = (20 + time * 10) * (params.scale || 1);
    const angle = time * speed * 2;
    return { dx: Math.cos(angle) * r, dy: Math.sin(angle) * r };
}

/** Cascade — gravity-driven downward flow. */
export function cascade(time, params = {}) {
    const g = params.gravity || 1;
    return { dx: Math.sin(time * 1.5) * 10, dy: time * time * 30 * g };
}

/** Flutter — rapid small oscillations. */
export function flutter(time, params = {}) {
    const freq = params.frequency || 8;
    const amp = params.amplitude || 1;
    return {
        dx: Math.sin(time * freq) * 8 * amp + Math.sin(time * freq * 2.3) * 3 * amp,
        dy: Math.cos(time * freq * 1.7) * 6 * amp,
    };
}

/** Surge — swelling directional push. */
export function surge(time, params = {}) {
    const power = params.power || 1;
    const eased = 1 - Math.exp(-time * 3);
    return { dx: eased * 50 * power, dy: Math.sin(time * 2) * 10 * power };
}

/** Scatter — explosive radial dispersion. */
export function scatter(time, params = {}) {
    const force = params.force || 1;
    const angle = params.angle || 0;
    const t = Math.min(time * 2, 1);
    return {
        dx: Math.cos(angle) * t * 40 * force,
        dy: Math.sin(angle) * t * 40 * force,
    };
}
