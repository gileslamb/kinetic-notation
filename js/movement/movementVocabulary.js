/**
 * Kinetic Notation — Movement Vocabulary
 * Sprint 3: Library of natural motion patterns
 * 
 * Responsibilities:
 * - Define 7+ organic movement types
 * - Each motion type has characteristic curves, speeds, and rhythms
 * - Provide a unified interface for the blending engine
 */

/**
 * Movement types that map to natural phenomena.
 * Each returns a displacement vector { dx, dy } for a given time step.
 */
export const MotionTypes = {
    DRIFT: 'drift',           // Leaf on wind — slow, wandering
    PULSE: 'pulse',           // Heartbeat — rhythmic expansion/contraction
    SPIRAL: 'spiral',         // Whirlpool — rotational with inward/outward flow
    CASCADE: 'cascade',       // Waterfall — gravity-driven downward flow
    FLUTTER: 'flutter',       // Butterfly — rapid small oscillations
    SURGE: 'surge',           // Ocean wave — swelling directional push
    SCATTER: 'scatter',       // Dandelion seeds — explosive radial dispersion
};

/**
 * Get a motion function by type.
 * @param {string} type - One of MotionTypes values
 * @returns {Function} motion function (time, params) => { dx, dy }
 */
export function getMotion(type) {
    // TODO: Sprint 3 implementation
    return (time, params) => ({ dx: 0, dy: 0 });
}

/**
 * Get all available motion type names.
 * @returns {string[]}
 */
export function listMotions() {
    return Object.values(MotionTypes);
}
