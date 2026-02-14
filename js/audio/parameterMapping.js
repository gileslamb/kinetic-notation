/**
 * Kinetic Notation — Parameter Mapping
 * Sprint 4: Intelligent audio → movement mapping
 * 
 * Responsibilities:
 * - Map audio features to movement parameters
 * - Apply non-linear curves (log, exponential, sigmoid)
 * - Implement hysteresis and smoothing to avoid jitter
 * - Select appropriate motion vocabulary based on musical context
 */

/**
 * @typedef {Object} MovementParams
 * @property {number} velocity      - Movement speed
 * @property {number} curvature     - How much the trace curves
 * @property {number} turbulence    - High-frequency variation
 * @property {number} drift         - Slow directional tendency
 * @property {number} weight        - Line thickness
 * @property {string} motionType    - Which natural motion to use
 */

/**
 * Map extracted audio features to movement parameters.
 * @param {import('./featureExtraction.js').AudioFeatures} features
 * @param {Object} uiParams - User-controlled parameters
 * @returns {MovementParams}
 */
export function mapParameters(features, uiParams) {
    // TODO: Sprint 4 implementation
    return {
        velocity: 0,
        curvature: 0,
        turbulence: 0,
        drift: 0,
        weight: 2,
        motionType: 'drift',
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
