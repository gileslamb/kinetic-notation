/**
 * Kinetic Notation — Audio Analyzer (low-latency)
 *
 * LATENCY BUDGET:
 *   FFT buffer:  512 samples / 44100 Hz = ~11.6ms
 *   Smoothing:   0.3 (fast decay, minimal averaging)
 *   Total audio→visual: ~15–20ms (down from ~50–100ms)
 *
 * Also provides a latency offset for manual calibration
 * (stored in localStorage so it persists between sessions).
 */

import Config from '../utils/config.js';

class AudioAnalyzer {
    constructor() {
        /** @type {AudioContext|null} */
        this.audioContext = null;
        /** @type {AnalyserNode|null} */
        this.analyser = null;
        /** @type {MediaStreamAudioSourceNode|MediaElementAudioSourceNode|null} */
        this.source = null;
        /** @type {MediaStream|null} */
        this.stream = null;

        /** @type {Uint8Array|null} */
        this.frequencyData = null;
        /** @type {Uint8Array|null} */
        this.timeDomainData = null;
        /** @type {Float32Array|null} */
        this.floatTimeDomainData = null;

        this.isInitialized = false;
        this.sourceType = null;

        // ── Latency calibration ──
        // User-adjustable offset in milliseconds (-100 to +100).
        // Positive = visual leads audio (compensate for display lag).
        // Stored in localStorage for persistence.
        this.latencyOffsetMs = this._loadLatencyOffset();
    }

    /**
     * Initialize audio context and low-latency analyser.
     * Must be called from a user gesture (click/tap).
     * @param {'mic'|'file'} sourceType
     * @param {HTMLAudioElement} [audioElement]
     * @returns {Promise<boolean>}
     */
    async init(sourceType = 'mic', audioElement = null) {
        this.destroy();

        try {
            // Request low-latency audio context
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
                latencyHint: 'interactive',   // request lowest latency
                sampleRate: 44100,
            });
            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }

            // ── Low-latency analyser ──
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = Config.audio.fftSize;                         // 1024 → ~12ms
            this.analyser.smoothingTimeConstant = Config.audio.smoothingTimeConstant; // 0.6
            this.analyser.minDecibels = Config.audio.minDecibels;
            this.analyser.maxDecibels = Config.audio.maxDecibels;

            // Allocate buffers
            const len = this.analyser.frequencyBinCount;
            this.frequencyData = new Uint8Array(len);
            this.timeDomainData = new Uint8Array(len);
            this.floatTimeDomainData = new Float32Array(len);

            // ── Connect source ──
            if (sourceType === 'mic') {
                this.stream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        echoCancellation: false,
                        noiseSuppression: false,
                        autoGainControl: false,
                        latency: 0,               // request minimum mic latency
                    },
                });
                this.source = this.audioContext.createMediaStreamSource(this.stream);
            } else if (sourceType === 'file' && audioElement) {
                this.source = this.audioContext.createMediaElementSource(audioElement);
                this.source.connect(this.audioContext.destination);
            } else {
                throw new Error('File source requires an audio element');
            }

            this.source.connect(this.analyser);

            this.isInitialized = true;
            this.sourceType = sourceType;

            const actualLatency = this.audioContext.baseLatency || 0;
            console.log(
                `[AudioAnalyzer] Init OK | fft=${Config.audio.fftSize} ` +
                `baseLatency=${(actualLatency * 1000).toFixed(1)}ms ` +
                `offset=${this.latencyOffsetMs}ms`
            );
            return true;

        } catch (err) {
            console.error('[AudioAnalyzer] Init failed:', err.message);
            this.destroy();
            return false;
        }
    }

    /** Read current audio data into buffers. Call once per frame. */
    update() {
        if (!this.isInitialized || !this.analyser) return;
        this.analyser.getByteFrequencyData(this.frequencyData);
        this.analyser.getByteTimeDomainData(this.timeDomainData);
        this.analyser.getFloatTimeDomainData(this.floatTimeDomainData);
    }

    /** RMS amplitude 0–1. */
    getAmplitude() {
        if (!this.isInitialized || !this.floatTimeDomainData) return 0;
        let sum = 0;
        for (let i = 0; i < this.floatTimeDomainData.length; i++) {
            const s = this.floatTimeDomainData[i];
            sum += s * s;
        }
        return Math.min(Math.sqrt(sum / this.floatTimeDomainData.length) * 3, 1.0);
    }

    /** @returns {Uint8Array|null} */
    getFrequencyData() { return this.frequencyData; }

    /** @returns {Uint8Array|null} */
    getTimeDomainData() { return this.timeDomainData; }

    /** @returns {number} */
    getSampleRate() { return this.audioContext ? this.audioContext.sampleRate : 44100; }

    // ── Latency calibration ──────────────────────────

    /** @param {number} ms  offset in milliseconds */
    setLatencyOffset(ms) {
        this.latencyOffsetMs = Math.max(-100, Math.min(100, ms));
        try { localStorage.setItem('kn_latency_offset', String(this.latencyOffsetMs)); } catch (e) {}
    }

    /** @returns {number} offset in seconds (for use in timing calculations) */
    getLatencyOffsetSec() {
        return this.latencyOffsetMs / 1000;
    }

    /** @private */
    _loadLatencyOffset() {
        try {
            const stored = localStorage.getItem('kn_latency_offset');
            return stored ? parseFloat(stored) : 0;
        } catch (e) { return 0; }
    }

    /** Clean up everything. */
    destroy() {
        if (this.stream) { this.stream.getTracks().forEach(t => t.stop()); this.stream = null; }
        if (this.source) { try { this.source.disconnect(); } catch (e) {} this.source = null; }
        if (this.analyser) { try { this.analyser.disconnect(); } catch (e) {} this.analyser = null; }
        if (this.audioContext) { this.audioContext.close().catch(() => {}); this.audioContext = null; }
        this.frequencyData = this.timeDomainData = this.floatTimeDomainData = null;
        this.isInitialized = false;
        this.sourceType = null;
    }
}

const audioAnalyzer = new AudioAnalyzer();
export default audioAnalyzer;
