/**
 * Kinetic Notation — Clip Manager (MIDI sustain + continuity)
 *
 * LIFECYCLE:
 *   PENDING → ACTIVE → SUSTAINING → RELEASING → COMPLETE → (pruned)
 *
 * MIDI SUSTAIN (per-note):
 *   1. Note-on creates clip with _midiHeld = true
 *   2. At 85% progress, clip enters SUSTAINING (early — before gesture ends)
 *   3. SUSTAINING loops the middle 40% of gesture path (0.3 → 0.7 ping-pong)
 *      with positional drift and scale breathing to stay organic
 *   4. Note-off → release() → RELEASING: plays from current position to 1.0
 *   5. RELEASING completes → COMPLETE → fades out
 *
 * AUDIO SUSTAIN (global):
 *   Audio clips use the global `shouldSustain` flag (set when audio is
 *   above threshold). Enters sustain at progress 1.0 (gesture's natural end).
 *
 * Both types coexist in the same queue. MIDI clips ignore the global flag.
 */

import { uid } from '../utils/helpers.js';

// ─── Clip States ─────────────────────────────────────

export const ClipState = {
    PENDING:    'pending',
    ACTIVE:     'active',
    SUSTAINING: 'sustaining',  // looping middle of gesture
    RELEASING:  'releasing',   // playing graceful ending tail
    COMPLETE:   'complete',
};

// ─── Easing ──────────────────────────────────────────

function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
function easeOutElastic(t) {
    if (t === 0 || t === 1) return t;
    return Math.pow(2, -10 * t) * Math.sin((t - 0.1) * (2 * Math.PI) / 0.4) + 1;
}
function easeOutQuad(t) {
    return 1 - (1 - t) * (1 - t);
}
function easeInOutSine(t) {
    return -(Math.cos(Math.PI * t) - 1) / 2;
}

const EASING_MAP = {
    cubic: easeInOutCubic,
    elastic: easeOutElastic,
    quad: easeOutQuad,
    sine: easeInOutSine,
};

// ─── GestureClip ─────────────────────────────────────

export class GestureClip {
    /**
     * @param {Object} opts
     * @param {string}   opts.vocabularyType
     * @param {number}   opts.duration       - base gesture length (seconds)
     * @param {number}   opts.intensity      - 0–1
     * @param {Object}   opts.origin         - { x, y }
     * @param {number}   opts.heading        - radians
     * @param {number}   opts.scale          - size multiplier
     * @param {Function} opts.pathFn         - (t, clip) => { x, y, weight }
     * @param {string}   [opts.easingName]
     * @param {number}   [opts.variation]    - random seed for template variations
     * @param {string}   [opts.midiNoteKey]  - "ch:note" if spawned by MIDI
     */
    constructor(opts) {
        this.id = uid('clip');

        // Identity
        this.vocabularyType = opts.vocabularyType;
        this.duration = opts.duration;
        this.intensity = opts.intensity;
        this.variation = opts.variation ?? Math.random();

        // Spatial
        this.origin = { ...opts.origin };
        this.heading = opts.heading ?? 0;
        this.scale = opts.scale ?? 1;

        // Path generator
        this.pathFn = opts.pathFn;

        // Easing
        this.easingFn = EASING_MAP[opts.easingName] || easeInOutCubic;

        // Timing
        this.state = ClipState.PENDING;
        this.elapsed = 0;
        this.progress = 0;
        this.easedProgress = 0;

        // ── MIDI sustain tracking ──
        this.midiNoteKey = opts.midiNoteKey || null;
        this._midiHeld = !!opts.midiNoteKey;  // starts held if spawned by MIDI

        // ── Sustain state ──
        this.sustainCycles = 0;
        this.maxSustainCycles = 20;       // generous cap for long notes
        this._sustainStart = 0;           // elapsed time when sustain began
        this._sustainEntryT = 0;          // eased progress at sustain entry
        this._currentPathT = 0;           // last value sent to pathFn

        // ── Release state ──
        this._releaseStart = 0;           // elapsed time when release began
        this._releaseProgressStart = 0;   // pathT at release start
        this._releaseDuration = 0.4;      // seconds for release tail

        // Rendered path
        this.points = [];

        // Per-frame MIDI expression (updated externally)
        this.liveIntensity = opts.intensity;
        this.livePitchBend = 0;
        this.liveSlide = 0;

        // Fade-out age (accumulated after COMPLETE)
        this._completedAge = 0;
    }

    activate() {
        this.state = ClipState.ACTIVE;
        this.elapsed = 0;
        this.progress = 0;
        this.easedProgress = 0;
        this._currentPathT = 0;
    }

    /**
     * Advance the clip by dt seconds.
     *
     * @param {number}  dt             seconds since last frame
     * @param {boolean} shouldSustain  global continuity flag (audio clips only)
     */
    update(dt, shouldSustain = false) {
        if (this.state === ClipState.PENDING || this.state === ClipState.COMPLETE) return;

        this.elapsed += dt;

        let pathT;  // the value we'll send to pathFn (eased space)

        // ── STATE: RELEASING ─────────────────────────
        // Gracefully animating from sustain position to gesture end
        if (this.state === ClipState.RELEASING) {
            const since = this.elapsed - this._releaseStart;
            const frac = Math.min(since / this._releaseDuration, 1.0);
            const eased = easeOutQuad(frac);

            // Interpolate from release start point to 1.0
            pathT = this._releaseProgressStart + (1.0 - this._releaseProgressStart) * eased;
            this.progress = pathT;

            if (frac >= 1.0) {
                this.state = ClipState.COMPLETE;
            }
        }

        // ── STATE: SUSTAINING ────────────────────────
        // Looping the middle 40% of gesture (0.3 → 0.7 ping-pong)
        // with positional drift and scale breathing
        else if (this.state === ClipState.SUSTAINING) {
            const since = this.elapsed - this._sustainStart;
            const halfCycle = this.duration * 0.6;  // time for one traverse

            // Ping-pong phase: 0 → 1 → 0 → 1 …
            let phase = (since / halfCycle) % 2.0;
            if (phase > 1.0) phase = 2.0 - phase;
            phase = easeInOutSine(phase);  // smooth the oscillation

            // Map to the middle band of the gesture path
            const loopT = 0.3 + phase * 0.4;

            // Smooth blend from entry point into the loop (over 0.4s)
            const blend = Math.min(since / 0.4, 1.0);
            const blendEased = easeOutQuad(blend);
            pathT = this._sustainEntryT * (1 - blendEased) + loopT * blendEased;

            this.progress = pathT;
            this.sustainCycles = Math.floor(since / (halfCycle * 2));

            // Should we keep sustaining?
            const shouldKeep = this.midiNoteKey ? this._midiHeld : shouldSustain;
            if (!shouldKeep || this.sustainCycles >= this.maxSustainCycles) {
                this._beginRelease();
            }
        }

        // ── STATE: ACTIVE ────────────────────────────
        // Normal playback: progress 0 → 1
        else {
            this.progress = Math.min(this.elapsed / this.duration, 1.0);

            // Apply the clip's easing curve
            pathT = this.easingFn(this.progress);

            // Check for sustain entry
            // MIDI clips: enter sustain at 85% (before gesture finishes)
            // Audio clips: enter sustain at 100% (natural end)
            const sustainThreshold = this.midiNoteKey ? 0.85 : 1.0;

            if (this.progress >= sustainThreshold) {
                const shouldKeep = this.midiNoteKey ? this._midiHeld : shouldSustain;

                if (shouldKeep && this.sustainCycles < this.maxSustainCycles) {
                    this.state = ClipState.SUSTAINING;
                    this._sustainStart = this.elapsed;
                    this._sustainEntryT = pathT;  // eased value at entry
                } else if (this.progress >= 1.0) {
                    this.state = ClipState.COMPLETE;
                    pathT = 1.0;
                }
            }
        }

        // Store for release reference
        this._currentPathT = pathT;
        this.easedProgress = pathT;

        // ── Compute position from path function ──
        const pos = this.pathFn(pathT, this);

        // ── Sustain drift: organic noise to prevent static loop ──
        let driftX = 0, driftY = 0;
        let breathWeight = 1;

        if (this.state === ClipState.SUSTAINING) {
            const t = this.elapsed;
            // Slow sine-based positional wander
            driftX = Math.sin(t * 0.7 + this.variation * 10) * this.scale * 5;
            driftY = Math.cos(t * 0.5 + this.variation * 7)  * this.scale * 5;
            // Subtle scale breathing (0.95x – 1.05x)
            breathWeight = 1 + 0.05 * Math.sin(t * 1.5);
        } else if (this.state === ClipState.RELEASING) {
            // Diminishing drift during release
            const since = this.elapsed - this._releaseStart;
            const fade = 1 - Math.min(since / this._releaseDuration, 1.0);
            driftX = Math.sin(this.elapsed * 0.7 + this.variation * 10) * this.scale * 5 * fade;
            driftY = Math.cos(this.elapsed * 0.5 + this.variation * 7)  * this.scale * 5 * fade;
            breathWeight = 1 + 0.05 * Math.sin(this.elapsed * 1.5) * fade;
        }

        this.points.push({
            x: pos.x + driftX,
            y: pos.y + driftY,
            weight: (pos.weight ?? 1) * breathWeight,
            progress: Math.min(this.progress, 1.0),
        });

        // Cap point buffer to prevent memory issues during long sustains
        if (this.points.length > 2000) {
            this.points = this.points.slice(-1500);
        }
    }

    // ── Release ──────────────────────────────────────

    /**
     * Trigger release.
     * MIDI clips: enters RELEASING (graceful ending tail).
     * Audio clips: immediate COMPLETE.
     */
    release() {
        if (this.state === ClipState.RELEASING || this.state === ClipState.COMPLETE) return;

        this._midiHeld = false;

        if (this.state === ClipState.SUSTAINING && this.midiNoteKey) {
            // Was looping — play the graceful ending
            this._beginRelease();
        } else if (this.state === ClipState.ACTIVE && this.midiNoteKey) {
            // Short note — released before sustain entry.
            // Just let it finish its natural arc (will complete at progress 1.0).
            // _midiHeld = false prevents sustain entry at 0.85.
        } else {
            // Audio clips or other — immediate complete
            this.state = ClipState.COMPLETE;
        }
    }

    /** @private Enter RELEASING state with computed duration. */
    _beginRelease() {
        this.state = ClipState.RELEASING;
        this._releaseStart = this.elapsed;
        this._releaseProgressStart = this._currentPathT;

        // Release duration scales with remaining path distance
        // Minimum 0.15s so it's never abrupt
        this._releaseDuration = Math.max(
            (1.0 - this._releaseProgressStart) * this.duration * 0.5,
            0.15
        );
    }

    // ── Queries ──────────────────────────────────────

    getTip() {
        return this.points.length > 0 ? this.points[this.points.length - 1] : null;
    }

    isComplete() {
        return this.state === ClipState.COMPLETE;
    }

    isActive() {
        return this.state === ClipState.ACTIVE
            || this.state === ClipState.SUSTAINING
            || this.state === ClipState.RELEASING;
    }

    isSustaining() {
        return this.state === ClipState.SUSTAINING;
    }
}


// ─── ClipQueue ───────────────────────────────────────

export class ClipQueue {
    /**
     * @param {number} maxConcurrent
     */
    constructor(maxConcurrent = 5) {
        this.maxConcurrent = maxConcurrent;

        /** @type {GestureClip[]} */
        this.clips = [];

        this.cooldown = 0.12;
        this._lastSpawnTime = 0;
        this._clock = 0;
    }

    /**
     * Enqueue a clip. Respects cooldown and concurrency limits.
     * @param {GestureClip} clip
     * @returns {boolean}
     */
    enqueue(clip) {
        if (this._clock - this._lastSpawnTime < this.cooldown) return false;

        const active = this.clips.filter(c => c.isActive()).length;
        if (active >= this.maxConcurrent) return false;

        clip.activate();
        this.clips.push(clip);
        this._lastSpawnTime = this._clock;
        return true;
    }

    /**
     * Update all clips.
     * @param {number}  dt
     * @param {boolean} isContinuous  global flag (audio clips use this; MIDI clips ignore it)
     * @param {number}  fadeDelay     seconds to keep completed clips visible
     */
    update(dt, isContinuous = false, fadeDelay = 2.0) {
        this._clock += dt;

        for (const clip of this.clips) {
            clip.update(dt, isContinuous);
        }

        // Prune old completed clips
        this.clips = this.clips.filter(clip => {
            if (!clip.isComplete()) return true;
            clip._completedAge += dt;
            return clip._completedAge < fadeDelay;
        });
    }

    /**
     * Release all sustaining AUDIO clips (not MIDI clips).
     * Called when audio drops below threshold.
     */
    releaseAll() {
        for (const clip of this.clips) {
            if (clip.isSustaining() && !clip.midiNoteKey) {
                clip.release();
            }
        }
    }

    /**
     * Release the clip linked to a specific MIDI note.
     * @param {string} noteKey  "ch:note"
     */
    releaseMidiNote(noteKey) {
        for (const clip of this.clips) {
            if (clip.midiNoteKey === noteKey && clip.isActive()) {
                clip.release();
            }
        }
    }

    /** Get clips that should be rendered (active + fading). */
    getVisibleClips() {
        return this.clips.filter(c => c.isActive() || c.isComplete());
    }

    getActiveClips() {
        return this.clips.filter(c => c.isActive());
    }

    get activeCount() {
        return this.clips.filter(c => c.isActive()).length;
    }

    clear() {
        this.clips = [];
        this._lastSpawnTime = 0;
    }
}
