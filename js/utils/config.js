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
        maxPixelRatio: 2,           // cap for retina; keeps GPU happy
        targetFPS: 60,
    },

    // ---- Audio Analysis ----
    audio: {
        fftSize: 2048,              // frequency bins (power of 2)
        smoothingTimeConstant: 0.8, // 0–1, higher = smoother
        minDecibels: -90,
        maxDecibels: -10,
    },

    // ---- Movement ----
    movement: {
        baseSpeed: 1.0,
        dampingFactor: 0.92,        // organic deceleration
        noiseScale: 0.003,          // Perlin noise spatial frequency
        noiseSpeed: 0.002,          // Perlin noise time frequency
    },

    // ---- Trace Rendering ----
    trace: {
        maxPoints: 2000,            // per trace before pruning
        defaultLineWidth: 2,
        maxLineWidth: 12,
        fadeRate: 0.015,            // alpha decay per frame (0–1)
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
        enableMotionBlur: false,    // Sprint 5+
        enableBVH: false,           // Sprint 6+
    },
};

// Freeze top-level to prevent accidental mutation
Object.freeze(Config);

export default Config;
