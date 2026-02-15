/**
 * Kinetic Notation — Mode Manager
 *
 * Routes between two fundamentally different rendering architectures:
 *   DISCRETE  — gesture clips (Jazz, Organic) — clipManager + traceRenderer
 *   CONTINUOUS — flowing line (Flow, Minimal) — continuousLine
 *
 * Each mode defines its renderer type, canvas fade rate, and settings.
 * The App reads modeManager.current to decide which update/draw path to run.
 */

const MODES = {
    jazz: {
        name: 'Jazz',
        description: 'Cubist strokes — building left to right',
        renderer: 'discrete',
        canvasFade: 0.04,
        canvasScroll: 0.5,         // px/frame trail drift (subtle)
        gestureStep: 50,           // px jump per gesture — ~38 gestures to fill 1920px
        visualMode: 'jazz',
    },
    organic: {
        name: 'Organic',
        description: 'Meditative flowing arcs — gentle drift',
        renderer: 'discrete',
        canvasFade: 0.012,
        canvasScroll: 0.2,         // very gentle trail drift
        gestureStep: 80,           // wider spacing — sparser, ~24 gestures to fill
        visualMode: 'organic',
    },
    flow: {
        name: 'Flow',
        description: 'Continuous seismograph line',
        renderer: 'continuous',
        canvasFade: 0.02,
        settings: {
            velocity: 2,
            smoothing: 0.15,
            maxPathLength: 1500,
            fadeTime: 3.0,
            verticalRange: 0.7,
        },
    },
    minimal: {
        name: 'Minimal',
        description: 'Sparse continuous trace',
        renderer: 'continuous',
        canvasFade: 0.04,
        settings: {
            velocity: 1.5,
            smoothing: 0.08,
            maxPathLength: 800,
            fadeTime: 2.0,
            verticalRange: 0.5,
        },
    },
};

class ModeManager {
    constructor() {
        /** @type {string} */
        this.currentKey = 'flow';  // default mode

        /** Callbacks fired on mode change */
        this.onChange = null;
    }

    /** @returns {Object} current mode definition */
    get current() {
        return MODES[this.currentKey];
    }

    /** @returns {string} 'discrete' or 'continuous' */
    get rendererType() {
        return this.current.renderer;
    }

    /** @returns {boolean} */
    isDiscrete() {
        return this.rendererType === 'discrete';
    }

    /** @returns {boolean} */
    isContinuous() {
        return this.rendererType === 'continuous';
    }

    /**
     * Switch mode.
     * @param {string} key  'jazz' | 'organic' | 'flow' | 'minimal'
     * @returns {boolean} true if mode changed
     */
    setMode(key) {
        if (!MODES[key] || key === this.currentKey) return false;
        const prev = this.currentKey;
        this.currentKey = key;
        console.log(
            `%c[Mode] ${MODES[key].name}: ${MODES[key].description} (${MODES[key].renderer})`,
            'color: #6bff9f; font-weight: bold;'
        );
        if (this.onChange) this.onChange(key, prev);
        return true;
    }

    /** Get all available modes for UI. */
    getAll() {
        return Object.entries(MODES).map(([key, mode]) => ({
            key,
            name: mode.name,
            description: mode.description,
            renderer: mode.renderer,
        }));
    }
}

const modeManager = new ModeManager();
export default modeManager;
export { MODES };
