/**
 * Kinetic Notation — Video Motion Extractor
 *
 * Extracts real motion paths from uploaded video using frame differencing.
 *
 * PIPELINE:
 *   1. User uploads a video file (mp4/webm/mov)
 *   2. Video is loaded into a hidden <video> element
 *   3. Frames are rendered to an offscreen canvas
 *   4. Frame differencing detects motion pixels (absolute diff > threshold)
 *   5. Weighted centroid of motion is calculated per frame
 *   6. Path is recorded as [{x, y, timestamp, intensity}] normalized to 0–1
 *   7. Path can be exported as JSON and loaded into the gesture vocabulary
 *
 * TECHNIQUES:
 *   - Grayscale conversion for fast comparison
 *   - Absolute frame differencing with configurable threshold
 *   - Gaussian-weighted centroid for smooth tracking
 *   - Optional downscaling for performance (processWidth)
 *   - Motion intensity = fraction of pixels above threshold
 */

import {
    setOverrideMode, setForcedVocabulary, setUseImportedData,
    setVocabWeight, setRandomize, getOverrideState,
    TEMPLATES, TEMPLATE_NAMES,
} from '../movement/blendingEngine.js';
import { listImported } from '../movement/naturalMotions.js';
import { smoothPath, resamplePath, getLibrarySummary } from '../movement/gestureLibrary.js';

export class VideoMotionExtractor {
    /**
     * @param {Object} [opts]
     * @param {number} [opts.processWidth]     internal processing width (px)
     * @param {number} [opts.threshold]        pixel diff threshold (0–255)
     * @param {number} [opts.smoothing]        centroid smoothing factor (0–1)
     * @param {number} [opts.sampleRate]       frames to skip between samples (1 = every frame)
     */
    constructor(opts = {}) {
        this.processWidth  = opts.processWidth  || 320;
        this.threshold     = opts.threshold     || 30;
        this.smoothing     = opts.smoothing     || 0.3;
        this.sampleRate    = opts.sampleRate    || 1;

        // State
        this._video       = null;
        this._offscreen    = null;
        this._offCtx       = null;
        this._prevFrame    = null;
        this._path         = [];
        this._frameIndex   = 0;
        this._extracting   = false;
        this._aborted      = false;

        // Smoothed centroid
        this._smoothX = 0.5;
        this._smoothY = 0.5;

        // Callbacks
        this.onProgress = null;  // (progress: 0–1, frameIndex, totalFrames)
        this.onFrame    = null;  // (frameData: {x, y, intensity, diffImageData})
        this.onComplete = null;  // (path: Array)
    }

    /**
     * Load a video file for extraction.
     * @param {File} file
     * @returns {Promise<{duration: number, width: number, height: number, fps: number}>}
     */
    async loadVideo(file) {
        return new Promise((resolve, reject) => {
            if (this._video) {
                URL.revokeObjectURL(this._video.src);
                this._video.remove();
            }

            const video = document.createElement('video');
            video.muted = true;
            video.playsInline = true;
            video.preload = 'auto';
            video.style.display = 'none';
            document.body.appendChild(video);

            const url = URL.createObjectURL(file);
            video.src = url;

            video.addEventListener('loadedmetadata', () => {
                this._video = video;
                this._path = [];
                this._frameIndex = 0;
                this._prevFrame = null;

                // Estimate FPS (default 30 if not available)
                const fps = 30;

                // Create offscreen canvas at processing resolution
                const aspect = video.videoHeight / video.videoWidth;
                const pw = this.processWidth;
                const ph = Math.round(pw * aspect);

                this._offscreen = new OffscreenCanvas(pw, ph);
                this._offCtx = this._offscreen.getContext('2d', { willReadFrequently: true });

                resolve({
                    duration: video.duration,
                    width: video.videoWidth,
                    height: video.videoHeight,
                    fps,
                    processSize: { w: pw, h: ph },
                });
            });

            video.addEventListener('error', () => {
                reject(new Error('Failed to load video'));
            });
        });
    }

    /**
     * Extract the motion path from the loaded video.
     * Seeks through frames, computes frame differences, tracks centroid.
     *
     * @returns {Promise<Array<{x:number, y:number, t:number, intensity:number}>>}
     *   Normalized 0–1 coordinates. t = timestamp in seconds.
     */
    async extract() {
        if (!this._video) throw new Error('No video loaded');
        if (this._extracting) throw new Error('Extraction already in progress');

        this._extracting = true;
        this._aborted = false;
        this._path = [];
        this._prevFrame = null;
        this._smoothX = 0.5;
        this._smoothY = 0.5;

        const video = this._video;
        const fps = 30;
        // Subtract a small margin so we never try to seek to the very last moment
        const safeDuration = Math.max(video.duration - 0.05, 0);
        const totalFrames = Math.floor(safeDuration * fps);
        const dt = 1 / fps;

        console.log(`[Extractor] Starting: ${totalFrames} frames, ${video.duration.toFixed(1)}s`);

        try {
            for (let i = 0; i < totalFrames; i += this.sampleRate) {
                if (this._aborted) break;

                const time = i * dt;
                await this._seekTo(video, time);

                const frameResult = this._processFrame(time);

                if (frameResult) {
                    this._path.push(frameResult.point);
                    if (this.onFrame) this.onFrame(frameResult);
                }

                if (this.onProgress) {
                    this.onProgress((i + 1) / totalFrames, i + 1, totalFrames);
                }

                this._frameIndex = i;
            }
        } catch (err) {
            console.error('[Extractor] Error during extraction:', err);
        }

        this._extracting = false;

        const path = this._path;
        console.log(`[Extractor] Complete: ${path.length} points extracted`);

        // Always fire onComplete so UI buttons get enabled
        if (this.onComplete) this.onComplete(path);
        return path;
    }

    /**
     * Abort an in-progress extraction.
     */
    abort() {
        this._aborted = true;
    }

    /**
     * Get the raw extracted path data.
     * @returns {Array<{x:number, y:number, t:number, intensity:number}>}
     */
    getPath() {
        return this._path;
    }

    /**
     * Export the path as a gesture JSON object ready for import.
     *
     * PROCESSING PIPELINE:
     *   1. Moving-average smooth (5-frame window) to reduce jitter
     *   2. Temporal resample to target duration (normalizes from video fps)
     *   3. Spatial normalization (fit to canvas proportions)
     *
     * @param {string} name       gesture name (e.g. "whale_breach")
     * @param {string} vocabulary vocabulary type it replaces (e.g. "whale")
     * @returns {Object}
     */
    exportGesture(name, vocabulary) {
        let path = this._path;
        if (!path || !path.length) return null;

        // ── Step 1: Smooth jaggy paths (5-frame moving average) ──
        try {
            path = smoothPath(path, 5);
        } catch (e) {
            console.warn('[Extractor] Smooth failed, using raw path:', e);
        }

        // ── Step 2: Temporal resample to normalize timing ──
        const rawDuration = path.length > 0 ? path[path.length - 1].t : 0;
        const targetDuration = rawDuration; // preserve original duration
        try {
            path = resamplePath(path, targetDuration, Math.min(path.length, 600));
        } catch (e) {
            console.warn('[Extractor] Resample failed, using smoothed path:', e);
        }

        return {
            name,
            vocabulary,
            version: 2,
            frameCount: path.length,
            duration: path.length > 0 ? path[path.length - 1].t : 0,
            source: 'video',
            extractedAt: new Date().toISOString(),
            settings: {
                threshold: this.threshold,
                processWidth: this.processWidth,
                smoothing: this.smoothing,
            },
            path: path.map(p => ({
                x: Math.round(p.x * 10000) / 10000,
                y: Math.round(p.y * 10000) / 10000,
                t: Math.round(p.t * 1000) / 1000,
                intensity: Math.round(p.intensity * 1000) / 1000,
            })),
        };
    }

    /**
     * Export as JSON string for file download.
     * @param {string} name
     * @param {string} vocabulary
     * @returns {string}
     */
    exportJSON(name, vocabulary) {
        const gesture = this.exportGesture(name, vocabulary);
        return gesture ? JSON.stringify(gesture, null, 2) : null;
    }

    /**
     * Destroy and clean up resources.
     */
    destroy() {
        this.abort();
        if (this._video) {
            URL.revokeObjectURL(this._video.src);
            this._video.remove();
            this._video = null;
        }
        this._offscreen = null;
        this._offCtx = null;
        this._prevFrame = null;
        this._path = [];
    }

    // ══════════════════════════════════════════════════
    //  INTERNALS
    // ══════════════════════════════════════════════════

    /**
     * Seek video to a specific time and wait for the frame to be ready.
     * Includes a timeout so it never hangs on the last frame / bad seek.
     */
    _seekTo(video, time) {
        return new Promise((resolve) => {
            // Clamp to just before duration to avoid end-of-file seek stall
            const safeTime = Math.min(time, Math.max(video.duration - 0.05, 0));

            if (Math.abs(video.currentTime - safeTime) < 0.01) {
                resolve();
                return;
            }

            let settled = false;

            const onSeeked = () => {
                if (settled) return;
                settled = true;
                video.removeEventListener('seeked', onSeeked);
                // Small delay to ensure frame is painted
                requestAnimationFrame(() => resolve());
            };

            // Safety timeout — if seeked never fires, resolve anyway after 500ms
            setTimeout(() => {
                if (!settled) {
                    settled = true;
                    video.removeEventListener('seeked', onSeeked);
                    resolve();
                }
            }, 500);

            video.addEventListener('seeked', onSeeked);
            video.currentTime = safeTime;
        });
    }

    /**
     * Render current video frame to offscreen canvas, compute diff, find centroid.
     * @param {number} timestamp
     * @returns {{point: {x,y,t,intensity}, diffData: Uint8ClampedArray}|null}
     */
    _processFrame(timestamp) {
        const ctx = this._offCtx;
        const w = this._offscreen.width;
        const h = this._offscreen.height;

        // Draw current frame
        ctx.drawImage(this._video, 0, 0, w, h);
        const currentData = ctx.getImageData(0, 0, w, h);
        const current = this._toGrayscale(currentData.data, w, h);

        if (!this._prevFrame) {
            this._prevFrame = current;
            return null;  // Need at least 2 frames
        }

        // Frame differencing
        const diff = new Uint8Array(w * h);
        let motionPixels = 0;
        let sumX = 0, sumY = 0, sumWeight = 0;
        const threshold = this.threshold;

        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const idx = y * w + x;
                const d = Math.abs(current[idx] - this._prevFrame[idx]);
                diff[idx] = d;

                if (d > threshold) {
                    motionPixels++;
                    const weight = d;  // Use diff magnitude as weight
                    sumX += x * weight;
                    sumY += y * weight;
                    sumWeight += weight;
                }
            }
        }

        this._prevFrame = current;

        // Calculate motion intensity (fraction of pixels with motion)
        const intensity = motionPixels / (w * h);

        // Calculate centroid
        let cx, cy;
        if (sumWeight > 0) {
            cx = sumX / sumWeight / w;   // Normalize to 0–1
            cy = sumY / sumWeight / h;
        } else {
            cx = this._smoothX;
            cy = this._smoothY;
        }

        // Smooth the centroid to prevent jitter
        this._smoothX = this._smoothX + (cx - this._smoothX) * this.smoothing;
        this._smoothY = this._smoothY + (cy - this._smoothY) * this.smoothing;

        const point = {
            x: this._smoothX,
            y: this._smoothY,
            t: timestamp,
            intensity: Math.min(intensity * 10, 1),  // Scale up for visibility
        };

        return { point, diffData: diff, width: w, height: h };
    }

    /**
     * Convert RGBA image data to grayscale Uint8Array.
     */
    _toGrayscale(rgba, w, h) {
        const gray = new Uint8Array(w * h);
        for (let i = 0; i < w * h; i++) {
            const ri = i * 4;
            // Luminance: 0.299R + 0.587G + 0.114B
            gray[i] = (rgba[ri] * 77 + rgba[ri + 1] * 150 + rgba[ri + 2] * 29) >> 8;
        }
        return gray;
    }
}

// ══════════════════════════════════════════════════════
//  MOTION IMPORT PANEL UI CONTROLLER
// ══════════════════════════════════════════════════════

/**
 * MotionImportPanel manages the UI for the Motion Import tool.
 * It wires up the video upload, preview canvas, extraction controls,
 * save/load buttons, and the gesture override testing controls.
 */
export class MotionImportPanel {
    /**
     * @param {Object} deps
     * @param {Function} deps.onGestureLoaded  callback({name, vocabulary, path}) when a gesture is imported
     */
    constructor(deps = {}) {
        this.extractor = new VideoMotionExtractor();
        this.onGestureLoaded = deps.onGestureLoaded || null;

        // DOM refs (populated in init)
        this.dom = {};
        this._videoMeta = null;
        this._isOpen = false;
    }

    init() {
        this._cacheDom();
        this._bindEvents();
        try {
            this._buildForcedVocabDropdown();
            this._rebuildWeightSliders();
        } catch (err) {
            console.warn('[MotionImport] Override UI init error (non-fatal):', err);
        }
        console.log('[MotionImport] Panel initialized');
    }

    _cacheDom() {
        this.dom = {
            panel:          document.getElementById('motion-import-panel'),
            btnToggle:      document.getElementById('btn-toggle-motion'),
            panelBody:      document.getElementById('motion-panel-body'),
            videoInput:     document.getElementById('motion-video-input'),
            btnUpload:      document.getElementById('btn-motion-upload'),
            previewCanvas:  document.getElementById('motion-preview-canvas'),
            btnExtract:     document.getElementById('btn-motion-extract'),
            btnAbort:       document.getElementById('btn-motion-abort'),
            progressBar:    document.getElementById('motion-progress-bar'),
            progressText:   document.getElementById('motion-progress-text'),
            statsFrames:    document.getElementById('motion-stats-frames'),
            statsIntensity: document.getElementById('motion-stats-intensity'),
            intensityGraph: document.getElementById('motion-intensity-graph'),
            gestureNameInput: document.getElementById('motion-gesture-name'),
            vocabSelect:    document.getElementById('motion-vocab-select'),
            btnSave:        document.getElementById('btn-motion-save'),
            btnLoad:        document.getElementById('btn-motion-load'),
            loadInput:      document.getElementById('motion-load-input'),
            btnImport:      document.getElementById('btn-motion-import'),
            statusText:     document.getElementById('motion-status'),

            // Override controls
            toggleUseImported: document.getElementById('toggle-use-imported'),
            overrideModeBtns:  document.querySelectorAll('.btn-override-mode'),
            forcedVocabRow:    document.getElementById('forced-vocab-row'),
            forcedVocabSelect: document.getElementById('forced-vocab-select'),
            toggleRandomize:   document.getElementById('toggle-randomize'),
            weightContainer:   document.getElementById('weight-sliders-container'),
            sourceSummary:     document.getElementById('gesture-source-summary'),
        };
    }

    _bindEvents() {
        const d = this.dom;

        // Toggle panel visibility
        if (d.btnToggle) {
            d.btnToggle.addEventListener('click', () => this._togglePanel());
        }

        // Video upload
        if (d.btnUpload) {
            d.btnUpload.addEventListener('click', () => d.videoInput.click());
        }
        if (d.videoInput) {
            d.videoInput.addEventListener('change', (e) => this._handleVideoSelect(e));
        }

        // Extract
        if (d.btnExtract) {
            d.btnExtract.addEventListener('click', () => this._startExtraction());
        }
        if (d.btnAbort) {
            d.btnAbort.addEventListener('click', () => this._abortExtraction());
        }

        // Save JSON
        if (d.btnSave) {
            d.btnSave.addEventListener('click', () => this._saveGestureJSON());
        }

        // Load JSON
        if (d.btnLoad) {
            d.btnLoad.addEventListener('click', () => d.loadInput.click());
        }
        if (d.loadInput) {
            d.loadInput.addEventListener('change', (e) => this._handleLoadJSON(e));
        }

        // Import into vocabulary
        if (d.btnImport) {
            d.btnImport.addEventListener('click', () => this._importGesture());
        }

        // Wire extractor callbacks
        this.extractor.onProgress = (progress, frame, total) => {
            this._updateProgress(progress, frame, total);
        };

        this.extractor.onFrame = (frameData) => {
            this._renderPreview(frameData);
        };

        this.extractor.onComplete = (path) => {
            this._onExtractionComplete(path);
        };

        // ── Override controls ──

        // Toggle: use imported data vs math/physics
        if (d.toggleUseImported) {
            d.toggleUseImported.addEventListener('change', (e) => {
                setUseImportedData(e.target.checked);
                this._setStatus(e.target.checked ? 'Using imported motion data' : 'Using math/physics engine');
            });
        }

        // Override mode buttons (auto / forced / imported)
        d.overrideModeBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const mode = btn.dataset.omode;
                if (!mode) return;
                d.overrideModeBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                setOverrideMode(mode);

                // Show/hide forced vocab dropdown
                if (d.forcedVocabRow) {
                    d.forcedVocabRow.style.display = mode === 'forced' ? 'block' : 'none';
                }
                this._setStatus(`Selection mode: ${mode}`);
            });
        });

        // Forced vocabulary dropdown
        if (d.forcedVocabSelect) {
            d.forcedVocabSelect.addEventListener('change', (e) => {
                const vocab = e.target.value;
                if (vocab) {
                    setForcedVocabulary(vocab);
                    this._setStatus(`Forced: all clips → ${vocab}`);
                }
            });
        }

        // Randomize toggle
        if (d.toggleRandomize) {
            d.toggleRandomize.addEventListener('change', (e) => {
                setRandomize(e.target.checked);
                this._setStatus(e.target.checked ? 'Randomizing across imports' : 'Using weighted selection');
            });
        }
    }

    _togglePanel() {
        this._isOpen = !this._isOpen;
        if (this.dom.panel) {
            this.dom.panel.classList.toggle('open', this._isOpen);
        }
    }

    // ── Video Loading ──

    async _handleVideoSelect(e) {
        const file = e.target.files[0];
        if (!file) return;

        this._setStatus(`Loading: ${file.name}…`);

        try {
            const meta = await this.extractor.loadVideo(file);
            this._videoMeta = meta;

            const totalFrames = Math.floor(meta.duration * meta.fps);
            this._setStatus(`Loaded: ${file.name}`);
            if (this.dom.statsFrames) {
                this.dom.statsFrames.textContent = `${totalFrames} frames | ${meta.width}x${meta.height} | ${meta.duration.toFixed(1)}s`;
            }
            if (this.dom.btnExtract) this.dom.btnExtract.disabled = false;

            // Set default gesture name from filename
            if (this.dom.gestureNameInput) {
                const baseName = file.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_]/g, '_');
                this.dom.gestureNameInput.value = baseName;
            }
        } catch (err) {
            console.error('[MotionImport] Load error:', err);
            this._setStatus('Failed to load video');
        }
    }

    // ── Extraction ──

    async _startExtraction() {
        if (!this._videoMeta) return;
        if (this.dom.btnExtract) this.dom.btnExtract.disabled = true;
        if (this.dom.btnAbort) this.dom.btnAbort.disabled = false;
        if (this.dom.btnSave) this.dom.btnSave.disabled = true;
        if (this.dom.btnImport) this.dom.btnImport.disabled = true;
        this._setStatus('Extracting motion…');
        this._clearIntensityGraph();

        try {
            await this.extractor.extract();
        } catch (err) {
            console.error('[MotionImport] Extraction error:', err);
            this._setStatus('Extraction failed');
        }

        if (this.dom.btnExtract) this.dom.btnExtract.disabled = false;
        if (this.dom.btnAbort) this.dom.btnAbort.disabled = true;

        // Safety: if onComplete didn't fire, enable buttons here too
        if (this.extractor._path && this.extractor._path.length > 0) {
            if (this.dom.btnSave) { this.dom.btnSave.disabled = false; this.dom.btnSave.removeAttribute('disabled'); }
            if (this.dom.btnImport) { this.dom.btnImport.disabled = false; this.dom.btnImport.removeAttribute('disabled'); }
        }
    }

    _abortExtraction() {
        this.extractor.abort();
        this._setStatus('Extraction aborted');
        if (this.dom.btnExtract) this.dom.btnExtract.disabled = false;
        if (this.dom.btnAbort) this.dom.btnAbort.disabled = true;
    }

    _onExtractionComplete(path) {
        const count = path ? path.length : 0;
        this._setStatus(`Extracted ${count} motion points — ready to save`);
        console.log(`[MotionImport] Extraction complete: ${count} points`);

        // Force-enable save/import buttons
        const btnSave = this.dom.btnSave || document.getElementById('btn-motion-save');
        const btnImport = this.dom.btnImport || document.getElementById('btn-motion-import');
        if (btnSave) { btnSave.disabled = false; btnSave.removeAttribute('disabled'); }
        if (btnImport) { btnImport.disabled = false; btnImport.removeAttribute('disabled'); }
    }

    // ── Progress + Preview ──

    _updateProgress(progress, frame, total) {
        if (this.dom.progressBar) {
            this.dom.progressBar.style.width = `${(progress * 100).toFixed(1)}%`;
        }
        if (this.dom.progressText) {
            this.dom.progressText.textContent = `${frame} / ${total}`;
        }
    }

    _renderPreview(frameData) {
        const canvas = this.dom.previewCanvas;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        const { diffData, width, height, point } = frameData;

        // Resize canvas to match processing resolution
        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
        }

        // Render diff as heat map
        const imageData = ctx.createImageData(width, height);
        for (let i = 0; i < width * height; i++) {
            const val = Math.min(diffData[i] * 4, 255);  // Amplify for visibility
            const pi = i * 4;
            imageData.data[pi]     = val;                           // R
            imageData.data[pi + 1] = Math.min(val * 0.4, 100);     // G (warm tone)
            imageData.data[pi + 2] = 0;                             // B
            imageData.data[pi + 3] = 200;                           // A
        }
        ctx.putImageData(imageData, 0, 0);

        // Draw centroid crosshair
        const cx = point.x * width;
        const cy = point.y * height;
        ctx.strokeStyle = '#ff6b3d';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, 8, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx - 12, cy);
        ctx.lineTo(cx + 12, cy);
        ctx.moveTo(cx, cy - 12);
        ctx.lineTo(cx, cy + 12);
        ctx.stroke();

        // Update intensity graph
        this._appendIntensityBar(point.intensity);
    }

    // ── Intensity Graph ──

    _clearIntensityGraph() {
        const graph = this.dom.intensityGraph;
        if (graph) graph.innerHTML = '';
    }

    _appendIntensityBar(intensity) {
        const graph = this.dom.intensityGraph;
        if (!graph) return;

        const bar = document.createElement('div');
        bar.className = 'intensity-bar';
        bar.style.height = `${Math.max(intensity * 100, 1)}%`;
        bar.style.opacity = 0.3 + intensity * 0.7;
        graph.appendChild(bar);

        // Keep graph scrolled to latest
        graph.scrollLeft = graph.scrollWidth;

        // Limit bars
        while (graph.children.length > 600) {
            graph.removeChild(graph.firstChild);
        }
    }

    // ── Save / Load JSON ──

    _saveGestureJSON() {
        const name = this.dom.gestureNameInput?.value || 'gesture';
        const vocab = this.dom.vocabSelect?.value || 'whale';

        console.log(`[MotionImport] Save requested: name="${name}", vocab="${vocab}", path length=${this.extractor._path?.length}`);

        // Try extractor path first, then fall back to checking imported data
        let json = this.extractor.exportJSON(name, vocab);

        if (!json) {
            // Check if this vocab has imported data we can re-export
            const imported = listImported();
            const match = imported.find(g => g.vocabulary === vocab);
            if (match) {
                this._setStatus('No new extraction — use Load JSON to re-save existing imports');
            } else {
                this._setStatus('No data to export — extract or load a gesture first');
            }
            console.warn('[MotionImport] exportJSON returned null — path is empty');
            return;
        }

        try {
            // Trigger download — must append <a> to DOM for Safari/Firefox
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${name}.json`;
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();

            // Delay cleanup so the download has time to start
            setTimeout(() => {
                if (a.parentNode) document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }, 2000);

            this._setStatus(`Saved: ${name}.json`);
            console.log(`[MotionImport] Download triggered: ${name}.json`);
        } catch (err) {
            console.error('[MotionImport] Save failed:', err);
            this._setStatus('Save failed — check console');
        }
    }

    async _handleLoadJSON(e) {
        const file = e.target.files[0];
        if (!file) return;

        try {
            const text = await file.text();
            const gesture = JSON.parse(text);

            if (!gesture.path || !gesture.vocabulary) {
                this._setStatus('Invalid gesture file');
                return;
            }

            // Populate UI from loaded file
            if (this.dom.gestureNameInput) this.dom.gestureNameInput.value = gesture.name || '';
            if (this.dom.vocabSelect) this.dom.vocabSelect.value = gesture.vocabulary;
            if (this.dom.statsFrames) {
                this.dom.statsFrames.textContent = `${gesture.frameCount || gesture.path.length} points | loaded from file`;
            }

            // Store the loaded path in the extractor for re-export/import
            this.extractor._path = gesture.path;

            if (this.dom.btnImport) this.dom.btnImport.disabled = false;
            if (this.dom.btnSave) this.dom.btnSave.disabled = false;

            this._setStatus(`Loaded: ${file.name}`);
            this._drawLoadedPath(gesture.path);
        } catch (err) {
            console.error('[MotionImport] JSON load error:', err);
            this._setStatus('Failed to parse JSON');
        }
    }

    _drawLoadedPath(path) {
        const canvas = this.dom.previewCanvas;
        if (!canvas || !path.length) return;

        canvas.width = 320;
        canvas.height = 180;
        const ctx = canvas.getContext('2d');

        // Dark background
        ctx.fillStyle = '#0a0a0f';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Draw path
        ctx.strokeStyle = '#ff6b3d';
        ctx.lineWidth = 1.5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        for (let i = 0; i < path.length; i++) {
            const px = path[i].x * canvas.width;
            const py = path[i].y * canvas.height;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        ctx.stroke();

        // Start marker
        ctx.fillStyle = '#6bff9f';
        ctx.beginPath();
        ctx.arc(path[0].x * canvas.width, path[0].y * canvas.height, 4, 0, Math.PI * 2);
        ctx.fill();

        // End marker
        ctx.fillStyle = '#ff3d6b';
        const last = path[path.length - 1];
        ctx.beginPath();
        ctx.arc(last.x * canvas.width, last.y * canvas.height, 4, 0, Math.PI * 2);
        ctx.fill();
    }

    // ── Import into Vocabulary ──

    _importGesture() {
        const name = this.dom.gestureNameInput?.value || 'custom';
        const vocab = this.dom.vocabSelect?.value || 'whale';
        const gesture = this.extractor.exportGesture(name, vocab);

        if (!gesture) {
            this._setStatus('No gesture data to import');
            return;
        }

        if (this.onGestureLoaded) {
            this.onGestureLoaded(gesture);
            this._setStatus(`Imported "${name}" → ${vocab} vocabulary`);
        } else {
            this._setStatus('No import handler configured');
        }

        // Refresh override UI — new import may add a new vocabulary
        this._rebuildWeightSliders();
        this._buildForcedVocabDropdown();
    }

    // ══════════════════════════════════════════════════
    //  OVERRIDE UI BUILDERS
    // ══════════════════════════════════════════════════

    /**
     * Build the forced-vocab dropdown with all template names,
     * marking active source (video import vs biomechanical).
     */
    _buildForcedVocabDropdown() {
        const sel = this.dom.forcedVocabSelect;
        if (!sel) return;

        let summary;
        try {
            summary = getLibrarySummary();
        } catch (e) {
            // Fallback if library not ready
            summary = TEMPLATE_NAMES.map(n => ({ vocabulary: n, hasVideo: false }));
        }

        const importedVocabs = new Set(
            listImported().map(g => g.vocabulary)
        );

        sel.innerHTML = '<option value="">— select —</option>';

        for (const name of TEMPLATE_NAMES) {
            const opt = document.createElement('option');
            opt.value = name;
            const hasVideo = importedVocabs.has(name);
            const label = hasVideo ? `${name} ★ video` : `${name} ◆ bio`;
            opt.textContent = label;
            opt.style.color = hasVideo ? '#6bff9f' : '#80b0ff';
            sel.appendChild(opt);
        }

        // Also update the gesture source summary if it exists
        this._updateSourceSummary(summary);
    }

    /**
     * Update the source indicator summary in the UI.
     */
    _updateSourceSummary(summary) {
        const container = this.dom.sourceSummary;
        if (!container) return;

        container.innerHTML = '';
        for (const entry of (summary || [])) {
            const row = document.createElement('div');
            row.className = 'source-row';

            const name = document.createElement('span');
            name.className = 'source-name';
            name.textContent = entry.vocabulary;

            const badge = document.createElement('span');
            badge.className = entry.hasVideo ? 'source-badge video' : 'source-badge bio';
            badge.textContent = entry.hasVideo ? 'video' : 'bio';
            if (entry.videoName) badge.title = `Imported: ${entry.videoName}`;

            row.appendChild(name);
            row.appendChild(badge);
            container.appendChild(row);
        }
    }

    /**
     * Rebuild the weight sliders to show only vocabularies
     * that have imported gesture data.
     */
    _rebuildWeightSliders() {
        const container = this.dom.weightContainer;
        if (!container) return;

        const imported = listImported();

        if (imported.length === 0) {
            container.innerHTML = '<div class="weight-empty">No imports loaded yet</div>';
            return;
        }

        container.innerHTML = '';

        for (const g of imported) {
            const row = document.createElement('div');
            row.className = 'weight-row';

            const nameSpan = document.createElement('span');
            nameSpan.className = 'weight-name';
            nameSpan.textContent = g.vocabulary;

            const slider = document.createElement('input');
            slider.type = 'range';
            slider.min = '0';
            slider.max = '100';
            slider.value = '50';
            slider.dataset.vocab = g.vocabulary;

            const valSpan = document.createElement('span');
            valSpan.className = 'weight-val';
            valSpan.textContent = '50';

            slider.addEventListener('input', () => {
                const w = parseInt(slider.value, 10);
                valSpan.textContent = w;
                setVocabWeight(g.vocabulary, w);
            });

            // Set initial weight
            setVocabWeight(g.vocabulary, 50);

            row.appendChild(nameSpan);
            row.appendChild(slider);
            row.appendChild(valSpan);
            container.appendChild(row);
        }
    }

    _setStatus(text) {
        if (this.dom.statusText) this.dom.statusText.textContent = text;
    }
}

// ══════════════════════════════════════════════════════
//  GLOBAL FALLBACK — ensure Save always works
// ══════════════════════════════════════════════════════

// Attach a direct click handler to Save button at module load time.
// This fires even if MotionImportPanel.init() or _bindEvents() fails.
document.addEventListener('DOMContentLoaded', () => {
    const saveBtn = document.getElementById('btn-motion-save');
    if (saveBtn) {
        saveBtn.addEventListener('click', () => {
            // Use the global panel ref if available
            const panel = window.__motionPanel;
            if (panel && panel.extractor && panel.extractor._path && panel.extractor._path.length > 0) {
                console.log('[Fallback Save] Triggering save...');
                panel._saveGestureJSON();
            } else {
                console.warn('[Fallback Save] No extraction data available. Extract a video first.');
                const status = document.getElementById('motion-status');
                if (status) status.textContent = 'No data — extract a video first';
            }
        });
    }
});
