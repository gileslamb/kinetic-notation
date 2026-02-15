/**
 * Kinetic Notation — Continuous Line Renderer
 *
 * A single flowing line that progresses left-to-right like a seismograph.
 * Vertical position responds to musical qualities (pitch, amplitude, timbre).
 * The line never stops — always advancing — and fades behind as it moves.
 *
 * ARCHITECTURE:
 *   - currentX increments every frame at constant velocity
 *   - targetY is computed from audio features (pitch → vertical, amplitude → intensity)
 *   - currentY smoothly interpolates toward targetY (smoothing factor)
 *   - pathPoints ring-buffer stores {x, y, alpha, weight, colorT} per frame
 *   - render() draws smooth Bézier curve with per-segment gradient fade
 *   - When currentX passes the right edge, it wraps back to the left
 *
 * USAGE:
 *   const line = new ContinuousLine(canvasManager);
 *   // each frame:
 *   line.update(dt, audioFeatures, params);
 *   line.render(ctx, preset, baseLineWeight);
 */

import { clamp, lerp, mapRange } from '../utils/helpers.js';
import { noise2D } from '../utils/perlin.js';
import { getAnyImportedGesture } from '../movement/naturalMotions.js';
import { generateBiomechanicalGesture } from '../movement/biomechanicalModels.js';

export class ContinuousLine {
    /**
     * @param {Object} canvasManager  the canvas singleton
     * @param {Object} [opts]
     * @param {number} [opts.velocity]       px/sec horizontal advance speed
     * @param {number} [opts.smoothing]      0–1 how fast Y tracks target (lower = smoother)
     * @param {number} [opts.maxPathLength]  max points in buffer
     * @param {number} [opts.fadeTime]       seconds before a point becomes invisible
     * @param {number} [opts.verticalRange]  0–1 fraction of canvas height used
     */
    constructor(canvasManager, opts = {}) {
        this.cm = canvasManager;

        // Tuning
        this.velocity      = opts.velocity      || 2;      // px per frame-equivalent
        this.smoothing     = opts.smoothing     || 0.15;   // Y tracking speed
        this.maxPathLength = opts.maxPathLength || 1500;
        this.fadeTime      = opts.fadeTime      || 3.0;    // seconds
        this.verticalRange = opts.verticalRange || 0.7;    // use 70% of height

        // State
        this.currentX = 0;
        this.currentY = 0;
        this.targetY  = 0;
        this.time     = 0;
        this._seed    = Math.random();

        /** @type {Array<{x:number, y:number, age:number, weight:number, colorT:number}>} */
        this.pathPoints = [];

        this._lastAmplitude = 0;
        this._noiseOffset = Math.random() * 1000;

        // Bio gesture shape cache
        this._bioPath = null;
        this._bioExpiry = 0;
        this._bioIndex = Math.floor(Math.random() * 7);
        this._activeGestureDuration = 10;
    }

    /**
     * Reset the line (e.g. on mode switch or clear).
     */
    reset() {
        this.currentX = 0;
        this.currentY = this.cm.center ? this.cm.center.y : 0;
        this.targetY = this.currentY;
        this.pathPoints = [];
        this.time = 0;
        this._lastAmplitude = 0;
        this._bioPath = null;
        this._bioExpiry = 0;
    }

    /**
     * Advance the line by one frame.
     *
     * @param {number} dt            seconds since last frame
     * @param {Object|null} features audio features { amplitude, spectralCentroid, bass, mid, treble, brightness, onset }
     * @param {Object} params        UI params { sensitivity, speed, lineWeight }
     */
    update(dt, features, params) {
        this.time += dt;

        const w = this.cm.width  || 1920;
        const h = this.cm.height || 1080;
        const cy = h * 0.5;
        const range = h * this.verticalRange * 0.5;  // half-range above/below center

        // ── Horizontal advance ──
        const speed = this.velocity * (0.5 + params.speed * 1.5);  // 0.5×–2× from slider
        this.currentX += speed;

        // Wrap: when past right edge, restart from left
        if (this.currentX > w + 20) {
            this.currentX = -20;
            // Don't clear points — they'll age out naturally
        }

        // ── Vertical target from audio features + gesture shapes ──

        // Get gesture path data — video import first, bio model fallback
        const gesturePath = this._getGestureShapePath();
        let gestureModY = 0;
        let gestureModX = 0;

        if (gesturePath && gesturePath.length > 2) {
            // Sample the gesture path slowly to shape the flowing line
            const gestureTime = this.time * 0.06;  // slow traversal through shape
            const tNorm = (gestureTime % 1);
            const dur = this._activeGestureDuration || 10;
            const targetT = tNorm * dur;

            // Find bounding samples
            const gp = gesturePath;
            let lo = 0, hi = gp.length - 1;
            while (lo < hi - 1) {
                const mid = (lo + hi) >> 1;
                if (gp[mid].t <= targetT) lo = mid;
                else hi = mid;
            }
            const p0 = gp[lo], p1 = gp[hi];
            const span = p1.t - p0.t;
            const frac = span > 0.001 ? (targetT - p0.t) / span : 0;

            // Hermite-smoothed sample from gesture path
            const i0 = Math.max(lo - 1, 0);
            const i3 = Math.min(hi + 1, gp.length - 1);
            const smoothY = _hermiteCL(gp[i0].y, gp[lo].y, gp[hi].y, gp[i3].y, frac);
            const smoothX = _hermiteCL(gp[i0].x, gp[lo].x, gp[hi].x, gp[i3].x, frac);

            // Map 0–1 to displacement: gesture shapes the vertical undulation
            gestureModY = (smoothY - 0.5) * range * 0.6;
            // X modulation subtly adjusts horizontal speed (speed up / slow down)
            gestureModX = (smoothX - 0.5) * 0.8;
        }

        // Apply X modulation to horizontal position (subtle speed variation)
        this.currentX += gestureModX;

        if (features && features.amplitude > 0.01) {
            const amp = features.amplitude * params.sensitivity * 2;
            const brightness = features.brightness || 0.5;
            const bass = features.bass || 0;
            const treble = features.treble || 0;

            // Pitch mapping: bright/treble → upper, bass → lower
            const pitchFactor = (brightness * 0.6 + treble * 0.3 - bass * 0.3);
            const pitchY = cy - pitchFactor * range;

            // Amplitude modulates displacement intensity
            const ampDisplace = (amp * 0.7) * range * 0.5;

            // Subtle Perlin noise for organic drift
            const noiseDrift = noise2D(
                this.time * 0.3 + this._noiseOffset,
                this._seed * 100
            ) * range * 0.08;

            // Onset creates brief upward spike
            const onsetKick = (features.onset || 0) > 0.3
                ? -(features.onset * range * 0.15)
                : 0;

            this.targetY = pitchY + ampDisplace * (Math.random() > 0.5 ? 1 : -1) * 0.3
                         + noiseDrift + onsetKick + gestureModY;

            this._lastAmplitude = amp;
        } else {
            // Silence: gently drift toward center with gesture modulation
            this.targetY = cy
                + noise2D(this.time * 0.15 + this._noiseOffset, this._seed * 100) * range * 0.03
                + gestureModY * 0.3;
            this._lastAmplitude *= 0.95;
        }

        // Clamp target within canvas
        this.targetY = clamp(this.targetY, h * 0.05, h * 0.95);

        // ── Smooth Y interpolation ──
        this.currentY = lerp(this.currentY, this.targetY, this.smoothing);

        // ── Record point ──
        const amp = this._lastAmplitude;
        const weight = 0.3 + clamp(amp, 0, 1) * 0.7;
        const colorT = clamp(amp * 1.5, 0, 1);  // 0 = base color, 1 = bright color

        this.pathPoints.push({
            x: this.currentX,
            y: this.currentY,
            age: 0,
            weight,
            colorT,
        });

        // ── Age all points ──
        for (let i = this.pathPoints.length - 1; i >= 0; i--) {
            this.pathPoints[i].age += dt;
        }

        // ── Prune invisible / over-limit points ──
        this.pathPoints = this.pathPoints.filter(p => p.age < this.fadeTime);
        if (this.pathPoints.length > this.maxPathLength) {
            this.pathPoints = this.pathPoints.slice(-this.maxPathLength);
        }
    }

    /**
     * Render the continuous line onto the canvas.
     *
     * @param {CanvasRenderingContext2D} ctx
     * @param {Object} preset         color preset { colors, glowColor }
     * @param {number} baseLineWeight from UI slider
     */
    render(ctx, preset, baseLineWeight) {
        const pts = this.pathPoints;
        if (pts.length < 2) return;

        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        const fadeTime = this.fadeTime;

        // ── Draw per-segment with gradient alpha ──
        for (let i = 1; i < pts.length; i++) {
            const prev = pts[i - 1];
            const curr = pts[i];

            // Skip if points are too far apart (wrap discontinuity)
            const dx = curr.x - prev.x;
            if (dx < -50 || dx > 100) continue;  // wrap gap or stale

            // Alpha from age: young = bright, old = faded
            const ageFrac = curr.age / fadeTime;
            const alpha = clamp((1 - ageFrac) * (1 - ageFrac), 0, 1);  // quadratic fade
            if (alpha < 0.01) continue;

            // Color: interpolate through palette based on amplitude
            const colorT = curr.colorT * (preset.colors.length - 1);
            const ci = Math.floor(colorT);
            const cf = colorT - ci;
            const c1 = preset.colors[Math.min(ci, preset.colors.length - 1)];
            const c2 = preset.colors[Math.min(ci + 1, preset.colors.length - 1)];
            const color = cf < 0.01 ? c1 : this._lerpColor(c1, c2, cf);

            // Weight: modulated by point weight + base
            const weight = baseLineWeight * curr.weight;

            // ── Smooth Bézier segment ──
            ctx.beginPath();
            ctx.moveTo(prev.x, prev.y);

            if (i < pts.length - 1) {
                const next = pts[i + 1];
                const mx = (curr.x + next.x) / 2;
                const my = (curr.y + next.y) / 2;
                ctx.quadraticCurveTo(curr.x, curr.y, mx, my);
            } else {
                ctx.lineTo(curr.x, curr.y);
            }

            ctx.strokeStyle = this._hexAlpha(color, alpha);
            ctx.lineWidth = Math.max(weight, 0.5);
            ctx.stroke();
        }

        // ── Glow on the leading tip ──
        if (pts.length > 0) {
            const tip = pts[pts.length - 1];
            const tipAlpha = clamp(1 - tip.age / fadeTime, 0, 1);
            if (tipAlpha > 0.1) {
                const radius = baseLineWeight * (0.8 + this._lastAmplitude * 1.5);
                const grad = ctx.createRadialGradient(tip.x, tip.y, 0, tip.x, tip.y, radius * 2);
                const baseColor = preset.colors[0];
                grad.addColorStop(0, this._hexAlpha(baseColor, 0.5 * tipAlpha));
                grad.addColorStop(0.4, this._hexAlpha(baseColor, 0.15 * tipAlpha));
                grad.addColorStop(1, this._hexAlpha(baseColor, 0));

                ctx.save();
                ctx.shadowColor = preset.glowColor;
                ctx.shadowBlur = 12;
                ctx.beginPath();
                ctx.arc(tip.x, tip.y, radius * 2, 0, Math.PI * 2);
                ctx.fillStyle = grad;
                ctx.fill();
                ctx.restore();
            }
        }
    }

    // ── Gesture Shape Source ──

    /**
     * Get the gesture path data to modulate the continuous line.
     * Priority: video import → biomechanical model (always available).
     * Bio models rotate through vocabularies for variety.
     *
     * @returns {Array<{x:number, y:number, t:number, intensity:number}>|null}
     */
    _getGestureShapePath() {
        // Priority 1: video import
        const imported = getAnyImportedGesture();
        if (imported && imported.path.length > 2) {
            this._activeGestureDuration = imported.duration;
            return imported.path;
        }

        // Priority 2: biomechanical model — generate and cache
        if (!this._bioPath || this._bioExpiry < this.time) {
            this._generateBioPath();
        }

        return this._bioPath;
    }

    /**
     * Generate a fresh biomechanical path and cache it.
     * Rotates through different vocabulary models for visual variety.
     */
    _generateBioPath() {
        const vocabs = ['whale', 'wing', 'leaf', 'fish', 'spiral', 'ribbon', 'cascade'];
        const idx = (this._bioIndex || 0) % vocabs.length;
        const vocab = vocabs[idx];
        this._bioIndex = idx + 1;

        // Vary intensity and duration each cycle
        const intensity = 0.3 + Math.random() * 0.5;
        const duration = 8 + Math.random() * 8;  // 8–16 seconds

        try {
            const bio = generateBiomechanicalGesture(vocab, intensity, duration, this.time * 100);
            this._bioPath = bio.path;
            this._activeGestureDuration = bio.duration;
            // Cache for the duration of this gesture cycle, then regenerate
            this._bioExpiry = this.time + duration * 0.9;
        } catch (e) {
            // Fallback: gentle sine wave
            this._bioPath = null;
            this._bioExpiry = this.time + 10;
        }
    }

    // ── Helpers ──

    _hexAlpha(hex, a) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r},${g},${b},${a})`;
    }

    _lerpColor(hex1, hex2, t) {
        const r1 = parseInt(hex1.slice(1, 3), 16), g1 = parseInt(hex1.slice(3, 5), 16), b1 = parseInt(hex1.slice(5, 7), 16);
        const r2 = parseInt(hex2.slice(1, 3), 16), g2 = parseInt(hex2.slice(3, 5), 16), b2 = parseInt(hex2.slice(5, 7), 16);
        const r = Math.round(r1 + (r2 - r1) * t), g = Math.round(g1 + (g2 - g1) * t), b = Math.round(b1 + (b2 - b1) * t);
        return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
    }
}

/** Catmull-Rom hermite interpolation helper for continuous line. */
function _hermiteCL(p0, p1, p2, p3, t) {
    const t2 = t * t;
    const t3 = t2 * t;
    return (
        (2 * t3 - 3 * t2 + 1) * p1 +
        (t3 - 2 * t2 + t) * 0.5 * (p2 - p0) +
        (-2 * t3 + 3 * t2) * p2 +
        (t3 - t2) * 0.5 * (p3 - p1)
    );
}
