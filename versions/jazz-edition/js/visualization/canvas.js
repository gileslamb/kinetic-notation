/**
 * Kinetic Notation — Canvas Manager
 * 
 * Handles canvas setup, high-DPI scaling, resize events,
 * and exposes the drawing context to other modules.
 */

import Config from '../utils/config.js';
import { debounce } from '../utils/helpers.js';

class CanvasManager {
    constructor() {
        /** @type {HTMLCanvasElement} */
        this.canvas = null;

        /** @type {CanvasRenderingContext2D} */
        this.ctx = null;

        /** Logical dimensions (CSS pixels) */
        this.width = 0;
        this.height = 0;

        /** Device pixel ratio (capped) */
        this.dpr = 1;

        this._resizeHandler = null;
    }

    /**
     * Initialize the canvas element and context.
     * @param {string} canvasId - DOM id of the canvas element
     * @returns {CanvasManager} this (for chaining)
     */
    init(canvasId = 'kinetic-canvas') {
        this.canvas = document.getElementById(canvasId);
        if (!this.canvas) {
            throw new Error(`Canvas element #${canvasId} not found`);
        }

        this.ctx = this.canvas.getContext('2d', {
            alpha: false,           // opaque background — better perf
            desynchronized: true,   // lower latency on supported browsers
        });

        this.dpr = Math.min(window.devicePixelRatio || 1, Config.canvas.maxPixelRatio);

        this._resizeHandler = debounce(() => this.resize(), 100);
        window.addEventListener('resize', this._resizeHandler);

        this.resize();
        return this;
    }

    /**
     * Resize canvas to fill the viewport, accounting for device pixel ratio.
     */
    resize() {
        this.width = window.innerWidth;
        this.height = window.innerHeight;

        // Set the actual pixel dimensions (for sharp rendering)
        this.canvas.width = this.width * this.dpr;
        this.canvas.height = this.height * this.dpr;

        // Set the CSS display size
        this.canvas.style.width = `${this.width}px`;
        this.canvas.style.height = `${this.height}px`;

        // Scale the context so we can draw in CSS-pixel coordinates
        this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

        // Re-apply default context settings after transform reset
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
    }

    /**
     * Clear the entire canvas with the background color.
     * @param {string} [color] - override background color
     */
    clear(color) {
        const bg = color || Config.canvas.backgroundColor;
        this.ctx.fillStyle = bg;
        this.ctx.fillRect(0, 0, this.width, this.height);
    }

    /**
     * Apply a semi-transparent overlay for trail fade effect.
     * @param {number} alpha - 0 (no fade) to 1 (instant clear)
     */
    fade(alpha) {
        this.ctx.fillStyle = `rgba(10, 10, 15, ${alpha})`;
        this.ctx.fillRect(0, 0, this.width, this.height);
    }

    /**
     * Get center point of the canvas.
     * @returns {{ x: number, y: number }}
     */
    get center() {
        return {
            x: this.width / 2,
            y: this.height / 2,
        };
    }

    /**
     * Clean up event listeners.
     */
    destroy() {
        window.removeEventListener('resize', this._resizeHandler);
    }
}

// Singleton export
const canvasManager = new CanvasManager();
export default canvasManager;
