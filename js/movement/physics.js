/**
 * Kinetic Notation — Physics Modifiers
 *
 * Per-vocabulary physics that modify a base position to feel "alive."
 * Each function receives the base (x, y) from the gesture template
 * and returns a modified (x, y) with physics applied.
 *
 * Used in Organic Flow mode only — Jazz mode bypasses these entirely.
 *
 * PHYSICS MODELS:
 *   gravity   — accelerating descent with buoyant rise (whale, cascade)
 *   flutter   — air resistance + oscillating drift (leaf)
 *   spring    — tension/release oscillation (wing, pendulum)
 *   momentum  — directional inertia with drag (surge, scatter)
 *   orbit     — centripetal pull with decay (spiral, bloom)
 */

import { noise2D } from '../utils/perlin.js';

// ─── Vocabulary physics profiles ─────────────────────

const PHYSICS_PROFILES = {
    whale: {
        type: 'gravity',
        gravity: 1.2,           // ↑ heavier pull (was 0.8)
        buoyancy: 0.6,          // ↑ stronger bob (was 0.4)
        noiseScale: 0.005,
        noiseAmp: 45,           // ↑↑ very visible wobble (was 20)
    },
    cascade: {
        type: 'gravity',
        gravity: 1.5,           // ↑ (was 1.0)
        buoyancy: 0.3,
        noiseScale: 0.008,
        noiseAmp: 35,           // ↑↑ (was 15)
    },
    leaf: {
        type: 'flutter',
        airResistance: 0.6,
        flutterFreq: 4.0,      // Hz
        flutterAmp: 0.5,        // ↑ wider flutter (was 0.3)
        terminalVelocity: 0.7,
        noiseScale: 0.02,
        noiseAmp: 30,           // ↑↑ turbulent (was 12)
    },
    wing: {
        type: 'spring',
        tension: 0.9,           // ↑ snappier (was 0.7)
        damping: 0.2,           // ↓ less damped = more bounces (was 0.3)
        frequency: 5.0,
        noiseScale: 0.012,
        noiseAmp: 20,           // ↑↑ (was 8)
    },
    pendulum: {
        type: 'spring',
        tension: 0.6,
        damping: 0.18,          // ↓ (was 0.25)
        frequency: 3.0,
        noiseScale: 0.01,
        noiseAmp: 25,           // ↑↑ (was 10)
    },
    spiral: {
        type: 'orbit',
        pull: 0.6,
        decay: 0.85,
        noiseScale: 0.01,
        noiseAmp: 25,           // ↑↑ (was 10)
    },
    bloom: {
        type: 'orbit',
        pull: 0.4,
        decay: 0.9,
        noiseScale: 0.008,
        noiseAmp: 30,           // ↑↑ (was 12)
    },
    surge: {
        type: 'momentum',
        drag: 0.15,
        inertia: 0.9,
        noiseScale: 0.01,
        noiseAmp: 25,           // ↑↑ (was 10)
    },
    scatter: {
        type: 'momentum',
        drag: 0.3,
        inertia: 0.7,
        noiseScale: 0.015,
        noiseAmp: 20,           // ↑↑ (was 8)
    },
    ribbon: {
        type: 'flutter',
        airResistance: 0.4,
        flutterFreq: 2.5,
        flutterAmp: 0.35,       // ↑ (was 0.2)
        terminalVelocity: 0.8,
        noiseScale: 0.008,
        noiseAmp: 35,           // ↑↑ (was 14)
    },
    crackle: {
        type: 'momentum',
        drag: 0.05,
        inertia: 0.95,
        noiseScale: 0.03,
        noiseAmp: 15,           // ↑↑ (was 6)
    },
};

// Fallback for unknown vocabularies
const DEFAULT_PROFILE = {
    type: 'flutter',
    airResistance: 0.5,
    flutterFreq: 3.0,
    flutterAmp: 0.35,       // ↑ (was 0.2)
    terminalVelocity: 0.8,
    noiseScale: 0.01,
    noiseAmp: 25,            // ↑↑ (was 10)
};

// ─── Physics functions ───────────────────────────────

/**
 * Gravity: accelerating downward pull with buoyant upward counter-force.
 * Creates organic "weight" — heavy objects sink, then bob.
 */
function applyGravity(x, y, t, progress, profile, seed) {
    const { gravity, buoyancy, noiseScale, noiseAmp } = profile;

    // Gravity accelerates over progress (quadratic) — dramatic downward pull
    const gravityPull = gravity * progress * progress * 50;

    // Buoyancy oscillates — creates visible bobbing throughout gesture
    const buoyancyForce = buoyancy * Math.sin(t * 1.5 + seed * 5) * 25 * (1 - progress * 0.3);

    // Perlin drift for organic wobble — applied to BOTH axes
    const nx = noise2D(x * noiseScale + t * 0.4, seed * 100) * noiseAmp;
    const ny = noise2D(y * noiseScale + t * 0.4, seed * 100 + 50) * noiseAmp * 0.6;

    return {
        x: x + nx,
        y: y + gravityPull - buoyancyForce + ny,
    };
}

/**
 * Flutter: air resistance limits speed, oscillating side-drift.
 * Creates the feeling of something light caught in air currents.
 */
function applyFlutter(x, y, t, progress, profile, seed) {
    const { airResistance, flutterFreq, flutterAmp, terminalVelocity, noiseScale, noiseAmp } = profile;

    // Terminal velocity: dampen vertical movement as progress increases
    const speedFactor = 1 - airResistance * Math.min(progress * 1.5, terminalVelocity);

    // Flutter: wide horizontal oscillation that peaks mid-gesture
    const flutterEnvelope = Math.sin(progress * Math.PI);  // peaks at 50%
    const flutter = Math.sin(t * flutterFreq * Math.PI * 2 + seed * 8)
                  * flutterAmp * flutterEnvelope * 70;  // ↑ wider swing (was 40)

    // Secondary flutter at different frequency for complexity
    const flutter2 = Math.cos(t * flutterFreq * 0.7 * Math.PI * 2 + seed * 3)
                   * flutterAmp * 0.4 * flutterEnvelope * 30;

    // Perlin turbulence — stronger
    const nx = noise2D(t * 0.6 + seed * 100, progress * 4) * noiseAmp;
    const ny = noise2D(t * 0.6 + seed * 100 + 50, progress * 4) * noiseAmp * 0.8;

    return {
        x: x + flutter + flutter2 + nx,
        y: y * speedFactor + ny,
    };
}

/**
 * Spring: tension/release oscillation around the base path.
 * Creates bouncy, elastic motion — wings flapping, pendulums swinging.
 */
function applySpring(x, y, t, progress, profile, seed) {
    const { tension, damping, frequency, noiseScale, noiseAmp } = profile;

    // Damped spring oscillation: larger amplitude, slower decay = more bounces visible
    const dampedAmp = tension * Math.exp(-damping * t * 1.5) * 45;  // ↑ bigger (was 25)
    const springX = Math.sin(t * frequency * Math.PI * 2 + seed * 6) * dampedAmp;
    const springY = Math.cos(t * frequency * Math.PI * 2 * 0.7 + seed * 4) * dampedAmp * 0.7;

    // Perlin adds organic imperfection to the spring
    const nx = noise2D(t * 0.8 + seed * 100, progress * 2) * noiseAmp;
    const ny = noise2D(t * 0.8 + seed * 100 + 50, progress * 2) * noiseAmp;

    return {
        x: x + springX + nx,
        y: y + springY + ny,
    };
}

/**
 * Momentum: directional inertia with drag slowing it down.
 * Creates powerful, decelerating motion — surges, bursts.
 */
function applyMomentum(x, y, t, progress, profile, seed) {
    const { drag, inertia, noiseScale, noiseAmp } = profile;

    // Inertia carries forward, drag slows over time
    const speed = inertia * Math.exp(-drag * t * 3);
    const momentumScale = 1 + (speed - 1) * (1 - progress);

    // Perlin turbulence
    const nx = noise2D(t * 0.6 + seed * 100, progress * 4) * noiseAmp;
    const ny = noise2D(t * 0.6 + seed * 100 + 50, progress * 4) * noiseAmp;

    return {
        x: x * momentumScale + nx,
        y: y * momentumScale + ny,
    };
}

/**
 * Orbit: centripetal pull toward origin with decaying radius.
 * Creates spiraling, rotating motion that tightens or loosens.
 */
function applyOrbit(x, y, t, progress, profile, seed) {
    const { pull, decay, noiseScale, noiseAmp } = profile;

    // Pull toward origin increases over progress
    const pullStrength = pull * progress * 0.3;
    const orbitX = x * (1 - pullStrength);
    const orbitY = y * (1 - pullStrength);

    // Slight rotational drift
    const angle = t * 0.3 * (1 + seed * 0.5);
    const cos = Math.cos(angle * 0.1);
    const sin = Math.sin(angle * 0.1);
    const rx = orbitX * cos - orbitY * sin * 0.1;
    const ry = orbitX * sin * 0.1 + orbitY * cos;

    // Perlin
    const nx = noise2D(t * 0.4 + seed * 100, progress * 2.5) * noiseAmp;
    const ny = noise2D(t * 0.4 + seed * 100 + 50, progress * 2.5) * noiseAmp;

    return {
        x: rx + nx,
        y: ry + ny,
    };
}

// ─── Dispatcher ──────────────────────────────────────

const PHYSICS_FNS = {
    gravity: applyGravity,
    flutter: applyFlutter,
    spring: applySpring,
    momentum: applyMomentum,
    orbit: applyOrbit,
};

/**
 * Apply vocabulary-specific physics to a base position.
 *
 * @param {string} vocabularyType  gesture template name
 * @param {number} baseX           x from pathFn
 * @param {number} baseY           y from pathFn
 * @param {number} elapsed         seconds since clip activation
 * @param {number} progress        0–1 clip progress
 * @param {number} seed            per-clip random seed (variation)
 * @returns {{ x: number, y: number }}
 */
export function applyPhysics(vocabularyType, baseX, baseY, elapsed, progress, seed) {
    const profile = PHYSICS_PROFILES[vocabularyType] || DEFAULT_PROFILE;
    const fn = PHYSICS_FNS[profile.type];
    if (!fn) return { x: baseX, y: baseY };
    return fn(baseX, baseY, elapsed, progress, profile, seed);
}

/**
 * Get just the Perlin noise offset for a vocabulary (used during sustain).
 *
 * @param {string} vocabularyType
 * @param {number} elapsed
 * @param {number} seed
 * @returns {{ x: number, y: number }}
 */
export function getPerlinDrift(vocabularyType, elapsed, seed) {
    const profile = PHYSICS_PROFILES[vocabularyType] || DEFAULT_PROFILE;
    const nx = noise2D(elapsed * 0.4 + seed * 100, seed * 200) * profile.noiseAmp;
    const ny = noise2D(elapsed * 0.4 + seed * 100 + 50, seed * 200 + 50) * profile.noiseAmp;
    return { x: nx, y: ny };
}

export { PHYSICS_PROFILES };
