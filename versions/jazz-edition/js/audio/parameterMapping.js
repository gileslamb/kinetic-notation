/**
 * Kinetic Notation — Parameter Mapping
 * Intelligent audio → movement mapping.
 * 
 * Responsibilities:
 * - Map audio features to movement parameters
 * - Apply smoothing to avoid jitter
 * - Select motion character based on spectral content
 */

/**
 * @typedef {Object} MovementParams
 * @property {number} velocity      - Movement speed (0–1)
 * @property {number} curvature     - How much the trace curves (0–1)
 * @property {number} turbulence    - High-frequency variation (0–1)
 * @property {number} drift         - Slow directional tendency (0–1)
 * @property {number} weight        - Line thickness (0–1)
 * @property {number} spread        - How far from center (0–1)
 * @property {string} motionType    - Which natural motion to use
 */

// Smoothed state (persists between calls)
const _smoothed = {
    velocity: 0,
    curvature: 0,
    turbulence: 0,
    drift: 0.3,
    weight: 0.3,
    spread: 0.3,
};

/**
 * Map extracted audio features to movement parameters.
 * @param {import('./featureExtraction.js').AudioFeatures} features
 * @param {Object} uiParams - User-controlled parameters (sensitivity, speed, etc.)
 * @returns {MovementParams}
 */
export function mapParameters(features, uiParams) {
    const sensitivity = uiParams.sensitivity || 0.5;
    const speedMod = uiParams.speed || 0.5;

    // ── Target values derived from audio ──

    // Velocity: driven by amplitude and speed slider
    const targetVelocity = features.amplitude * sensitivity * speedMod * 2;

    // Curvature: bass makes sweeping curves, treble makes tight ones
    const targetCurvature = (features.bass * 0.6 + features.brightness * 0.4) * sensitivity;

    // Turbulence: treble energy creates jittery, energetic motion
    const targetTurbulence = features.treble * sensitivity * 1.5;

    // Drift: mid-range creates gentle directional shifts
    const targetDrift = features.mid * sensitivity * 0.8;

    // Weight: amplitude controls line thickness
    const targetWeight = 0.15 + features.amplitude * sensitivity * 0.85;

    // Spread: how far the trace moves from center — overall energy
    const targetSpread = (features.amplitude * 0.5 + features.bass * 0.3 + features.onset * 0.2) * sensitivity;

    // ── Smooth all values to avoid jitter ──
    const smoothing = 0.82;
    _smoothed.velocity = smooth(_smoothed.velocity, targetVelocity, smoothing);
    _smoothed.curvature = smooth(_smoothed.curvature, targetCurvature, smoothing);
    _smoothed.turbulence = smooth(_smoothed.turbulence, targetTurbulence, 0.75); // faster response
    _smoothed.drift = smooth(_smoothed.drift, targetDrift, smoothing);
    _smoothed.weight = smooth(_smoothed.weight, targetWeight, smoothing);
    _smoothed.spread = smooth(_smoothed.spread, targetSpread, 0.78);

    // ── Choose motion type based on spectral character ──
    let motionType = 'drift';
    if (features.onset > 0.3) {
        motionType = 'pulse';
    } else if (features.treble > 0.4 && features.bass < 0.2) {
        motionType = 'flutter';
    } else if (features.bass > 0.5) {
        motionType = 'surge';
    } else if (features.brightness > 0.5) {
        motionType = 'spiral';
    }

    return {
        velocity: _smoothed.velocity,
        curvature: _smoothed.curvature,
        turbulence: _smoothed.turbulence,
        drift: _smoothed.drift,
        weight: _smoothed.weight,
        spread: _smoothed.spread,
        motionType,
    };
}

/**
 * Apply smoothing to avoid parameter jitter.
 * Uses exponential moving average.
 * @param {number} current
 * @param {number} target
 * @param {number} smoothing - 0 (instant) to 1 (frozen)
 * @returns {number}
 */
export function smooth(current, target, smoothing = 0.85) {
    return current + (target - current) * (1 - smoothing);
}
