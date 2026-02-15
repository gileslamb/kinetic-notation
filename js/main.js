/**
 * Kinetic Notation — Main Application Controller (v3 — Dual Renderer)
 *
 * TWO RENDERING ARCHITECTURES:
 *   DISCRETE  (Jazz, Organic) — clipManager + traceRenderer
 *   CONTINUOUS (Flow, Minimal) — continuousLine
 *
 * ModeManager routes between them. Both share the same audio/MIDI pipeline.
 *
 * INPUT MODES:
 *   'audio'  — Microphone → FFT → features
 *   'midi'   — MIDI notes → direct triggering
 *   'mpe'    — MPE per-note expression
 *   'hybrid' — MIDI timing + audio spectral
 */

import Config from './utils/config.js';
import { clamp, mapRange } from './utils/helpers.js';
import canvasManager from './visualization/canvas.js';
import audioAnalyzer from './audio/audioAnalyzer.js';
import { extractFeatures, detectPhrase } from './audio/featureExtraction.js';

// ── Discrete renderer (Jazz, Organic) ──
import { ClipQueue } from './core/clipManager.js';
import { createGestureClip, createMidiClip } from './movement/blendingEngine.js';
import traceRenderer from './visualization/traceRenderer.js';

// ── Continuous renderer (Flow, Minimal) ──
import { ContinuousLine } from './visualization/continuousLine.js';

// ── Mode routing ──
import modeManager, { MODES } from './core/modeManager.js';

// ── Video Motion Extraction ──
import { MotionImportPanel } from './tools/videoMotionExtractor.js';
import { loadGestureFromData } from './movement/naturalMotions.js';

import midiManager from './input/midiManager.js';

class App {
    constructor() {
        // ── State ──
        this.isRunning = false;
        this.isPaused = false;
        this.animationId = null;
        this.lastFrameTime = 0;
        this.frameCount = 0;
        this.fps = 0;
        this.fpsUpdateInterval = 500;
        this.lastFPSUpdate = 0;

        // ── Input mode ──
        this.inputMode = 'audio';
        this.audioReady = false;
        this.midiReady = false;
        this.audioFeatures = null;

        // ── Discrete renderer state ──
        this.clipQueue = new ClipQueue(5);
        this._continuousFrames = 0;
        this._silentFrames = 0;
        this._wasContinuous = false;

        // ── Continuous renderer state ──
        this.primaryLine = null;  // created in init() after canvas ready

        // ── UI params ──
        this.params = {
            sensitivity: Config.ui.sensitivity / 100,
            speed: Config.ui.speed / 100,
            trailFade: Config.ui.trailFade / 100,
            lineWeight: Config.ui.lineWeight / 100,
        };

        this.activePreset = Config.ui.defaultPreset;

        // ── Demo trace ──
        this.demoTrace = { points: [], time: 0 };

        this.dom = {};
    }

    // ══════════════════════════════════════════════════
    //  INIT
    // ══════════════════════════════════════════════════

    init() {
        this._cacheDOMRefs();
        canvasManager.init('kinetic-canvas');
        this._bindEvents();
        this._applyPreset(this.activePreset);

        // Create continuous line renderer
        this.primaryLine = new ContinuousLine(canvasManager);
        this.primaryLine.reset();

        // Apply default mode
        this._switchMode(modeManager.currentKey);

        this._updateStatus('Ready');
        canvasManager.clear();
        this._drawIdleState();
        this._initMidi();

        // Mode change callback
        modeManager.onChange = (newKey, prevKey) => this._onModeChange(newKey, prevKey);

        // Initialize Motion Import panel
        try {
            this.motionImportPanel = new MotionImportPanel({
                onGestureLoaded: (gesture) => {
                    const ok = loadGestureFromData(gesture);
                    if (ok) {
                        console.log(`%c[App] Gesture "${gesture.name}" loaded into ${gesture.vocabulary}`, 'color: #6bff9f;');
                    }
                },
            });
            this.motionImportPanel.init();
            // Expose globally for fallback save handler
            window.__motionPanel = this.motionImportPanel;
        } catch (err) {
            console.error('[App] MotionImportPanel init failed:', err);
        }

        console.log('%c✦ Kinetic Notation v3 (Dual Renderer + Motion Import)', 'color: #ff6b3d; font-weight: bold;');
    }

    async _initMidi() {
        if (!midiManager.isSupported) return;
        const ok = await midiManager.init();
        if (!ok) return;
        this._populateMidiDevices();
        midiManager.onNoteOn = (note) => this._handleMidiNoteOn(note);
        midiManager.onNoteOff = (note) => this._handleMidiNoteOff(note);
        midiManager.onDeviceChange = () => this._populateMidiDevices();
        if (midiManager.inputs.length > 0) {
            midiManager.autoConnect();
            this.midiReady = true;
            if (this.dom.midiStatus) this.dom.midiStatus.textContent = midiManager.inputs[0].name;
        }
    }

    // ── DOM ──────────────────────────────────────────

    _cacheDOMRefs() {
        this.dom = {
            btnStart:         document.getElementById('btn-start'),
            btnPause:         document.getElementById('btn-pause'),
            btnClear:         document.getElementById('btn-clear'),
            btnTogglePanel:   document.getElementById('btn-toggle-panel'),
            btnMic:           document.getElementById('btn-mic'),
            btnFile:          document.getElementById('btn-file'),
            btnMidi:          document.getElementById('btn-midi'),
            btnMpe:           document.getElementById('btn-mpe'),
            btnHybrid:        document.getElementById('btn-hybrid'),
            audioFileInput:   document.getElementById('audio-file-input'),
            midiDeviceSelect: document.getElementById('midi-device-select'),
            midiStatus:       document.getElementById('midi-status'),
            controlPanel:     document.getElementById('control-panel'),
            statusText:       document.getElementById('status-text'),
            fpsCounter:       document.getElementById('fps-counter'),
            sliderSensitivity: document.getElementById('slider-sensitivity'),
            sliderSpeed:       document.getElementById('slider-speed'),
            sliderTrailFade:   document.getElementById('slider-trail-fade'),
            sliderLineWeight:  document.getElementById('slider-line-weight'),
            valSensitivity:    document.getElementById('val-sensitivity'),
            valSpeed:          document.getElementById('val-speed'),
            valTrailFade:      document.getElementById('val-trail-fade'),
            valLineWeight:     document.getElementById('val-line-weight'),
            presetButtons:     document.querySelectorAll('.btn-preset'),
            modeButtons:       document.querySelectorAll('.btn-mode'),
            modeInfo:          document.getElementById('mode-info'),
        };
    }

    // ── Events ──────────────────────────────────────

    _bindEvents() {
        this.dom.btnStart.addEventListener('click', () => this._toggleStart());
        this.dom.btnPause.addEventListener('click', () => this._togglePause());
        this.dom.btnClear.addEventListener('click', () => this._clear());

        this.dom.btnTogglePanel.addEventListener('click', () => {
            this.dom.controlPanel.classList.toggle('collapsed');
        });

        // Input source buttons
        this.dom.btnMic.addEventListener('click', () => this._setInputMode('audio'));
        this.dom.btnFile.addEventListener('click', () => {
            console.log('[File] Opening file picker…');
            this.dom.audioFileInput.click();
        });
        if (this.dom.btnMidi) this.dom.btnMidi.addEventListener('click', () => this._setInputMode('midi'));
        if (this.dom.btnMpe) this.dom.btnMpe.addEventListener('click', () => this._setInputMode('mpe'));
        if (this.dom.btnHybrid) this.dom.btnHybrid.addEventListener('click', () => this._setInputMode('hybrid'));

        this.dom.audioFileInput.addEventListener('change', (e) => this._handleFileSelect(e));

        // MIDI device selection
        if (this.dom.midiDeviceSelect) {
            this.dom.midiDeviceSelect.addEventListener('change', (e) => {
                const id = e.target.value;
                if (id && midiManager.selectInput(id)) {
                    this.midiReady = true;
                    if (this.dom.midiStatus) this.dom.midiStatus.textContent = 'Connected';
                }
            });
        }

        this._bindSlider('sliderSensitivity', 'valSensitivity', 'sensitivity');
        this._bindSlider('sliderSpeed', 'valSpeed', 'speed');
        this._bindSlider('sliderTrailFade', 'valTrailFade', 'trailFade');
        this._bindSlider('sliderLineWeight', 'valLineWeight', 'lineWeight');

        this.dom.presetButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const preset = btn.dataset.preset;
                this.dom.presetButtons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this._applyPreset(preset);
            });
        });

        // ── Mode selector buttons ──
        this.dom.modeButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const key = btn.dataset.mode;
                if (key) this._switchMode(key);
            });
        });

        document.addEventListener('keydown', (e) => this._handleKeydown(e));
    }

    _bindSlider(sliderId, valueId, paramName) {
        const slider = this.dom[sliderId];
        const display = this.dom[valueId];
        if (!slider || !display) return;
        slider.addEventListener('input', () => {
            const raw = parseInt(slider.value, 10);
            display.textContent = raw;
            this.params[paramName] = raw / 100;
        });
    }

    _handleKeydown(e) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
        switch (e.code) {
            case 'Space':
                e.preventDefault();
                this.isRunning ? this._togglePause() : this._toggleStart();
                break;
            case 'KeyC': this._clear(); break;
            case 'KeyH': this.dom.controlPanel.classList.toggle('collapsed'); break;
        }
    }

    // ══════════════════════════════════════════════════
    //  MODE SWITCHING
    // ══════════════════════════════════════════════════

    _switchMode(key) {
        modeManager.setMode(key);

        // Update button UI
        this.dom.modeButtons.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === key);
        });

        // Update mode info text
        if (this.dom.modeInfo) {
            this.dom.modeInfo.textContent = modeManager.current.description;
        }

        // Configure the chosen renderer
        const mode = modeManager.current;

        if (modeManager.isDiscrete()) {
            // Apply visual mode settings to discrete renderer
            const vmKey = mode.visualMode;
            if (vmKey && Config.visualModes[vmKey]) {
                const vm = Config.visualModes[vmKey];
                this.clipQueue.setVisualMode(vmKey);
                Config.features.enableGlow = vm.enableGlow;
                Config.trace.defaultLineWidth = vm.lineWidthRange[0];
                Config.trace.maxLineWidth = vm.lineWidthRange[1];
                traceRenderer.setRenderMode(vm.renderMode || 'jazz');
            }
        } else {
            // Configure continuous line with mode settings
            if (this.primaryLine && mode.settings) {
                Object.assign(this.primaryLine, mode.settings);
                this.primaryLine.reset();
            }
        }

        // Clear canvas on mode switch
        canvasManager.clear();
    }

    _onModeChange(newKey, prevKey) {
        // Already handled in _switchMode — this is for external listeners
    }

    // ══════════════════════════════════════════════════
    //  MIDI / INPUT
    // ══════════════════════════════════════════════════

    _populateMidiDevices() {
        const sel = this.dom.midiDeviceSelect;
        if (!sel) return;
        sel.innerHTML = '<option value="">Select MIDI device…</option>';
        for (const inp of midiManager.inputs) {
            const opt = document.createElement('option');
            opt.value = inp.id;
            opt.textContent = inp.name;
            sel.appendChild(opt);
        }
    }

    _setInputMode(mode) {
        this.inputMode = mode;
        const btns = [this.dom.btnMic, this.dom.btnMidi, this.dom.btnMpe, this.dom.btnHybrid];
        btns.forEach(b => { if (b) b.classList.remove('active'); });
        switch (mode) {
            case 'audio':  this.dom.btnMic.classList.add('active'); break;
            case 'midi':   if (this.dom.btnMidi) this.dom.btnMidi.classList.add('active'); break;
            case 'mpe':    if (this.dom.btnMpe) this.dom.btnMpe.classList.add('active'); break;
            case 'hybrid': if (this.dom.btnHybrid) this.dom.btnHybrid.classList.add('active'); break;
        }
        this._updateStatus(`Mode: ${mode.toUpperCase()}`);
    }

    get _needsAudio() { return this.inputMode === 'audio' || this.inputMode === 'hybrid'; }
    get _needsMidi()  { return this.inputMode === 'midi' || this.inputMode === 'mpe' || this.inputMode === 'hybrid'; }

    // ══════════════════════════════════════════════════
    //  TRANSPORT
    // ══════════════════════════════════════════════════

    _toggleStart() { this.isRunning ? this._stop() : this._start(); }

    async _start() {
        if (this._needsAudio && !this.audioReady) {
            this._updateStatus('Requesting mic…');
            const ok = await audioAnalyzer.init('mic');
            if (ok) this.audioReady = true;
            else this._updateStatus('Mic denied');
        }

        this.isRunning = true;
        this.isPaused = false;
        this.lastFrameTime = performance.now();

        this.dom.btnStart.textContent = 'Stop';
        this.dom.btnStart.classList.add('active');
        this.dom.btnPause.disabled = false;
        document.body.classList.add('listening');

        this._updateStatus(`${this.inputMode.toUpperCase()} — Listening`);
        this._loop();
    }

    _stop() {
        this.isRunning = false;
        this.isPaused = false;
        if (this.animationId) { cancelAnimationFrame(this.animationId); this.animationId = null; }
        if (this._fileAudioEl) this._fileAudioEl.pause();
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
        if (!this.isPaused) this.lastFrameTime = performance.now();
    }

    _clear() {
        this.clipQueue.clear();
        if (this.primaryLine) this.primaryLine.reset();
        this.demoTrace = { points: [], time: 0 };
        canvasManager.clear();
        if (!this.isRunning) this._drawIdleState();
    }

    async _handleFileSelect(e) {
        const file = e.target.files[0];
        if (!file) return;
        console.log(`[File] Selected: ${file.name} (${(file.size / 1024).toFixed(0)} KB)`);
        this._updateStatus(`Loading: ${file.name}…`);
        try {
            const url = URL.createObjectURL(file);
            if (this._fileAudioEl) {
                this._fileAudioEl.pause();
                URL.revokeObjectURL(this._fileAudioEl.src);
                this._fileAudioEl.remove();
            }
            const audio = document.createElement('audio');
            audio.src = url;
            audio.crossOrigin = 'anonymous';
            audio.loop = true;
            document.body.appendChild(audio);
            this._fileAudioEl = audio;
            const ok = await audioAnalyzer.init('file', audio);
            if (!ok) { this._updateStatus('File load failed'); return; }
            this.audioReady = true;
            this._setInputMode('audio');
            audio.play();
            if (!this.isRunning) {
                this.isRunning = true;
                this.isPaused = false;
                this.lastFrameTime = performance.now();
                this.dom.btnStart.textContent = 'Stop';
                this.dom.btnStart.classList.add('active');
                this.dom.btnPause.disabled = false;
                document.body.classList.add('listening');
                this._loop();
            }
            this._updateStatus(`Playing: ${file.name}`);
        } catch (err) {
            console.error('[File] Error loading audio:', err);
            this._updateStatus('File error');
        }
    }

    // ══════════════════════════════════════════════════
    //  MIDI EVENT HANDLERS
    // ══════════════════════════════════════════════════

    _handleMidiNoteOn(mpeNote) {
        if (!this.isRunning || this.isPaused) return;
        if (!this._needsMidi) return;

        // Discrete modes: create gesture clips
        if (modeManager.isDiscrete()) {
            const clip = createMidiClip(mpeNote, this.params);
            const accepted = this.clipQueue.enqueue(clip);
            if (accepted) {
                console.log(`[MIDI] ${clip.vocabularyType} note=${mpeNote.note} vel=${mpeNote.velocity}`);
            }
        }
        // Continuous modes: MIDI data feeds into features (handled in update)
    }

    _handleMidiNoteOff(mpeNote) {
        const key = `${mpeNote.channel}:${mpeNote.note}`;
        this.clipQueue.releaseMidiNote(key);
    }

    // ══════════════════════════════════════════════════
    //  PRESETS / STATUS / IDLE
    // ══════════════════════════════════════════════════

    _applyPreset(presetName) {
        const preset = Config.presets[presetName];
        if (!preset) return;
        this.activePreset = presetName;
        const root = document.documentElement;
        root.style.setProperty('--bg-primary', preset.background);
        root.style.setProperty('--trace-color-1', preset.colors[0]);
        root.style.setProperty('--trace-color-2', preset.colors[1]);
        root.style.setProperty('--trace-color-3', preset.colors[2]);
        root.style.setProperty('--accent-primary', preset.colors[0]);
        root.style.setProperty('--accent-glow', preset.glowColor);
        if (canvasManager.ctx) canvasManager.clear(preset.background);
    }

    _updateStatus(text) { if (this.dom.statusText) this.dom.statusText.textContent = text; }

    _updateFPS(now) {
        this.frameCount++;
        if (now - this.lastFPSUpdate >= this.fpsUpdateInterval) {
            this.fps = Math.round((this.frameCount * 1000) / (now - this.lastFPSUpdate));
            if (this.dom.fpsCounter) this.dom.fpsCounter.textContent = `${this.fps} fps`;
            this.frameCount = 0;
            this.lastFPSUpdate = now;
        }
    }

    _drawIdleState() {
        const { ctx, center } = canvasManager;
        const preset = Config.presets[this.activePreset];
        ctx.beginPath();
        ctx.arc(center.x, center.y, 40, 0, Math.PI * 2);
        ctx.strokeStyle = preset.colors[0] + '20';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.font = '13px -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.fillStyle = preset.colors[0] + '40';
        ctx.textAlign = 'center';
        ctx.fillText('Press Start or Space to begin', center.x, center.y + 70);
        ctx.textAlign = 'left';
    }

    // ══════════════════════════════════════════════════
    //  MAIN LOOP
    // ══════════════════════════════════════════════════

    _loop() {
        if (!this.isRunning) return;
        const now = performance.now();
        const dt = Math.min((now - this.lastFrameTime) / 1000, 0.1);  // cap at 100ms
        this.lastFrameTime = now;
        this._updateFPS(now);
        if (!this.isPaused) {
            this._update(dt);
            this._draw();
        }
        this.animationId = requestAnimationFrame(() => this._loop());
    }

    // ══════════════════════════════════════════════════
    //  UPDATE — routes to discrete or continuous
    // ══════════════════════════════════════════════════

    _update(dt) {
        const hasInput = this.audioReady || this.midiReady;

        // ── Always extract audio features if available ──
        if (this._needsAudio && this.audioReady) {
            audioAnalyzer.update();
            this.audioFeatures = extractFeatures(
                audioAnalyzer.getFrequencyData(),
                audioAnalyzer.getTimeDomainData(),
                audioAnalyzer.getSampleRate()
            );
        }

        if (!hasInput) {
            if (modeManager.isContinuous()) {
                // Demo: continuous line with no audio (ambient drift)
                this.primaryLine.update(dt, null, this.params);
            } else {
                this._updateDemo(dt);
            }
            return;
        }

        // ── Route to the active renderer ──
        if (modeManager.isContinuous()) {
            this._updateContinuous(dt);
        } else {
            this._updateDiscrete(dt);
        }
    }

    /**
     * CONTINUOUS mode update: feed audio features to the flowing line.
     */
    _updateContinuous(dt) {
        // MIDI can also influence the continuous line
        let features = this.audioFeatures;

        if (this._needsMidi && this.midiReady) {
            const agg = midiManager.getAggregateFeatures();
            if (agg && agg.amplitude > 0) {
                // Merge MIDI features with audio or use MIDI alone
                if (!features || features.amplitude < 0.01) {
                    features = agg;
                } else {
                    // Blend: MIDI adds to audio
                    features = { ...features };
                    features.amplitude = Math.max(features.amplitude, agg.amplitude);
                    features.brightness = (features.brightness + agg.brightness) * 0.5;
                }
            }
        }

        this.primaryLine.update(dt, features, this.params);
    }

    /**
     * DISCRETE mode update: phrase detection → gesture clips (existing system).
     */
    _updateDiscrete(dt) {
        const features = this.audioFeatures;
        let isContinuous = false;

        if (features && this._needsAudio) {
            const threshold = 0.01 + (1 - this.params.sensitivity) * 0.34;
            const aboveThreshold = features.amplitude >= threshold;

            if (aboveThreshold) { this._continuousFrames++; this._silentFrames = 0; }
            else { this._silentFrames++; this._continuousFrames = 0; }

            isContinuous = this._continuousFrames > 6;

            if (this._silentFrames === 4 && this._wasContinuous) {
                this.clipQueue.releaseAll();
            }
            this._wasContinuous = isContinuous;

            if (aboveThreshold && (this.inputMode === 'audio' || this.inputMode === 'hybrid')) {
                const phrase = detectPhrase(features, dt, this.params.sensitivity);
                if (phrase.isPhraseStart) {
                    const clip = createGestureClip(features, phrase, this.params);
                    this.clipQueue.enqueue(clip);
                }
            }
        }

        // MIDI continuity
        if (this._needsMidi && this.midiReady) {
            const heldNotes = midiManager.getHeldNotes();
            if (heldNotes.length > 0) {
                isContinuous = true;
                for (const note of heldNotes) {
                    const key = `${note.channel}:${note.note}`;
                    for (const clip of this.clipQueue.getActiveClips()) {
                        if (clip.midiNoteKey === key) {
                            clip.liveIntensity = Math.max(note.velocityNorm, note.pressure);
                            clip.livePitchBend = note.pitchBend;
                            clip.liveSlide = note.slide;
                        }
                    }
                }
            } else if (this.inputMode !== 'hybrid') {
                isContinuous = false;
            }
        }

        this.clipQueue.update(dt, isContinuous);
    }

    _updateDemo(dt) {
        const trace = this.demoTrace;
        const speed = this.params.speed * 2;
        const sens = this.params.sensitivity;
        trace.time += dt * speed;
        const cx = canvasManager.center.x;
        const cy = canvasManager.center.y;
        const maxR = Math.min(canvasManager.width, canvasManager.height) * 0.35;
        const t = trace.time;
        const x = cx + Math.sin(t * 0.7) * maxR * sens + Math.sin(t * 1.9) * maxR * 0.3 * sens + Math.cos(t * 3.1) * maxR * 0.1;
        const y = cy + Math.cos(t * 0.5) * maxR * sens * 0.8 + Math.sin(t * 1.3) * maxR * 0.25 * sens + Math.sin(t * 2.7) * maxR * 0.15;
        trace.points.push({ x, y, alpha: 1.0 });
        if (trace.points.length > Config.trace.maxPoints) trace.points.shift();
    }

    // ══════════════════════════════════════════════════
    //  DRAW — routes to discrete or continuous
    // ══════════════════════════════════════════════════

    _draw() {
        const preset = Config.presets[this.activePreset];
        const mode = modeManager.current;
        const fadeRate = mode.canvasFade || 0.03;
        const baseLineWeight = mapRange(this.params.lineWeight, 0, 1, 1.5, 10);
        const hasInput = this.audioReady || this.midiReady;

        if (modeManager.isContinuous()) {
            // ── Continuous renderer ──
            canvasManager.fade(fadeRate);
            if (hasInput || this.primaryLine.pathPoints.length > 0) {
                this.primaryLine.render(canvasManager.ctx, preset, baseLineWeight);
            }
            if (!hasInput && this.primaryLine.pathPoints.length === 0) {
                this._drawIdleState();
            }
        } else {
            // ── Discrete renderer ──
            const vm = Config.visualModes[mode.visualMode];
            const fadeMin = (vm && vm.trailFadeRange) ? vm.trailFadeRange[0] : 0.005;
            const fadeMax = (vm && vm.trailFadeRange) ? vm.trailFadeRange[1] : 0.12;
            const discreteFade = mapRange(this.params.trailFade, 0, 1, fadeMin, fadeMax);

            // Horizontal scroll: shift canvas right so gestures drift L→R
            const scrollPx = mode.canvasScroll || 0;
            if (scrollPx > 0) {
                canvasManager.scroll(scrollPx * (0.5 + this.params.speed));
            }

            if (hasInput) {
                const clips = this.clipQueue.getVisibleClips();
                traceRenderer.render(clips, preset, { baseLineWeight, fadeRate: discreteFade });
            } else {
                this._drawDemo(preset, discreteFade, baseLineWeight);
            }
        }
    }

    _drawDemo(preset, fadeRate, baseLineWeight) {
        const { ctx } = canvasManager;
        canvasManager.fade(fadeRate);
        const points = this.demoTrace.points;
        if (points.length < 2) return;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        for (let i = 1; i < points.length; i++) {
            const prev = points[i - 1], curr = points[i];
            const progress = i / points.length;
            const ci = Math.floor(progress * (preset.colors.length - 1));
            const c1 = preset.colors[Math.min(ci, preset.colors.length - 1)];
            const alpha = clamp(progress * 1.5, 0.05, 1.0);
            ctx.beginPath();
            ctx.moveTo(prev.x, prev.y);
            if (i < points.length - 1) {
                const next = points[i + 1];
                ctx.quadraticCurveTo(curr.x, curr.y, (curr.x + next.x) / 2, (curr.y + next.y) / 2);
            } else { ctx.lineTo(curr.x, curr.y); }
            ctx.strokeStyle = this._hexWithAlpha(c1, alpha);
            ctx.lineWidth = baseLineWeight * (0.5 + progress * 0.5);
            ctx.stroke();
        }
        if (Config.features.enableGlow && points.length > 0) {
            const tip = points[points.length - 1];
            ctx.save();
            ctx.shadowColor = preset.glowColor;
            ctx.shadowBlur = Config.trace.glowBlur;
            ctx.beginPath();
            ctx.arc(tip.x, tip.y, baseLineWeight * 0.5, 0, Math.PI * 2);
            ctx.fillStyle = preset.colors[0];
            ctx.fill();
            ctx.restore();
        }
    }

    _hexWithAlpha(hex, alpha) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
}

// ── Bootstrap ────────────────────────────────────────

const app = new App();
document.addEventListener('DOMContentLoaded', () => { app.init(); });
export default app;
