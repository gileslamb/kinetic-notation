/**
 * Kinetic Notation — Trace Renderer
 * 
 * Renders discrete gesture clips as smooth, eased arcs.
 * Each GestureClip owns its own points buffer — no shared spaghetti.
 *
 * RENDERING MODES:
 *   JAZZ (default):
 *     - Angular segment-by-segment paths
 *     - End-to-start connections (the "line quirk")
 *     - Per-segment constant color
 *     - Sharp, cubist aesthetic
 *
 *   ORGANIC (meditative):
 *     - Smooth Catmull-Rom splines (no angular joints)
 *     - Gentle alpha gradient: slow fade from head to tail
 *     - Each gesture is a STANDALONE flowing arc — NO connections
 *     - Soft, tapered line weight
 *     - Very slow trail persistence (15-30s)
 *     - Diffuse radial glow
 *     - Like watching ink slowly diffuse in water
 *
 *   Both modes share: glow effect, clip fade-out, progress-based palette.
 */

import Config from '../utils/config.js';
import canvasManager from './canvas.js';
import { clamp, mapRange } from '../utils/helpers.js';

class TraceRenderer {
    constructor() {
        this._renderMode = 'jazz';  // 'jazz' | 'organic'
    }

    /**
     * Set the render mode. Called by App._applyVisualMode().
     * @param {string} mode  'jazz' | 'organic'
     */
    setRenderMode(mode) {
        this._renderMode = mode || 'jazz';
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

        // Draw each clip with the appropriate mode renderer
        for (const clip of clips) {
            if (this._renderMode === 'organic') {
                this._renderClipOrganic(ctx, clip, preset, baseLineWeight);
            } else {
                this._renderClipJazz(ctx, clip, preset, baseLineWeight);
            }
        }
    }

    // ═══════════════════════════════════════════════════════
    //  JAZZ MODE — original angular renderer (preserved exactly)
    // ═══════════════════════════════════════════════════════

    /**
     * Draw a single gesture clip — Jazz mode (angular, segment-by-segment).
     * @private
     */
    _renderClipJazz(ctx, clip, preset, baseLineWeight) {
        const points = clip.points;
        if (points.length < 2) return;

        // Completed clips fade out over time
        let clipAlpha = 1.0;
        if (clip.isComplete()) {
            const age = clip._completedAge || 0;
            clipAlpha = clamp(1 - age / 2.0, 0, 1);
            if (clipAlpha <= 0) return;
        }

        // Draw path segments
        for (let i = 1; i < points.length; i++) {
            const prev = points[i - 1];
            const curr = points[i];

            // Progress-based color
            const progress = curr.progress;
            const colorIndex = progress * (preset.colors.length - 1);
            const ci = Math.floor(colorIndex);
            const color = preset.colors[Math.min(ci, preset.colors.length - 1)];

            // Alpha — newer points are brighter
            const pointAlpha = clamp(progress * 1.5 + 0.3, 0.1, 1.0) * clipAlpha;

            // Line weight
            const weight = baseLineWeight * (curr.weight || 0.5);

            // Draw segment
            ctx.beginPath();
            ctx.moveTo(prev.x, prev.y);

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

        // Glow on active tip
        if (clip.isActive() && Config.features.enableGlow && points.length > 0) {
            this._drawGlow(ctx, clip, preset, baseLineWeight, clipAlpha);
        }
    }

    // ═══════════════════════════════════════════════════════
    //  ORGANIC MODE — meditative standalone arcs
    // ═══════════════════════════════════════════════════════

    /**
     * Draw a single gesture clip — Organic meditative mode.
     *
     * Each gesture is a STANDALONE flowing arc:
     *   - NO connections to other clips
     *   - NO closePath / loop-back
     *   - Smooth Catmull-Rom splines with low tension (very flowing)
     *   - Gentle alpha: slow linear ramp, not aggressive cubic
     *   - Soft weight taper: barely perceptible thinning at tail
     *   - Subtle glow: diffuse halo, not punchy
     *
     * @private
     */
    _renderClipOrganic(ctx, clip, preset, baseLineWeight) {
        const points = clip.points;
        if (points.length < 2) return;

        // Completed clips fade out VERY slowly (meditative persistence)
        let clipAlpha = 1.0;
        if (clip.isComplete()) {
            const age = clip._completedAge || 0;
            // Slow fade: 4 seconds to fully disappear (was 2s)
            clipAlpha = clamp(1 - age / 4.0, 0, 1);
            if (clipAlpha <= 0) return;
        }

        const len = points.length;
        const mode = clip.mode;
        const gradLen = (mode && mode.trailGradientLength) || 800;

        // Determine visible range — show the entire trail up to gradLen points
        const tailStart = Math.max(0, len - gradLen);
        const visibleCount = len - tailStart;
        if (visibleCount < 2) return;

        // ── Per-segment rendering: smooth spline, gentle gradient ──
        for (let i = tailStart + 1; i < len; i++) {

            // ── Skip discontinuities (loop-backs, sustain jumps) ──
            // If two consecutive points are too far apart, don't draw
            // the connecting line — keeps gestures as clean open arcs.
            const prev = points[i - 1];
            const curr = points[i];
            const dx = curr.x - prev.x;
            const dy = curr.y - prev.y;
            const dist = dx * dx + dy * dy;  // squared distance, no sqrt needed
            if (dist > 2500) continue;  // > 50px jump = discontinuity, skip

            // Position within visible range (0 = tail, 1 = head)
            const tailPos = (i - tailStart) / visibleCount;

            // ── ALPHA: gentle linear gradient, not aggressive ──
            // Smooth S-curve: both ends soft, middle visible
            // This creates the "ink diffusing in water" look
            const easeAlpha = tailPos * tailPos * (3 - 2 * tailPos);  // smoothstep
            const segAlpha = clamp(easeAlpha * 0.75 + 0.03, 0.03, 0.75) * clipAlpha;

            // ── COLOR: smooth interpolation through palette ──
            const progress = points[i].progress;
            const colorT = progress * (preset.colors.length - 1);
            const ci = Math.floor(colorT);
            const cf = colorT - ci;
            const c1 = preset.colors[Math.min(ci, preset.colors.length - 1)];
            const c2 = preset.colors[Math.min(ci + 1, preset.colors.length - 1)];
            const color = cf < 0.01 ? c1 : this._lerpColor(c1, c2, cf);

            // ── LINE WEIGHT: gentle taper — subtle thinning at tail ──
            const weightTaper = 0.5 + tailPos * 0.5;  // 50% at tail → 100% at head
            const weight = baseLineWeight * (points[i].weight || 0.5) * weightTaper;

            // ── DRAW: Catmull-Rom segment as cubic bezier ──
            const p0 = points[Math.max(i - 2, tailStart)];
            const p1 = points[i - 1];
            const p2 = points[i];
            const p3 = points[Math.min(i + 1, len - 1)];

            // Low tension = very smooth, flowing curves (no angular joints)
            const tension = 0.2;

            const cp1x = p1.x + (p2.x - p0.x) * tension;
            const cp1y = p1.y + (p2.y - p0.y) * tension;
            const cp2x = p2.x - (p3.x - p1.x) * tension;
            const cp2y = p2.y - (p3.y - p1.y) * tension;

            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);

            ctx.strokeStyle = this._hexWithAlpha(color, segAlpha);
            ctx.lineWidth = Math.max(weight, 0.5);
            ctx.stroke();
        }

        // ── Soft diffuse glow on active tip ──
        if (clip.isActive() && Config.features.enableGlow && len > 0) {
            this._drawGlowOrganic(ctx, clip, preset, baseLineWeight, clipAlpha);
        }
    }

    // ═══════════════════════════════════════════════════════
    //  SHARED HELPERS
    // ═══════════════════════════════════════════════════════

    /**
     * Draw glow on the active tip — Jazz style (crisp, punchy).
     * @private
     */
    _drawGlow(ctx, clip, preset, baseLineWeight, clipAlpha) {
        const tip = clip.points[clip.points.length - 1];
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
        ctx.globalAlpha = 1.0;
    }

    /**
     * Draw glow on the active tip — Organic style.
     * Very soft, wide diffuse halo — meditative presence.
     * @private
     */
    _drawGlowOrganic(ctx, clip, preset, baseLineWeight, clipAlpha) {
        const tip = clip.points[clip.points.length - 1];
        // Subdued glow — not attention-grabbing, just a gentle presence
        const glowIntensity = 0.25 + clip.intensity * 0.5;
        const radius = baseLineWeight * glowIntensity * 3.5;  // wide and soft

        ctx.save();

        // Radial gradient fill — gentle halo
        const grad = ctx.createRadialGradient(tip.x, tip.y, 0, tip.x, tip.y, radius);
        const baseColor = preset.colors[0];
        grad.addColorStop(0,   this._hexWithAlpha(baseColor, 0.4 * clipAlpha));
        grad.addColorStop(0.3, this._hexWithAlpha(baseColor, 0.15 * clipAlpha));
        grad.addColorStop(0.6, this._hexWithAlpha(baseColor, 0.04 * clipAlpha));
        grad.addColorStop(1,   this._hexWithAlpha(baseColor, 0));

        ctx.shadowColor = preset.glowColor;
        ctx.shadowBlur = Config.trace.glowBlur * glowIntensity * 2.5;

        ctx.beginPath();
        ctx.arc(tip.x, tip.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.restore();
        ctx.globalAlpha = 1.0;
    }

    /**
     * Linearly interpolate between two hex colors.
     * @private
     */
    _lerpColor(hex1, hex2, t) {
        const r1 = parseInt(hex1.slice(1, 3), 16);
        const g1 = parseInt(hex1.slice(3, 5), 16);
        const b1 = parseInt(hex1.slice(5, 7), 16);
        const r2 = parseInt(hex2.slice(1, 3), 16);
        const g2 = parseInt(hex2.slice(3, 5), 16);
        const b2 = parseInt(hex2.slice(5, 7), 16);
        const r = Math.round(r1 + (r2 - r1) * t);
        const g = Math.round(g1 + (g2 - g1) * t);
        const b = Math.round(b1 + (b2 - b1) * t);
        return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
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
