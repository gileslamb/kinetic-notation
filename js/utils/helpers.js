/**
 * Kinetic Notation — Utility Helpers
 * 
 * Pure utility functions used across modules.
 */

/**
 * Clamp a value between min and max.
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

/**
 * Linear interpolation between a and b.
 * @param {number} a - start
 * @param {number} b - end
 * @param {number} t - factor (0–1)
 * @returns {number}
 */
export function lerp(a, b, t) {
    return a + (b - a) * t;
}

/**
 * Map a value from one range to another.
 * @param {number} value
 * @param {number} inMin
 * @param {number} inMax
 * @param {number} outMin
 * @param {number} outMax
 * @returns {number}
 */
export function mapRange(value, inMin, inMax, outMin, outMax) {
    return outMin + ((value - inMin) / (inMax - inMin)) * (outMax - outMin);
}

/**
 * Normalize a value from 0-maxInput to 0-1.
 * @param {number} value
 * @param {number} maxInput
 * @returns {number}
 */
export function normalize(value, maxInput) {
    return clamp(value / maxInput, 0, 1);
}

/**
 * Convert degrees to radians.
 * @param {number} deg
 * @returns {number}
 */
export function degToRad(deg) {
    return deg * (Math.PI / 180);
}

/**
 * Calculate distance between two 2D points.
 * @param {number} x1 
 * @param {number} y1 
 * @param {number} x2 
 * @param {number} y2 
 * @returns {number}
 */
export function distance(x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Smooth exponential decay — useful for trailing values.
 * @param {number} current
 * @param {number} target
 * @param {number} decay - 0–1, higher = slower
 * @returns {number}
 */
export function smoothDamp(current, target, decay) {
    return current + (target - current) * (1 - decay);
}

/**
 * Simple throttle: ensures fn is called at most once per `delay` ms.
 * @param {Function} fn
 * @param {number} delay
 * @returns {Function}
 */
export function throttle(fn, delay) {
    let lastCall = 0;
    return function (...args) {
        const now = performance.now();
        if (now - lastCall >= delay) {
            lastCall = now;
            return fn.apply(this, args);
        }
    };
}

/**
 * Debounce: delays fn execution until `delay` ms of inactivity.
 * @param {Function} fn
 * @param {number} delay
 * @returns {Function}
 */
export function debounce(fn, delay) {
    let timer;
    return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
}

/**
 * Generate a simple unique ID.
 * @param {string} prefix
 * @returns {string}
 */
export function uid(prefix = 'kn') {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}
