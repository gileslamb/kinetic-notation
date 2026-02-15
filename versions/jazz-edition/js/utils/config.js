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
};

// Freeze top-level to prevent accidental mutation
Object.freeze(Config);

export default Config;
