/**
 * Kinetic Notation — Main Application Controller
 * 
 * Initializes all modules, wires up UI controls,
 * and runs the core animation loop.
 */

import Config from './utils/config.js';
import { clamp, mapRange, normalize } from './utils/helpers.js';
import canvasManager from './visualization/canvas.js';
// Future imports — uncomment as modules are built:
// import audioAnalyzer from './audio/audioAnalyzer.js';
// import { extractFeatures } from './audio/featureExtraction.js';
// import { mapParameters } from './audio/parameterMapping.js';
// import traceRenderer from './visualization/traceRenderer.js';
// import effects from './visualization/effects.js';
// import { getMotion } from './movement/movementVocabulary.js';

class App {
    constructor() {
        // State
        this.isRunning = false;
        this.isPaused = false;
        this.animationId = null;
        this.lastFrameTime = 0;
        this.frameCount = 0;
        this.fps = 0;
        this.fpsUpdateInterval = 500; // ms between FPS display updates
        this.lastFPSUpdate = 0;

        // Parameters (from UI sliders, normalized 0–1)
        this.params = {
            sensitivity: Config.ui.sensitivity / 100,
            speed: Config.ui.speed / 100,
            trailFade: Config.ui.trailFade / 100,
            lineWeight: Config.ui.lineWeight / 100,
        };

        this.activePreset = Config.ui.defaultPreset;

        // Demo trace state (Sprint 1 visual proof-of-life)
        this.demoTrace = {
            points: [],
            angle: 0,
            radius: 0,
            time: 0,
        };

        // DOM references
        this.dom = {};
    }

    /**
     * Boot the application.
     */
    init() {
        this._cacheDOMRefs();
        canvasManager.init('kinetic-canvas');
        this._bindEvents();
        this._applyPreset(this.activePreset);
        this._updateStatus('Ready');

        // Initial clear
        canvasManager.clear();

        // Draw a subtle "ready" indicator
        this._drawIdleState();

        console.log('%c✦ Kinetic Notation initialized', 'color: #ff6b3d; font-weight: bold;');
    }

    // ── DOM ─────────────────────────────────────────

    _cacheDOMRefs() {
        this.dom = {
            btnStart: document.getElementById('btn-start'),
            btnPause: document.getElementById('btn-pause'),
            btnClear: document.getElementById('btn-clear'),
            btnTogglePanel: document.getElementById('btn-toggle-panel'),
            btnMic: document.getElementById('btn-mic'),
            btnFile: document.getElementById('btn-file'),
            audioFileInput: document.getElementById('audio-file-input'),
            controlPanel: document.getElementById('control-panel'),
            statusText: document.getElementById('status-text'),
            fpsCounter: document.getElementById('fps-counter'),
            sliderSensitivity: document.getElementById('slider-sensitivity'),
            sliderSpeed: document.getElementById('slider-speed'),
            sliderTrailFade: document.getElementById('slider-trail-fade'),
            sliderLineWeight: document.getElementById('slider-line-weight'),
            valSensitivity: document.getElementById('val-sensitivity'),
            valSpeed: document.getElementById('val-speed'),
            valTrailFade: document.getElementById('val-trail-fade'),
            valLineWeight: document.getElementById('val-line-weight'),
            presetButtons: document.querySelectorAll('.btn-preset'),
        };
    }

    // ── Events ──────────────────────────────────────

    _bindEvents() {
        // Transport
        this.dom.btnStart.addEventListener('click', () => this._toggleStart());
        this.dom.btnPause.addEventListener('click', () => this._togglePause());
        this.dom.btnClear.addEventListener('click', () => this._clear());

        // Panel collapse
        this.dom.btnTogglePanel.addEventListener('click', () => {
            this.dom.controlPanel.classList.toggle('collapsed');
        });

        // Audio source
        this.dom.btnMic.addEventListener('click', () => this._setSource('mic'));
        this.dom.btnFile.addEventListener('click', () => this._setSource('file'));
        this.dom.audioFileInput.addEventListener('change', (e) => this._handleFileSelect(e));

        // Sliders
        this._bindSlider('sliderSensitivity', 'valSensitivity', 'sensitivity');
        this._bindSlider('sliderSpeed', 'valSpeed', 'speed');
        this._bindSlider('sliderTrailFade', 'valTrailFade', 'trailFade');
        this._bindSlider('sliderLineWeight', 'valLineWeight', 'lineWeight');

        // Presets
        this.dom.presetButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const preset = btn.dataset.preset;
                this.dom.presetButtons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this._applyPreset(preset);
            });
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => this._handleKeydown(e));
    }

    _bindSlider(sliderId, valueId, paramName) {
        const slider = this.dom[sliderId];
        const display = this.dom[valueId];
        slider.addEventListener('input', () => {
            const raw = parseInt(slider.value, 10);
            display.textContent = raw;
            this.params[paramName] = raw / 100;
        });
    }

    _handleKeydown(e) {
        // Ignore if user is typing in an input
        if (e.target.tagName === 'INPUT') return;

        switch (e.code) {
            case 'Space':
                e.preventDefault();
                if (this.isRunning) this._togglePause();
                else this._toggleStart();
                break;
            case 'KeyC':
                this._clear();
                break;
            case 'KeyH':
                this.dom.controlPanel.classList.toggle('collapsed');
                break;
        }
    }

    // ── Transport Controls ──────────────────────────

    _toggleStart() {
        if (this.isRunning) {
            this._stop();
        } else {
            this._start();
        }
    }

    _start() {
        this.isRunning = true;
        this.isPaused = false;
        this.lastFrameTime = performance.now();

        this.dom.btnStart.textContent = 'Stop';
        this.dom.btnStart.classList.add('active');
        this.dom.btnPause.disabled = false;
        document.body.classList.add('listening');

        this._updateStatus('Listening');
        this._loop();
    }

    _stop() {
        this.isRunning = false;
        this.isPaused = false;

        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }

        this.dom.btnStart.textContent = 'Start';
        this.dom.btnStart.classList.remove('active');
        this.dom.btnPause.disabled = true;
        this.dom.btnPause.textContent = 'Pause';
        document.body.classList.remove('listening');

        this._updateStatus('Stopped');
    }

    _togglePause() {
        this.isPaused = !this.isPaused;
        this.dom.btnPause.textContent = this.isPaused ? 'Resume' : 'Pause';
        this._updateStatus(this.isPaused ? 'Paused' : 'Listening');

        if (!this.isPaused) {
            this.lastFrameTime = performance.now();
        }
    }

    _clear() {
        this.demoTrace.points = [];
        this.demoTrace.time = 0;
        canvasManager.clear();
        if (!this.isRunning) {
            this._drawIdleState();
        }
    }

    _setSource(source) {
        this.dom.btnMic.classList.toggle('active', source === 'mic');
        this.dom.btnFile.classList.toggle('active', source === 'file');
        if (source === 'file') {
            this.dom.audioFileInput.click();
        }
    }

    _handleFileSelect(e) {
        const file = e.target.files[0];
        if (file) {
            this._updateStatus(`File: ${file.name}`);
            // Audio file handling will be implemented in Sprint 2
        }
    }

    // ── Presets ─────────────────────────────────────

    _applyPreset(presetName) {
        const preset = Config.presets[presetName];
        if (!preset) return;

        this.activePreset = presetName;

        // Update CSS custom properties for live theme switching
        const root = document.documentElement;
        root.style.setProperty('--bg-primary', preset.background);
        root.style.setProperty('--trace-color-1', preset.colors[0]);
        root.style.setProperty('--trace-color-2', preset.colors[1]);
        root.style.setProperty('--trace-color-3', preset.colors[2]);
        root.style.setProperty('--accent-primary', preset.colors[0]);
        root.style.setProperty('--accent-glow', preset.glowColor);

        // Update canvas background
        if (canvasManager.ctx) {
            canvasManager.clear(preset.background);
        }
    }

    // ── Status ──────────────────────────────────────

    _updateStatus(text) {
        this.dom.statusText.textContent = text;
    }

    _updateFPS(now) {
        this.frameCount++;
        if (now - this.lastFPSUpdate >= this.fpsUpdateInterval) {
            this.fps = Math.round((this.frameCount * 1000) / (now - this.lastFPSUpdate));
            this.dom.fpsCounter.textContent = `${this.fps} fps`;
            this.frameCount = 0;
            this.lastFPSUpdate = now;
        }
    }

    // ── Idle State ──────────────────────────────────

    _drawIdleState() {
        const { ctx, width, height, center } = canvasManager;
        const preset = Config.presets[this.activePreset];

        // Subtle center circle
        ctx.beginPath();
        ctx.arc(center.x, center.y, 40, 0, Math.PI * 2);
        ctx.strokeStyle = preset.colors[0] + '20'; // very faint
        ctx.lineWidth = 1;
        ctx.stroke();

        // Instruction text
        ctx.font = '13px -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.fillStyle = preset.colors[0] + '40';
        ctx.textAlign = 'center';
        ctx.fillText('Press Start or Space to begin', center.x, center.y + 70);
        ctx.textAlign = 'left'; // reset
    }

    // ── Main Loop ───────────────────────────────────

    _loop() {
        if (!this.isRunning) return;

        const now = performance.now();
        const deltaTime = (now - this.lastFrameTime) / 1000; // seconds
        this.lastFrameTime = now;

        this._updateFPS(now);

        if (!this.isPaused) {
            this._update(deltaTime);
            this._draw();
        }

        this.animationId = requestAnimationFrame(() => this._loop());
    }

    /**
     * Update state — called every frame while not paused.
     * Sprint 1: demo organic motion using Lissajous + noise.
     * Sprint 2+: real audio-driven updates.
     */
    _update(dt) {
        const trace = this.demoTrace;
        const speed = this.params.speed * 2;
        const sensitivity = this.params.sensitivity;

        trace.time += dt * speed;

        // Organic Lissajous-like motion
        const cx = canvasManager.center.x;
        const cy = canvasManager.center.y;
        const maxRadius = Math.min(canvasManager.width, canvasManager.height) * 0.35;

        const t = trace.time;
        const x = cx + Math.sin(t * 0.7) * maxRadius * sensitivity
                     + Math.sin(t * 1.9) * maxRadius * 0.3 * sensitivity
                     + Math.cos(t * 3.1) * maxRadius * 0.1;
        const y = cy + Math.cos(t * 0.5) * maxRadius * sensitivity * 0.8
                     + Math.sin(t * 1.3) * maxRadius * 0.25 * sensitivity
                     + Math.sin(t * 2.7) * maxRadius * 0.15;

        trace.points.push({ x, y, alpha: 1.0 });

        // Prune old points
        if (trace.points.length > Config.trace.maxPoints) {
            trace.points.shift();
        }
    }

    /**
     * Draw frame — called every frame while not paused.
     */
    _draw() {
        const { ctx, width, height } = canvasManager;
        const preset = Config.presets[this.activePreset];
        const fadeRate = mapRange(this.params.trailFade, 0, 1, 0.005, 0.12);
        const lineWeight = mapRange(this.params.lineWeight, 0, 1,
            Config.trace.defaultLineWidth, Config.trace.maxLineWidth);

        // Fade previous frame
        canvasManager.fade(fadeRate);

        const points = this.demoTrace.points;
        if (points.length < 2) return;

        // Draw trace with gradient along the path
        ctx.lineWidth = lineWeight;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        // Draw in segments for color/alpha variation
        for (let i = 1; i < points.length; i++) {
            const prev = points[i - 1];
            const curr = points[i];

            // Progress along the trace (0 = oldest, 1 = newest)
            const progress = i / points.length;

            // Interpolate color through the preset palette
            const colorIndex = progress * (preset.colors.length - 1);
            const ci = Math.floor(colorIndex);
            const cf = colorIndex - ci;
            const c1 = preset.colors[Math.min(ci, preset.colors.length - 1)];
            const c2 = preset.colors[Math.min(ci + 1, preset.colors.length - 1)];

            // Alpha: fade out older segments
            const alpha = clamp(progress * 1.5, 0.05, 1.0);

            ctx.beginPath();
            ctx.moveTo(prev.x, prev.y);

            // Use quadratic curve through midpoints for smoothness
            if (i < points.length - 1) {
                const next = points[i + 1];
                const mx = (curr.x + next.x) / 2;
                const my = (curr.y + next.y) / 2;
                ctx.quadraticCurveTo(curr.x, curr.y, mx, my);
            } else {
                ctx.lineTo(curr.x, curr.y);
            }

            ctx.strokeStyle = this._hexWithAlpha(c1, alpha);
            ctx.lineWidth = lineWeight * (0.5 + progress * 0.5);
            ctx.stroke();
        }

        // Glow effect on the leading point
        if (Config.features.enableGlow && points.length > 0) {
            const tip = points[points.length - 1];
            ctx.save();
            ctx.shadowColor = preset.glowColor;
            ctx.shadowBlur = Config.trace.glowBlur;
            ctx.beginPath();
            ctx.arc(tip.x, tip.y, lineWeight * 0.5, 0, Math.PI * 2);
            ctx.fillStyle = preset.colors[0];
            ctx.fill();
            ctx.restore();
        }
    }

    /**
     * Append alpha (0–1) to a hex color string.
     * @param {string} hex - e.g. '#ff6b3d'
     * @param {number} alpha - 0–1
     * @returns {string} rgba string
     */
    _hexWithAlpha(hex, alpha) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
}

// ── Bootstrap ───────────────────────────────────────

const app = new App();

document.addEventListener('DOMContentLoaded', () => {
    app.init();
});

export default app;
