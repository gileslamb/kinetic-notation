/**
 * Kinetic Notation — Blending Engine (expanded)
 *
 * 11 GESTURE TEMPLATES with sustain-aware looping:
 *   whale, wing, leaf, spiral, surge, scatter, cascade
 *   + ribbon, bloom, pendulum, crackle
 *
 * VARIATION SYSTEM:
 *   Each template's pathFn receives clip.variation (0–1 random seed).
 *   This offsets frequencies, scales, and rotations so no two clips
 *   of the same vocabulary look identical.
 *
 * SUSTAIN LOOPING:
 *   When t > 1.0 (sustain mode), templates receive the total eased progress.
 *   Integer part = cycle count, fractional part = position within cycle.
 *   Templates should produce smooth loops so sustain feels continuous.
 *
 * MIDI CLIP FACTORY:
 *   createMidiClip() builds clips from MPE note data instead of audio features.
 */

import { GestureClip } from '../core/clipManager.js';
import canvasManager from '../visualization/canvas.js';
import modeManager from '../core/modeManager.js';
import { createHybridPathFn, listImported, setUseVideoImports } from './naturalMotions.js';
import { getActiveSource, getLibrarySummary } from './gestureLibrary.js';

// ─── Helper: rotate a point by angle ─────────────────

function rotate(dx, dy, angle) {
    return {
        x: dx * Math.cos(angle) - dy * Math.sin(angle),
        y: dx * Math.sin(angle) + dy * Math.cos(angle),
    };
}

// ─── Template Definitions ────────────────────────────

const TEMPLATES = {

    whale: {
        durationRange: [2.0, 4.0],
        easing: 'cubic',
        pathFn(t, clip) {
            const { origin, heading, scale, intensity, variation } = clip;
            const r = scale * (180 + variation * 60);
            const along = (t % 1) * Math.PI;
            const vOff = variation * 0.3;
            const dx = Math.cos(heading) * Math.sin(along + vOff) * r
                     - Math.sin(heading) * (1 - Math.cos(along)) * r * 0.5;
            const dy = Math.sin(heading) * Math.sin(along + vOff) * r
                     + Math.cos(heading) * (1 - Math.cos(along)) * r * 0.5;
            const weight = 0.4 + Math.sin(along) * 0.6 * intensity;
            return { x: origin.x + dx, y: origin.y + dy, weight };
        },
    },

    wing: {
        durationRange: [0.4, 0.9],
        easing: 'cubic',
        pathFn(t, clip) {
            const { origin, heading, scale, intensity, variation } = clip;
            const r = scale * (60 + variation * 40);
            const freq = 1 + Math.floor(variation * 3); // 1–3 flaps
            const angle = (t % 1) * Math.PI * 2 * freq;
            const dx = Math.sin(angle) * r;
            const dy = Math.sin(angle * 2) * r * (0.3 + variation * 0.4);
            const rot = rotate(dx, dy, heading);
            const weight = 0.3 + Math.abs(Math.cos(angle)) * 0.7 * intensity;
            return { x: origin.x + rot.x, y: origin.y + rot.y, weight };
        },
    },

    leaf: {
        durationRange: [1.0, 3.0],
        easing: 'quad',
        pathFn(t, clip) {
            const { origin, heading, scale, intensity, variation } = clip;
            const r = scale * (100 + variation * 50);
            const tMod = t % 1;
            const wobbles = 2 + Math.floor(variation * 4); // 2–5 oscillations
            const dx = Math.sin(tMod * Math.PI * wobbles) * r * 0.4;
            const dy = tMod * r * (0.6 + variation * 0.4);
            const rot = rotate(dx, dy, heading);
            const weight = 0.2 + Math.sin(tMod * Math.PI) * 0.3 * intensity;
            return { x: origin.x + rot.x, y: origin.y + rot.y, weight };
        },
    },

    spiral: {
        durationRange: [1.5, 3.0],
        easing: 'cubic',
        pathFn(t, clip) {
            const { origin, heading, scale, intensity, variation } = clip;
            const maxR = scale * (100 + variation * 60);
            const tMod = t % 1;
            // Alternate tightening/loosening on sustain cycles
            const cycle = Math.floor(t);
            const tighten = cycle % 2 === 0;
            const radius = tighten
                ? maxR * (1 - tMod * 0.7)
                : maxR * (0.3 + tMod * 0.7);
            const rotations = 2 + variation * 2;
            const angle = heading + tMod * Math.PI * 2 * rotations;
            const dx = Math.cos(angle) * radius;
            const dy = Math.sin(angle) * radius;
            const weight = 0.3 + (tighten ? (1 - tMod) : tMod) * 0.5 * intensity;
            return { x: origin.x + dx, y: origin.y + dy, weight };
        },
    },

    surge: {
        durationRange: [0.6, 1.8],
        easing: 'elastic',
        pathFn(t, clip) {
            const { origin, heading, scale, intensity, variation } = clip;
            const reach = scale * (200 + variation * 100);
            const tMod = t % 1;
            // Each sustain cycle pushes further with slight direction shift
            const cycle = Math.floor(t);
            const h = heading + cycle * (variation - 0.5) * 0.4;
            const dx = Math.cos(h) * tMod * reach;
            const dy = Math.sin(h) * tMod * reach
                     + Math.sin(tMod * Math.PI * (2 + variation * 2)) * reach * 0.08;
            const weight = (1 - tMod * 0.6) * intensity;
            return { x: origin.x + dx, y: origin.y + dy, weight };
        },
    },

    scatter: {
        durationRange: [0.2, 0.6],
        easing: 'elastic',
        pathFn(t, clip) {
            const { origin, heading, scale, intensity, variation } = clip;
            const reach = scale * (80 + variation * 50);
            const tMod = t % 1;
            const wobbleFreq = 8 + variation * 8;
            const dx = Math.cos(heading) * tMod * reach * (1 + Math.sin(tMod * wobbleFreq) * 0.2);
            const dy = Math.sin(heading) * tMod * reach * (1 + Math.cos(tMod * wobbleFreq) * 0.2);
            const weight = (1 - tMod) * intensity;
            return { x: origin.x + dx, y: origin.y + dy, weight };
        },
    },

    cascade: {
        durationRange: [1.0, 2.5],
        easing: 'quad',
        pathFn(t, clip) {
            const { origin, heading, scale, intensity, variation } = clip;
            const r = scale * (150 + variation * 60);
            const tMod = t % 1;
            const dx = Math.cos(heading) * tMod * r * (0.4 + variation * 0.4);
            const dy = tMod * tMod * r;
            const weight = 0.5 + (1 - tMod) * 0.5 * intensity;
            return { x: origin.x + dx, y: origin.y + dy, weight };
        },
    },

    // ── NEW: Ribbon — smooth continuous S-curves ──
    ribbon: {
        durationRange: [1.5, 3.5],
        easing: 'sine',
        pathFn(t, clip) {
            const { origin, heading, scale, intensity, variation } = clip;
            const r = scale * (120 + variation * 80);
            const tMod = t % 1;
            const freq = 1.5 + variation * 2;
            // S-curve: sine in both axes with phase offset
            const dx = Math.sin(tMod * Math.PI * freq) * r * 0.6;
            const dy = tMod * r + Math.cos(tMod * Math.PI * freq * 0.7) * r * 0.2;
            const rot = rotate(dx, dy, heading);
            const weight = 0.3 + Math.abs(Math.sin(tMod * Math.PI * freq)) * 0.5 * intensity;
            return { x: origin.x + rot.x, y: origin.y + rot.y, weight };
        },
    },

    // ── NEW: Bloom — expanding radial flower ──
    bloom: {
        durationRange: [1.0, 2.0],
        easing: 'cubic',
        pathFn(t, clip) {
            const { origin, scale, intensity, variation } = clip;
            const maxR = scale * (100 + variation * 60);
            const tMod = t % 1;
            const petals = 3 + Math.floor(variation * 5); // 3–7 petals
            const angle = tMod * Math.PI * 2 * petals;
            const radius = tMod * maxR * (0.5 + 0.5 * Math.sin(angle * 0.5));
            const dx = Math.cos(angle) * radius;
            const dy = Math.sin(angle) * radius;
            const weight = 0.2 + tMod * 0.6 * intensity;
            return { x: origin.x + dx, y: origin.y + dy, weight };
        },
    },

    // ── NEW: Pendulum — swinging arc ──
    pendulum: {
        durationRange: [1.0, 2.5],
        easing: 'sine',
        pathFn(t, clip) {
            const { origin, heading, scale, intensity, variation } = clip;
            const armLen = scale * (140 + variation * 60);
            const tMod = t % 1;
            const swings = 1 + Math.floor(variation * 3); // 1–3 full swings
            const angle = heading + Math.sin(tMod * Math.PI * swings) * (0.8 + variation * 0.6);
            const dx = Math.sin(angle) * armLen * tMod;
            const dy = Math.cos(angle) * armLen * tMod * 0.3;
            const weight = 0.4 + Math.abs(Math.sin(tMod * Math.PI * swings)) * 0.6 * intensity;
            return { x: origin.x + dx, y: origin.y + dy, weight };
        },
    },

    // ── NEW: Crackle — jagged lightning path ──
    crackle: {
        durationRange: [0.3, 0.8],
        easing: 'elastic',
        pathFn(t, clip) {
            const { origin, heading, scale, intensity, variation } = clip;
            const reach = scale * (100 + variation * 80);
            const tMod = t % 1;
            // Zigzag: jagged sine with high frequency
            const jag = Math.sin(tMod * 30 + variation * 20) * reach * 0.15 * intensity;
            const dx = Math.cos(heading) * tMod * reach + jag;
            const dy = Math.sin(heading) * tMod * reach
                     + Math.cos(tMod * 25 + variation * 15) * reach * 0.1 * intensity;
            const weight = (0.8 - tMod * 0.5) * intensity;
            return { x: origin.x + dx, y: origin.y + dy, weight };
        },
    },
};

const TEMPLATE_NAMES = Object.keys(TEMPLATES);

// ═══════════════════════════════════════════════════════
//  VOCABULARY OVERRIDE SYSTEM
//
//  Modes:
//    'auto'     — normal audio-feature-based selection (default)
//    'forced'   — always use one specific vocabulary
//    'imported' — only pick from vocabularies with imported data,
//                 weighted by per-vocab sliders
// ═══════════════════════════════════════════════════════

const _override = {
    mode: 'auto',               // 'auto' | 'forced' | 'imported'
    forcedVocab: null,          // string — used when mode === 'forced'
    useImportedData: true,      // toggle: true = imported paths, false = math engine
    weights: {},                // { vocab: 0–100 } weighting for 'imported' mode
    randomize: false,           // true = random pick among imported (ignores weights)
};

/**
 * Set the override mode.
 * @param {'auto'|'forced'|'imported'} mode
 */
export function setOverrideMode(mode) {
    _override.mode = mode;
    console.log(`[Override] Mode → ${mode}`);
}

/**
 * Force a specific vocabulary for all clips.
 * @param {string} vocab
 */
export function setForcedVocabulary(vocab) {
    _override.forcedVocab = vocab;
    _override.mode = 'forced';
    console.log(`[Override] Forced → ${vocab}`);
}

/**
 * Toggle between imported motion data and math/physics engine.
 * When off, imported data is ignored even if loaded.
 * @param {boolean} useImported
 */
export function setUseImportedData(useImported) {
    _override.useImportedData = useImported;
    // Propagate to naturalMotions so createHybridPathFn respects the toggle
    setUseVideoImports(useImported);
    console.log(`[Override] Use imported data → ${useImported}`);
}

/**
 * Set per-vocabulary weight (0–100) for the 'imported' random mode.
 * @param {string} vocab
 * @param {number} weight 0–100
 */
export function setVocabWeight(vocab, weight) {
    _override.weights[vocab] = weight;
}

/**
 * Enable/disable pure randomization across imported vocabs.
 * @param {boolean} on
 */
export function setRandomize(on) {
    _override.randomize = on;
    console.log(`[Override] Randomize → ${on}`);
}

/**
 * Get current override state (for UI sync).
 */
export function getOverrideState() {
    return { ..._override };
}

// ─── Vocabulary Selection ────────────────────────────

function _selectByAudioFeatures(features) {
    const { onset, bass, mid, treble, brightness, amplitude } = features;

    // Explosive
    if (onset > 0.6 && amplitude > 0.5) return 'scatter';
    if (onset > 0.5 && treble > 0.4) return 'crackle';

    // Rhythmic
    if (onset > 0.3) return Math.random() > 0.4 ? 'wing' : 'pendulum';

    // Bass
    if (bass > 0.5 && amplitude > 0.3) {
        return bass > 0.6 ? 'whale' : 'cascade';
    }

    // Bright
    if (brightness > 0.5) return Math.random() > 0.5 ? 'spiral' : 'bloom';
    if (brightness > 0.35) return 'ribbon';

    // Strong amplitude
    if (amplitude > 0.5) return 'surge';

    // Gentle
    if (mid > 0.2) return 'leaf';

    return 'leaf';
}

/**
 * Pick from vocabularies that have imported gesture data,
 * using weights or equal randomization.
 */
function _selectFromImported() {
    const imported = listImportedVocabs();
    if (imported.length === 0) return null;

    if (_override.randomize || Object.keys(_override.weights).length === 0) {
        // Equal-chance random
        return imported[Math.floor(Math.random() * imported.length)];
    }

    // Weighted random: build cumulative weights
    let totalWeight = 0;
    const entries = [];
    for (const vocab of imported) {
        const w = _override.weights[vocab] ?? 50;  // default 50 if no slider set
        if (w > 0) {
            totalWeight += w;
            entries.push({ vocab, cumulative: totalWeight });
        }
    }
    if (totalWeight === 0 || entries.length === 0) {
        return imported[Math.floor(Math.random() * imported.length)];
    }

    const r = Math.random() * totalWeight;
    for (const e of entries) {
        if (r <= e.cumulative) return e.vocab;
    }
    return entries[entries.length - 1].vocab;
}

/**
 * Get list of vocabularies that have imported data.
 * Reads from the naturalMotions store.
 */
function listImportedVocabs() {
    return listImported().map(g => g.vocabulary);
}

function selectVocabulary(features) {
    switch (_override.mode) {
        case 'forced':
            if (_override.forcedVocab && TEMPLATES[_override.forcedVocab]) {
                return _override.forcedVocab;
            }
            break;

        case 'imported': {
            const pick = _selectFromImported();
            if (pick && TEMPLATES[pick]) return pick;
            // Fall through to auto if no imports
            break;
        }
    }

    // Auto mode — normal audio-based selection
    return _selectByAudioFeatures(features);
}

// ─── Audio Clip Factory ──────────────────────────────

/**
 * Create a GestureClip from audio features + phrase info.
 */
export function createGestureClip(features, phrase, uiParams) {
    const vocabName = selectVocabulary(features);
    const template = TEMPLATES[vocabName];

    const [minDur, maxDur] = template.durationRange;
    const durationMix = 1 - phrase.phraseIntensity;
    const baseDuration = minDur + durationMix * (maxDur - minDur);
    const duration = baseDuration / Math.max(uiParams.speed * 2, 0.3);

    const intensity = Math.min(
        (phrase.phraseIntensity * 0.6 + features.amplitude * 0.4) * uiParams.sensitivity * 2,
        1.0
    );

    const w = canvasManager.width;
    const h = canvasManager.height;
    const maxR = Math.min(w, h) * 0.3;

    // Spawn bias: when canvas scrolls, bias origins toward the left
    // spawnBias = 0.35 means center of spawn zone is at 35% of canvas width
    const spawnBias = modeManager.current.spawnBias || 0.5;
    const spawnCX = w * spawnBias;
    const spawnCY = h * 0.5;

    const angle = Math.random() * Math.PI * 2;
    const dist = Math.random() * maxR * 0.5;

    const origin = {
        x: spawnCX + Math.cos(angle) * dist,
        y: spawnCY + Math.sin(angle) * dist,
    };

    const heading = angle + (features.bass - features.treble) * 0.5 * Math.PI * 0.5;
    const scale = 0.5 + intensity * 1.0;

    // DUAL GESTURE SYSTEM:
    //   useImportedData ON  → createHybridPathFn routes: imported video → bio model → math fallback
    //   useImportedData OFF → math template pathFn only (legacy mode)
    // In both cases, createHybridPathFn handles priority internally.
    const pathFn = createHybridPathFn(vocabName, template.pathFn);

    return new GestureClip({
        vocabularyType: vocabName,
        duration,
        intensity,
        origin,
        heading,
        scale,
        pathFn,
        easingName: template.easing,
        variation: Math.random(),
    });
}

// ─── MIDI Clip Factory ───────────────────────────────

/**
 * Create a GestureClip from an MPE note.
 * Much lower latency than audio — no FFT needed.
 *
 * @param {import('../input/midiManager.js').MPENote} mpeNote
 * @param {Object} uiParams
 * @returns {GestureClip}
 */
export function createMidiClip(mpeNote, uiParams) {
    // Map note properties to a vocabulary
    const features = mpeNote.toFeatures();
    const vocabName = selectVocabulary(features);
    const template = TEMPLATES[vocabName];

    // Duration from template range, modulated by velocity
    const [minDur, maxDur] = template.durationRange;
    const duration = (minDur + (1 - mpeNote.velocityNorm) * (maxDur - minDur))
                   / Math.max(uiParams.speed * 2, 0.3);

    const intensity = Math.min(mpeNote.velocityNorm * uiParams.sensitivity * 2, 1.0);

    // Pitch-based spatial placement: low notes left/bottom, high notes right/top
    const cx = canvasManager.center.x;
    const cy = canvasManager.center.y;
    const maxR = Math.min(canvasManager.width, canvasManager.height) * 0.35;
    const pitchN = mpeNote.pitchNorm;

    const origin = {
        x: cx + (pitchN - 0.5) * maxR * 1.2,    // spread L→R by pitch
        y: cy + (0.5 - pitchN) * maxR * 0.4,     // slight vertical spread
    };

    const heading = (pitchN - 0.5) * Math.PI * 0.8 + mpeNote.pitchBend * 0.5;
    const scale = 0.4 + intensity * 1.0;

    // DUAL GESTURE SYSTEM: always use hybrid pathFn
    const pathFn = createHybridPathFn(vocabName, template.pathFn);

    return new GestureClip({
        vocabularyType: vocabName,
        duration,
        intensity,
        origin,
        heading,
        scale,
        pathFn,
        easingName: template.easing,
        variation: Math.random(),
        midiNoteKey: `${mpeNote.channel}:${mpeNote.note}`,
    });
}

export { TEMPLATES, TEMPLATE_NAMES, selectVocabulary };
