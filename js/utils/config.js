/**
 * Kinetic Notation — Central Configuration
 * 
 * All tunable constants and default values live here.
 * Modules import what they need; nothing is hard-coded elsewhere.
 */

const Config = {
    // ---- Canvas ----
    canvas: {
        backgroundColor: '#0a0a0f',
        maxPixelRatio: 2,
        targetFPS: 60,
    },

    // ---- Audio Analysis ----
    audio: {
        fftSize: 1024,              // ↓ from 2048 — halves latency (~23ms → ~12ms at 44.1kHz)
        smoothingTimeConstant: 0.6, // ↓ from 0.8 — faster response, less averaging
        minDecibels: -85,           // ↑ from -90 — slightly more sensitive
        maxDecibels: -10,
    },

    // ---- MIDI / MPE ----
    midi: {
        enabled: false,             // toggled by UI
        mpeMode: true,              // true = MPE (ch 2-16 per-note), false = omni
        masterChannel: 0,           // MIDI channel 1 (0-indexed) — MPE master
        noteRange: [21, 108],       // A0 – C8 (piano range)
        velocityCurve: 'linear',    // 'linear' | 'exponential' | 'logarithmic'
        pitchBendRange: 48,         // semitones (MPE default)
    },

    // ---- Movement ----
    movement: {
        baseSpeed: 1.0,
        dampingFactor: 0.92,
        noiseScale: 0.003,
        noiseSpeed: 0.002,
    },

    // ---- Trace Rendering ----
    trace: {
        maxPoints: 2000,
        defaultLineWidth: 2,
        maxLineWidth: 12,
        fadeRate: 0.015,
        glowBlur: 20,
    },

    // ---- Color Presets ----
    presets: {
        ember: {
            name: 'Ember',
            background: '#0a0a0f',
            colors: ['#ff6b3d', '#ff9f6b', '#ffd093'],
            glowColor: 'rgba(255, 107, 61, 0.3)',
        },
        ocean: {
            name: 'Ocean',
            background: '#060c14',
            colors: ['#3d9eff', '#6bb8ff', '#93d4ff'],
            glowColor: 'rgba(61, 158, 255, 0.3)',
        },
        forest: {
            name: 'Forest',
            background: '#080f0a',
            colors: ['#3dff6b', '#6bff9f', '#93ffd0'],
            glowColor: 'rgba(61, 255, 107, 0.3)',
        },
        void: {
            name: 'Void',
            background: '#08080f',
            colors: ['#a855f7', '#c084fc', '#e9d5ff'],
            glowColor: 'rgba(168, 85, 247, 0.3)',
        },
    },

    // ---- UI Defaults ----
    ui: {
        sensitivity: 50,
        speed: 50,
        trailFade: 70,
        lineWeight: 30,
        defaultPreset: 'ember',
    },

    // ---- Feature Flags ----
    features: {
        showFPS: true,
        enableGlow: true,
        enableMotionBlur: false,
        enableBVH: false,
    },

    // ---- Visual Modes ----
    // Each mode overrides clip/render behaviour for a distinct aesthetic.
    // Applied at runtime by App._applyVisualMode().
    visualModes: {
        jazz: {
            name: 'Jazz',
            description: 'Cubist overlapping strokes — the original aesthetic',
            maxConcurrent: 5,
            clipCooldown: 0.12,
            sustainPingPong: true,       // loop middle 40% of gesture
            sustainDriftScale: 5,        // px multiplier for positional wander
            sustainBreathing: 0.05,      // ±5% scale oscillation
            sustainBlendTime: 0.4,       // seconds to blend into loop
            sustainEntryThreshold: 0.85, // MIDI clips enter sustain here
            trailFadeRange: [0.005, 0.12],
            enableGlow: true,
            lineWidthRange: [2, 12],
        },
        organic: {
            name: 'Organic Flow',
            description: 'Meditative fluid motion — slow, gentle, hypnotic',
            maxConcurrent: 3,            // sparse — breathing room between gestures
            clipCooldown: 2.0,           // 2 seconds minimum between new gestures
            sustainPingPong: false,      // forward-flowing sustain, no retrace
            sustainDriftScale: 0,        // drift handled by Perlin instead
            sustainBreathing: 0.015,     // very subtle ±1.5% breathing
            sustainBlendTime: 1.5,       // slow, gentle blend into sustain loop
            sustainEntryThreshold: 0.92, // late entry — let gestures unfold longer
            trailFadeRange: [0.008, 0.04],   // Gentle fade — trails persist ~5-10s, prevents clustering
            enableGlow: true,
            lineWidthRange: [1.5, 7],    // medium weight, not bold
            // ── Organic-specific ──
            usePhysics: true,            // apply vocabulary physics modifiers
            usePerlinDrift: true,        // replace sine drift with Perlin noise
            renderMode: 'organic',       // smooth Bézier splines, gradient alpha
            trailGradientLength: 800,    // long gradient tail for flowing look
            bridgeClips: false,          // NO inter-clip connections — standalone arcs
            // ── Meditative tuning ──
            durationMultiplier: 3.5,     // gesture templates run 3.5x slower (2s→7s, 4s→14s)
            physicsTimeScale: 0.12,      // noise evolves at 12% speed — glacial drift
            physicsAmpScale: 0.2,        // noise amplitude at 20% — subtle wobble, not jitter
            easingOverride: 'sine',      // override all easing to gentle sine (no elastic/bouncy)
            pathTScale: 0.45,            // use only first 45% of template cycle → OPEN arcs, no loop-back
        },
        cinematic: {
            name: 'Cinematic',
            description: 'Long flowing arcs — slow, dramatic, filmic',
            maxConcurrent: 3,
            clipCooldown: 0.3,
            sustainPingPong: false,      // sustain extends forward (no retrace)
            sustainDriftScale: 2,
            sustainBreathing: 0.02,
            sustainBlendTime: 0.8,
            sustainEntryThreshold: 0.95,
            trailFadeRange: [0.002, 0.04],
            enableGlow: true,
            lineWidthRange: [1, 8],
        },
        minimal: {
            name: 'Minimal',
            description: 'Clean single strokes — no sustain, fast fade',
            maxConcurrent: 2,
            clipCooldown: 0.25,
            sustainPingPong: false,
            sustainDriftScale: 0,
            sustainBreathing: 0,
            sustainBlendTime: 0,
            sustainEntryThreshold: 1.1,  // > 1.0 = never sustain
            trailFadeRange: [0.03, 0.2],
            enableGlow: false,
            lineWidthRange: [1, 4],
        },
    },

    // ---- Default Visual Mode ----
    defaultVisualMode: 'jazz',
};

// Freeze top-level to prevent accidental mutation
Object.freeze(Config);

export default Config;
