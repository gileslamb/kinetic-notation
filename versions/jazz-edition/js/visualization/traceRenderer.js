/**
 * Kinetic Notation — Trace Renderer
 * 
 * Renders discrete gesture clips as smooth, eased arcs.
 * Each GestureClip owns its own points buffer — no shared spaghetti.
 *
 * RENDERING MODEL:
 *   - Each visible clip is drawn from its first point to its current tip.
 *   - Active clips grow frame-by-frame (new points appended by clipManager).
 *   - Completed clips fade out gracefully over time.
 *   - Color interpolates through the preset palette along clip progress.
 *   - Line weight varies per-point (set by gesture template).
 *   - Glow effect pulses on the active tip.
 */

import Config from '../utils/config.js';
import canvasManager from './canvas.js';
import { clamp, mapRange } from '../utils/helpers.js';

class TraceRenderer {
    constructor() {
        // No persistent state needed — we render from clip data each frame
    }

    /**
     * Render all visible gesture clips onto the canvas.
     * Call once per frame after clip updates.
     *
     * @param {import('../core/clipManager.js').GestureClip[]} clips - visible clips
     * @param {Object} preset - color preset { colors, glowColor }
     * @param {Object} opts
     * @param {number} opts.baseLineWeight - from UI slider
     * @param {number} opts.fadeRate       - trail fade alpha
     */
    render(clips, preset, opts) {
        const { ctx } = canvasManager;
        const { baseLineWeight = 4, fadeRate = 0.03 } = opts;

        // Fade the previous frame (trails)
        canvasManager.fade(fadeRate);

        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        // Draw each clip
        for (const clip of clips) {
            this._renderClip(ctx, clip, preset, baseLineWeight);
        }
    }

    /**
     * Draw a single gesture clip's accumulated path.
     * @private
     */
    _renderClip(ctx, clip, preset, baseLineWeight) {
        const points = clip.points;
        if (points.length < 2) return;

        // Completed clips fade out over time
        let clipAlpha = 1.0;
        if (clip.isComplete()) {
            // _completedAge is set by ClipQueue; fade over ~2 seconds
            const age = clip._completedAge || 0;
            clipAlpha = clamp(1 - age / 2.0, 0, 1);
            if (clipAlpha <= 0) return;  // fully faded, skip
        }

        // Draw path segments
        for (let i = 1; i < points.length; i++) {
            const prev = points[i - 1];
            const curr = points[i];

            // ── Progress-based color ──
            // Map point progress (0→1) through the preset palette
            const progress = curr.progress;
            const colorIndex = progress * (preset.colors.length - 1);
            const ci = Math.floor(colorIndex);
            const color = preset.colors[Math.min(ci, preset.colors.length - 1)];

            // ── Alpha ──
            // Newer points are brighter; combine with clip-level fade
            const pointAlpha = clamp(progress * 1.5 + 0.3, 0.1, 1.0) * clipAlpha;

            // ── Line weight ──
            // Template-driven per-point weight × base slider value
            const weight = baseLineWeight * (curr.weight || 0.5);

            // ── Draw segment ──
            ctx.beginPath();
            ctx.moveTo(prev.x, prev.y);

            // Smooth curve through midpoints if we have a next point
            if (i < points.length - 1) {
                const next = points[i + 1];
                const mx = (curr.x + next.x) / 2;
                const my = (curr.y + next.y) / 2;
                ctx.quadraticCurveTo(curr.x, curr.y, mx, my);
            } else {
                ctx.lineTo(curr.x, curr.y);
            }

            ctx.strokeStyle = this._hexWithAlpha(color, pointAlpha);
            ctx.lineWidth = weight;
            ctx.stroke();
        }

        // ── Glow on active tip ──
        if (clip.isActive() && Config.features.enableGlow && points.length > 0) {
            const tip = points[points.length - 1];
            const glowIntensity = 0.5 + clip.intensity * 1.5;

            ctx.save();
            ctx.shadowColor = preset.glowColor;
            ctx.shadowBlur = Config.trace.glowBlur * glowIntensity;
            ctx.beginPath();
            ctx.arc(tip.x, tip.y, baseLineWeight * glowIntensity * 0.6, 0, Math.PI * 2);
            ctx.fillStyle = preset.colors[0];
            ctx.globalAlpha = clipAlpha;
            ctx.fill();
            ctx.restore();
            ctx.globalAlpha = 1.0;  // reset
        }
    }

    /**
     * Convert hex color + alpha to rgba string.
     * @param {string} hex  e.g. '#ff6b3d'
     * @param {number} alpha 0–1
     * @returns {string}
     */
    _hexWithAlpha(hex, alpha) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    /**
     * No-op for compatibility; clips manage their own state.
     */
    clear() {
        // Clearing is handled by ClipQueue.clear()
    }
}

const traceRenderer = new TraceRenderer();
export default traceRenderer;
