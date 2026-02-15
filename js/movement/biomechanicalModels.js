/**
 * Kinetic Notation — Biomechanical Motion Models
 *
 * Parametric generators that produce biologically-inspired motion paths.
 * Each function returns a normalized path: [{x, y, t, intensity}]
 *   - x, y in [0,1]
 *   - t in seconds (0 → duration)
 *   - intensity in [0,1]
 *
 * These paths are the DEFAULT gesture source for every vocabulary.
 * Video-imported paths can override them but these are always available.
 *
 * PHYSICS PRINCIPLES:
 *   Whale  — parabolic arc with gravity, buoyancy, momentum decay
 *   Wing   — figure-8 Lissajous with downstroke/upstroke asymmetry
 *   Leaf   — spiral descent with tumble, air resistance, terminal velocity
 *   Fish   — S-curve body wave with sudden acceleration/deceleration
 */

// ═══════════════════════════════════════════════════
//  UTILITY HELPERS
// ═══════════════════════════════════════════════════

/** Clamp value to [0, 1]. */
function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

/** Linear interpolation. */
function lerp(a, b, t) { return a + (b - a) * t; }

/** Smooth Hermite (smoothstep). */
function smoothstep(t) { return t * t * (3 - 2 * t); }

/** Seeded pseudo-random (deterministic from a seed). */
function seededRandom(seed) {
    let s = Math.sin(seed * 127.1 + seed * 311.7) * 43758.5453;
    return s - Math.floor(s);
}

/** Generate N evenly-spaced points between 0 and duration. */
function makeTimeSteps(n, duration) {
    const pts = [];
    for (let i = 0; i <= n; i++) {
        pts.push(i / n * duration);
    }
    return pts;
}

// ═══════════════════════════════════════════════════
//  WHALE — Parabolic gravity arc with momentum decay
// ═══════════════════════════════════════════════════

/**
 * Whale breach: powerful upward launch, arc through air, gravity return.
 *
 * Physics: momentum = intensity, gravity = 9.8, water resistance on re-entry.
 * Duration: 8–12 seconds. Amplitude scales with intensity.
 *
 * @param {number} intensity   0–1 energy level (affects height, speed)
 * @param {number} duration    seconds (default 10)
 * @param {number} [seed]      random seed for variation
 * @returns {Array<{x:number, y:number, t:number, intensity:number}>}
 */
export function createWhaleBreachPath(intensity = 0.7, duration = 10, seed = 0) {
    const steps = Math.max(Math.round(duration * 30), 60);
    const path = [];
    const v = seededRandom(seed);

    // Breach parameters scaled by intensity
    const peakHeight = 0.3 + intensity * 0.35;       // 0.3–0.65 vertical reach
    const horizontalDrift = 0.15 + intensity * 0.2;   // gentle lateral movement
    const breachPoint = 0.25 + v * 0.1;               // 25–35% of duration = apex
    const gravity = 0.8 + intensity * 0.4;             // gravitational pull

    for (let i = 0; i <= steps; i++) {
        const t = i / steps;                           // 0–1 progress
        const time = t * duration;

        // Horizontal: gentle drift right with slight S-curve
        const x = clamp01(
            0.3 + horizontalDrift * t
            + Math.sin(t * Math.PI * (1 + v)) * 0.04
        );

        // Vertical: parabolic arc (breach = upward, then gravity return)
        let y;
        if (t < breachPoint) {
            // Launch phase — accelerating upward (inverted y: 0=top)
            const phase = t / breachPoint;
            const eased = smoothstep(phase);
            y = 0.7 - eased * peakHeight;
        } else {
            // Descent — gravity with water resistance at re-entry
            const phase = (t - breachPoint) / (1 - breachPoint);
            // Quadratic gravity descent, decelerating at water surface
            const gravDescent = phase * phase * gravity;
            const waterResist = phase > 0.7 ? (phase - 0.7) * 0.3 : 0;
            y = (0.7 - peakHeight) + gravDescent * peakHeight - waterResist * 0.1;
        }

        // Add organic micro-drift (body rotation)
        y += Math.sin(t * Math.PI * 6 * (1 + v * 0.5)) * 0.01 * (1 - t);

        // Momentum intensity: peaks at breach, fades on descent
        const momentumIntensity = t < breachPoint
            ? smoothstep(t / breachPoint) * intensity
            : intensity * Math.max(1 - ((t - breachPoint) / (1 - breachPoint)) * 0.7, 0.2);

        path.push({
            x: clamp01(x),
            y: clamp01(y),
            t: time,
            intensity: clamp01(momentumIntensity),
        });
    }

    return path;
}

// ═══════════════════════════════════════════════════
//  WING — Figure-8 Lissajous with downstroke/upstroke
// ═══════════════════════════════════════════════════

/**
 * Wing beat: asymmetric figure-8 pattern (powerful downstroke, light upstroke).
 *
 * Physics: downstroke = fast + forceful, upstroke = slow + relaxed.
 * Duration: ~0.8s per cycle, repeats over total duration.
 * Phase variation per repeat for organic feel.
 *
 * @param {number} intensity   0–1 energy level
 * @param {number} duration    seconds (default 4, giving ~5 beats)
 * @param {number} [seed]      random seed
 * @returns {Array<{x:number, y:number, t:number, intensity:number}>}
 */
export function createWingBeatPath(intensity = 0.6, duration = 4, seed = 0) {
    const steps = Math.max(Math.round(duration * 40), 60);
    const path = [];
    const v = seededRandom(seed);

    const cycleTime = 0.8 + v * 0.3;                  // 0.8–1.1s per beat
    const amplitude = 0.12 + intensity * 0.18;         // wing span
    const asymmetry = 0.6 + intensity * 0.15;          // downstroke emphasis

    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const time = t * duration;

        // Which beat cycle are we in?
        const cycleProgress = (time / cycleTime) % 1;
        const cycle = Math.floor(time / cycleTime);

        // Phase variation per cycle for organic feel
        const phaseShift = seededRandom(seed + cycle * 7.3) * 0.4 - 0.2;

        // Lissajous figure-8: x=sin(θ), y=sin(2θ)
        const theta = (cycleProgress + phaseShift) * Math.PI * 2;

        // Asymmetric timing: downstroke occupies 40% of cycle, upstroke 60%
        let adjustedPhase;
        if (cycleProgress < 0.4) {
            // Downstroke — fast, forceful
            adjustedPhase = smoothstep(cycleProgress / 0.4) * 0.5;
        } else {
            // Upstroke — slower, lighter
            adjustedPhase = 0.5 + ((cycleProgress - 0.4) / 0.6) * 0.5;
        }
        const theta2 = adjustedPhase * Math.PI * 2;

        // Horizontal: figure-8 lateral sweep
        const x = clamp01(
            0.5 + Math.sin(theta2) * amplitude * (0.8 + v * 0.4)
            + cycle * 0.02  // slight progressive drift
        );

        // Vertical: figure-8 vertical + downstroke emphasis
        const rawY = Math.sin(theta2 * 2) * amplitude * asymmetry;
        const y = clamp01(
            0.5 - rawY  // inverted: downstroke goes down
            + Math.sin(t * Math.PI * 2) * 0.02  // subtle overall drift
        );

        // Intensity peaks on downstroke
        const beatIntensity = cycleProgress < 0.4
            ? intensity * (0.6 + smoothstep(cycleProgress / 0.4) * 0.4)
            : intensity * (0.3 + (1 - (cycleProgress - 0.4) / 0.6) * 0.3);

        path.push({
            x, y,
            t: time,
            intensity: clamp01(beatIntensity),
        });
    }

    return path;
}

// ═══════════════════════════════════════════════════
//  LEAF — Spiral descent with tumble + air resistance
// ═══════════════════════════════════════════════════

/**
 * Leaf fall: spiraling descent with tumble rotations and terminal velocity.
 *
 * Physics: gravity pull downward, air resistance creates terminal velocity,
 * tumble creates lateral oscillation with increasing frequency.
 * Duration: 6–10 seconds.
 *
 * @param {number} intensity   0–1 (affects tumble speed, descent rate)
 * @param {number} duration    seconds (default 8)
 * @param {number} [seed]      random seed
 * @returns {Array<{x:number, y:number, t:number, intensity:number}>}
 */
export function createLeafFallPath(intensity = 0.4, duration = 8, seed = 0) {
    const steps = Math.max(Math.round(duration * 30), 80);
    const path = [];
    const v = seededRandom(seed);

    const tumbleFreq = 1.5 + intensity * 2 + v * 1.5;   // tumble oscillations
    const lateralAmp = 0.1 + intensity * 0.12 + v * 0.05; // sway amplitude
    const startAngle = v * Math.PI * 2;                    // randomized initial rotation
    const terminalVelocity = 0.55 + intensity * 0.15;      // max descent speed

    // Start position: upper region with random horizontal offset
    const startX = 0.3 + v * 0.4;
    const startY = 0.05 + v * 0.1;

    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const time = t * duration;

        // Vertical: gravity with air resistance → terminal velocity
        // v(t) = vTerm * (1 - e^(-k*t)) — exponential approach to terminal
        const k = 2.5 + intensity;
        const velocityFrac = 1 - Math.exp(-k * t);
        const descent = velocityFrac * terminalVelocity * t;
        const y = clamp01(startY + descent);

        // Horizontal: tumbling sway with decaying amplitude
        const tumblePhase = startAngle + t * Math.PI * 2 * tumbleFreq;
        const decayingAmp = lateralAmp * (1 - t * 0.3);  // slightly smaller sway near ground
        const x = clamp01(
            startX
            + Math.sin(tumblePhase) * decayingAmp
            + Math.sin(tumblePhase * 2.3) * decayingAmp * 0.3  // secondary harmonic
        );

        // Intensity: bursts during tumble peaks, low during float
        const tumbleIntensity =
            0.1 + Math.abs(Math.sin(tumblePhase)) * intensity * 0.5
            + velocityFrac * 0.2;

        path.push({
            x, y,
            t: time,
            intensity: clamp01(tumbleIntensity),
        });
    }

    return path;
}

// ═══════════════════════════════════════════════════
//  FISH — S-curve body wave with sudden dart
// ═══════════════════════════════════════════════════

/**
 * Fish dart: sudden acceleration, S-curve body wave, sharp direction change.
 *
 * Physics: burst acceleration → glide → sudden turn → deceleration.
 * Duration: 2–4 seconds. Sharp and energetic.
 *
 * @param {number} intensity   0–1 (affects dart speed, turn sharpness)
 * @param {number} duration    seconds (default 3)
 * @param {number} [seed]      random seed
 * @returns {Array<{x:number, y:number, t:number, intensity:number}>}
 */
export function createFishDartPath(intensity = 0.8, duration = 3, seed = 0) {
    const steps = Math.max(Math.round(duration * 40), 60);
    const path = [];
    const v = seededRandom(seed);

    // Direction of dart (randomized)
    const dartAngle = v * Math.PI * 2;
    const turnPoint = 0.35 + v * 0.2;        // when the sharp turn happens
    const turnAngle = (v - 0.5) * Math.PI * 1.2;  // how sharp the turn is
    const dartSpeed = 0.2 + intensity * 0.25;

    // Body wave parameters
    const waveFreq = 6 + intensity * 4;        // tail oscillation frequency
    const waveAmp = 0.03 + intensity * 0.04;   // lateral body wave amplitude

    let posX = 0.3 + v * 0.4;
    let posY = 0.3 + seededRandom(seed + 1) * 0.4;
    let currentAngle = dartAngle;
    let speed = 0;

    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const time = t * duration;

        // Speed profile: burst → glide → burst at turn → decelerate
        if (t < 0.15) {
            // Initial burst — exponential acceleration
            speed = smoothstep(t / 0.15) * dartSpeed * intensity;
        } else if (t < turnPoint) {
            // Glide — gradual deceleration
            const glidePhase = (t - 0.15) / (turnPoint - 0.15);
            speed = dartSpeed * intensity * (1 - glidePhase * 0.4);
        } else if (t < turnPoint + 0.1) {
            // Turn burst — re-acceleration
            const turnPhase = (t - turnPoint) / 0.1;
            speed = dartSpeed * intensity * (0.6 + smoothstep(turnPhase) * 0.5);
            currentAngle = dartAngle + turnAngle * smoothstep(turnPhase);
        } else {
            // Final deceleration
            const endPhase = (t - turnPoint - 0.1) / (1 - turnPoint - 0.1);
            speed = dartSpeed * intensity * Math.max(1.1 - endPhase * 1.0, 0.05);
        }

        // S-curve body wave (perpendicular to travel direction)
        const wavePhase = t * Math.PI * 2 * waveFreq;
        const waveLateral = Math.sin(wavePhase) * waveAmp * (0.5 + speed * 2);
        const perpAngle = currentAngle + Math.PI / 2;

        // Advance position
        const dt = 1 / steps;
        posX += Math.cos(currentAngle) * speed * dt * 8
              + Math.cos(perpAngle) * waveLateral;
        posY += Math.sin(currentAngle) * speed * dt * 8
              + Math.sin(perpAngle) * waveLateral;

        // Intensity: high during bursts, low during glide
        const dartIntensity = speed / (dartSpeed * Math.max(intensity, 0.1));

        path.push({
            x: clamp01(posX),
            y: clamp01(posY),
            t: time,
            intensity: clamp01(dartIntensity),
        });
    }

    return path;
}

// ═══════════════════════════════════════════════════
//  ADDITIONAL MODELS — spiral, surge, cascade, ribbon
// ═══════════════════════════════════════════════════

/**
 * Spiral — tightening/loosening coil.
 */
export function createSpiralPath(intensity = 0.5, duration = 5, seed = 0) {
    const steps = Math.max(Math.round(duration * 30), 60);
    const path = [];
    const v = seededRandom(seed);

    const turns = 2 + intensity * 3 + v * 2;
    const maxR = 0.15 + intensity * 0.15;
    const tighten = v > 0.5;

    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const time = t * duration;
        const angle = t * Math.PI * 2 * turns + v * Math.PI;
        const r = tighten
            ? maxR * (1 - t * 0.7)
            : maxR * (0.3 + t * 0.7);

        const x = clamp01(0.5 + Math.cos(angle) * r);
        const y = clamp01(0.5 + Math.sin(angle) * r);

        path.push({
            x, y, t: time,
            intensity: clamp01((tighten ? 1 - t : t) * intensity),
        });
    }
    return path;
}

/**
 * Surge — explosive directional push.
 */
export function createSurgePath(intensity = 0.7, duration = 3, seed = 0) {
    const steps = Math.max(Math.round(duration * 35), 50);
    const path = [];
    const v = seededRandom(seed);

    const angle = v * Math.PI * 2;
    const reach = 0.2 + intensity * 0.25;

    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const time = t * duration;
        const eased = 1 - Math.exp(-t * (3 + intensity * 2));
        const wobble = Math.sin(t * Math.PI * (4 + v * 3)) * 0.02 * (1 - t);

        const x = clamp01(0.3 + Math.cos(angle) * eased * reach + wobble);
        const y = clamp01(0.5 + Math.sin(angle) * eased * reach + wobble * 0.7);

        path.push({
            x, y, t: time,
            intensity: clamp01(eased * intensity),
        });
    }
    return path;
}

/**
 * Cascade — gravity-driven waterfall descent.
 */
export function createCascadePath(intensity = 0.5, duration = 5, seed = 0) {
    const steps = Math.max(Math.round(duration * 30), 60);
    const path = [];
    const v = seededRandom(seed);

    const lateralDrift = (v - 0.5) * 0.3;

    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const time = t * duration;

        const x = clamp01(
            0.5 + lateralDrift * t + Math.sin(t * Math.PI * 3) * 0.06 * (1 - t * 0.5)
        );
        const y = clamp01(0.1 + t * t * 0.7);  // quadratic descent

        path.push({
            x, y, t: time,
            intensity: clamp01(t * t * intensity + 0.1),
        });
    }
    return path;
}

/**
 * Ribbon — flowing S-curve.
 */
export function createRibbonPath(intensity = 0.5, duration = 5, seed = 0) {
    const steps = Math.max(Math.round(duration * 30), 60);
    const path = [];
    const v = seededRandom(seed);

    const freq = 1.5 + v * 2;
    const amp = 0.12 + intensity * 0.1;

    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const time = t * duration;

        const x = clamp01(0.15 + t * 0.7);
        const y = clamp01(
            0.5 + Math.sin(t * Math.PI * freq * 2) * amp
            + Math.cos(t * Math.PI * freq * 0.7) * amp * 0.3
        );

        path.push({
            x, y, t: time,
            intensity: clamp01(
                0.2 + Math.abs(Math.sin(t * Math.PI * freq)) * intensity * 0.6
            ),
        });
    }
    return path;
}

// ═══════════════════════════════════════════════════
//  REGISTRY — maps vocabulary name to generator
// ═══════════════════════════════════════════════════

/**
 * Master registry: vocabulary name → generator function.
 * Each generator: (intensity, duration, seed) → [{x,y,t,intensity}]
 */
export const BIOMECHANICAL_MODELS = {
    whale:    createWhaleBreachPath,
    wing:     createWingBeatPath,
    leaf:     createLeafFallPath,
    fish:     createFishDartPath,
    spiral:   createSpiralPath,
    surge:    createSurgePath,
    cascade:  createCascadePath,
    ribbon:   createRibbonPath,
    // Vocabularies without dedicated models fall back to a generic wave
    bloom:    (i, d, s) => createSpiralPath(i, d, s),      // reuse spiral
    pendulum: (i, d, s) => createRibbonPath(i, d, s),      // reuse ribbon
    scatter:  (i, d, s) => createSurgePath(i, d, s),       // reuse surge
    crackle:  (i, d, s) => createFishDartPath(i, d, s),    // reuse fish
};

/**
 * Generate a biomechanical path for a vocabulary.
 * Returns a normalized path with metadata.
 *
 * @param {string} vocabulary
 * @param {number} intensity   0–1
 * @param {number} duration    seconds
 * @param {number} [seed]      random seed for variation
 * @returns {{source: string, vocabulary: string, name: string, path: Array, metadata: Object}}
 */
export function generateBiomechanicalGesture(vocabulary, intensity = 0.5, duration = 6, seed = Math.random() * 999) {
    const gen = BIOMECHANICAL_MODELS[vocabulary];
    if (!gen) {
        console.warn(`[BioModels] No model for "${vocabulary}", using leaf fallback`);
        return generateBiomechanicalGesture('leaf', intensity, duration, seed);
    }

    const path = gen(intensity, duration, seed);

    return {
        source: 'biomechanical',
        vocabulary,
        name: `${vocabulary}_bio`,
        path,
        duration: path.length > 0 ? path[path.length - 1].t : duration,
        metadata: {
            duration,
            intensity_range: [Math.max(intensity - 0.2, 0), Math.min(intensity + 0.2, 1)],
            description: `Biomechanical ${vocabulary} model (intensity=${intensity.toFixed(2)})`,
            pointCount: path.length,
            seed,
        },
    };
}
