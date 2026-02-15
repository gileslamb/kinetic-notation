/**
 * Kinetic Notation — Feature Extraction (low-latency)
 *
 * LATENCY OPTIMISATIONS vs Sprint 1:
 *   - Onset window: 18 frames (~300ms) down from 30 (~500ms)
 *   - Amplitude window: 12 frames down from 20
 *   - Phrase cooldown: 0.15s down from 0.4s
 *   - Silence gap: 4 frames down from 8
 *   - Onset decay: 0.75 (faster) down from 0.85
 *   - Onset detection threshold: 0.05 down from 0.08
 */

/**
 * @typedef {Object} AudioFeatures
 * @property {number} amplitude  - Overall loudness 0–1
 * @property {number} pitch      - Fundamental freq in Hz
 * @property {number} brightness - Spectral centroid 0–1
 * @property {number} onset      - Beat onset strength 0–1
 * @property {number} bass       - Low-frequency energy 0–1
 * @property {number} mid        - Mid-frequency energy 0–1
 * @property {number} treble     - High-frequency energy 0–1
 */

/**
 * @typedef {Object} PhraseInfo
 * @property {boolean} isPhraseStart
 * @property {number}  phraseIntensity  0–1
 * @property {string}  trigger          'onset'|'silence'|'density'
 */

// ─── Persistent state ───────────────────────────────

let _prevAmp = 0;
let _onsetDecay = 0;

const _ps = {
    onsetHistory: [],
    onsetWindowSize: 18,       // ~300ms @ 60fps

    amplitudeHistory: [],
    ampWindowSize: 12,

    lastPhraseTime: 0,
    minPhraseCooldown: 0.15,   // 150ms — tight
    clock: 0,

    wasSilent: true,
    silenceThreshold: 0.04,
    silenceFrames: 0,
    silenceMinFrames: 4,       // ~67ms gap detection
};

// ─── Main extraction ────────────────────────────────

export function extractFeatures(frequencyData, timeDomainData, sampleRate) {
    if (!frequencyData || !timeDomainData) {
        return { amplitude: 0, pitch: 0, brightness: 0, onset: 0, bass: 0, mid: 0, treble: 0 };
    }

    const amplitude = _computeAmplitude(timeDomainData);
    const bands = _computeBands(frequencyData, sampleRate);
    const brightness = _computeCentroid(frequencyData, sampleRate);
    const onset = _detectOnset(amplitude, _prevAmp);
    const pitch = detectPitch(timeDomainData, sampleRate);

    _prevAmp = amplitude;
    _onsetDecay = Math.max(_onsetDecay * 0.75, onset);  // faster decay

    return {
        amplitude,
        pitch,
        brightness,
        onset: _onsetDecay,
        bass: bands.bass,
        mid: bands.mid,
        treble: bands.treble,
    };
}

// ─── Phrase Detection ────────────────────────────────

export function detectPhrase(features, dt, sensitivity = 0.5) {
    const ps = _ps;
    ps.clock += dt;

    const result = { isPhraseStart: false, phraseIntensity: 0, trigger: '' };

    ps.onsetHistory.push(features.onset);
    if (ps.onsetHistory.length > ps.onsetWindowSize) ps.onsetHistory.shift();

    ps.amplitudeHistory.push(features.amplitude);
    if (ps.amplitudeHistory.length > ps.ampWindowSize) ps.amplitudeHistory.shift();

    // Cooldown
    const cooldown = ps.minPhraseCooldown * (1.3 - sensitivity * 0.6);
    if (ps.clock - ps.lastPhraseTime < cooldown) {
        _trackSilence(features, sensitivity);
        return result;
    }

    // H1: silence → sound
    const sThresh = ps.silenceThreshold * (1.5 - sensitivity);
    if (features.amplitude < sThresh) {
        ps.silenceFrames++;
    } else {
        if (ps.silenceFrames >= ps.silenceMinFrames && ps.wasSilent) {
            result.isPhraseStart = true;
            result.phraseIntensity = Math.min(features.amplitude * 2, 1.0);
            result.trigger = 'silence';
        }
        ps.silenceFrames = 0;
    }
    ps.wasSilent = features.amplitude < sThresh;

    // H2: onset density spike
    if (!result.isPhraseStart && ps.onsetHistory.length >= ps.onsetWindowSize) {
        const recent = ps.onsetHistory.slice(-8);
        const older  = ps.onsetHistory.slice(0, -8);
        const rDens = recent.filter(o => o > 0.08).length / recent.length;
        const oDens = older.filter(o => o > 0.08).length / Math.max(older.length, 1);
        const dThresh = 0.35 - sensitivity * 0.2;
        if (rDens - oDens > dThresh && rDens > 0.25) {
            result.isPhraseStart = true;
            result.phraseIntensity = Math.min(rDens * 1.5, 1.0);
            result.trigger = 'density';
        }
    }

    // H3: strong onset
    if (!result.isPhraseStart && features.onset > 0.2) {
        const avg = ps.amplitudeHistory.length > 0
            ? ps.amplitudeHistory.reduce((a, b) => a + b, 0) / ps.amplitudeHistory.length : 0;
        const oThresh = 0.2 - sensitivity * 0.12;
        if (features.onset > oThresh && features.amplitude > avg * 1.6) {
            result.isPhraseStart = true;
            result.phraseIntensity = Math.min(features.onset, 1.0);
            result.trigger = 'onset';
        }
    }

    if (result.isPhraseStart) ps.lastPhraseTime = ps.clock;
    return result;
}

function _trackSilence(features, sensitivity) {
    const sThresh = _ps.silenceThreshold * (1.5 - sensitivity);
    if (features.amplitude < sThresh) _ps.silenceFrames++;
    else _ps.silenceFrames = 0;
    _ps.wasSilent = features.amplitude < sThresh;
}

// ─── Internals ───────────────────────────────────────

function _computeAmplitude(td) {
    let sum = 0;
    for (let i = 0; i < td.length; i++) { const s = (td[i] - 128) / 128; sum += s * s; }
    return Math.min(Math.sqrt(sum / td.length) * 4, 1.0);
}

function _computeBands(fd, sr) {
    const n = fd.length, ny = sr / 2, hpb = ny / n;
    const bB = Math.floor(250 / hpb), mB = Math.floor(2000 / hpb);
    let bs = 0, ms = 0, ts = 0, bc = 0, mc = 0, tc = 0;
    for (let i = 0; i < n; i++) {
        const v = fd[i] / 255;
        if (i < bB) { bs += v; bc++; } else if (i < mB) { ms += v; mc++; } else { ts += v; tc++; }
    }
    return { bass: bc ? bs / bc : 0, mid: mc ? ms / mc : 0, treble: tc ? ts / tc : 0 };
}

function _computeCentroid(fd, sr) {
    let wSum = 0, tot = 0;
    const ny = sr / 2, hpb = ny / fd.length;
    for (let i = 0; i < fd.length; i++) { wSum += i * hpb * fd[i]; tot += fd[i]; }
    return tot === 0 ? 0 : Math.min(wSum / tot / 5000, 1.0);
}

export function detectPitch(td, sr) {
    const n = td.length;
    const f = new Float32Array(n);
    for (let i = 0; i < n; i++) f[i] = (td[i] - 128) / 128;
    let rms = 0;
    for (let i = 0; i < n; i++) rms += f[i] * f[i];
    rms = Math.sqrt(rms / n);
    if (rms < 0.01) return 0;
    const minP = Math.floor(sr / 1000), maxP = Math.floor(sr / 60);
    let bestC = 0, bestP = 0;
    for (let p = minP; p < maxP && p < n; p++) {
        let c = 0;
        for (let i = 0; i < n - p; i++) c += f[i] * f[i + p];
        c /= (n - p);
        if (c > bestC) { bestC = c; bestP = p; }
    }
    return (bestC > 0.01 && bestP > 0) ? sr / bestP : 0;
}

export function detectOnset(cur, prev, threshold = 0.05) {
    const d = cur - prev;
    return d > threshold ? Math.min(d / 0.4, 1.0) : 0;
}

// private alias used internally
const _detectOnset = detectOnset;
