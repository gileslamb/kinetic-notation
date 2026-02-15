/**
 * Kinetic Notation — MIDI Manager with MPE Support
 *
 * INPUT MODES:
 *   'midi'  — Standard MIDI: note on/off + velocity + CCs (omni-channel)
 *   'mpe'   — MPE: per-note channels (2–16), per-note expression
 *   'hybrid' — MIDI for timing/triggering + audio for spectral analysis
 *
 * MPE DIMENSIONS (per note):
 *   Pitch bend  → micro-pitch / heading modulation
 *   Pressure    → intensity / line weight (channel aftertouch)
 *   CC74 (slide) → brightness / timbre / vocabulary blend
 *
 * LATENCY: ~3–5ms (MIDI is event-driven, no FFT buffering)
 *
 * LIFECYCLE:
 *   1. midiManager.init()           → request Web MIDI access
 *   2. midiManager.selectInput(id)  → listen on a specific port
 *   3. Each frame: midiManager.getActiveNotes()  → for rendering
 *   4. Callbacks: onNoteOn, onNoteOff, onControl  → for clip triggering
 */

import Config from '../utils/config.js';

// ─── MPE Note State ──────────────────────────────────

/**
 * Represents one active MPE note with per-note expression.
 * Each note on a separate MIDI channel in MPE mode.
 */
class MPENote {
    constructor(channel, note, velocity) {
        this.channel = channel;       // MIDI channel (0-indexed, 1–15 for MPE voices)
        this.note = note;             // MIDI note number 0–127
        this.velocity = velocity;     // 0–127 initial strike velocity
        this.pressure = 0;            // Channel aftertouch 0–1 (continuous)
        this.pitchBend = 0;           // -1 to +1 (14-bit pitch bend)
        this.slide = 0;               // CC74 0–1 (timbre / Y-axis)
        this.startTime = performance.now();
        this.released = false;
        this.releaseTime = 0;
    }

    /** Duration in seconds since note-on */
    get age() { return (performance.now() - this.startTime) / 1000; }

    /** Time since release in seconds (0 if not released) */
    get releasedAge() {
        return this.released ? (performance.now() - this.releaseTime) / 1000 : 0;
    }

    /** Normalised velocity 0–1 */
    get velocityNorm() { return this.velocity / 127; }

    /** Map MIDI note to frequency in Hz */
    get frequency() { return 440 * Math.pow(2, (this.note - 69) / 12); }

    /** Map note to a 0–1 range across the keyboard */
    get pitchNorm() {
        const [lo, hi] = Config.midi.noteRange;
        return Math.max(0, Math.min(1, (this.note - lo) / (hi - lo)));
    }

    /**
     * Convert this note's state to AudioFeatures-compatible format.
     * This lets MIDI notes drive the same gesture system as audio.
     */
    toFeatures() {
        const pitchN = this.pitchNorm;
        return {
            amplitude: Math.max(this.velocityNorm, this.pressure),
            pitch: this.frequency,
            brightness: this.slide,                          // CC74 maps to spectral centroid
            onset: this.released ? 0 : (this.age < 0.05 ? this.velocityNorm : 0),
            bass: pitchN < 0.33 ? 1 - pitchN * 3 : 0,      // low notes → bass
            mid: pitchN > 0.25 && pitchN < 0.75 ? 1 : 0,
            treble: pitchN > 0.66 ? (pitchN - 0.66) * 3 : 0,
        };
    }
}

// ─── MIDI Manager ────────────────────────────────────

class MidiManager {
    constructor() {
        /** @type {MIDIAccess|null} */
        this.midiAccess = null;

        /** @type {MIDIInput|null} */
        this.activeInput = null;

        /** @type {Map<string, MPENote>} key = "ch:note" */
        this.activeNotes = new Map();

        /** Available MIDI input ports */
        this.inputs = [];

        /** Is Web MIDI available? */
        this.isSupported = !!navigator.requestMIDIAccess;

        /** Is currently connected and listening? */
        this.isConnected = false;

        /** MPE mode detection */
        this.mpeDetected = false;
        this._channelsUsed = new Set();

        // ── Master channel state (MPE channel 1 / ch 0) ──
        this.masterPitchBend = 0;
        this.masterCC = new Map();   // CC number → 0–1

        // ── Callbacks ──
        /** @type {Function|null} (mpeNote) => void */
        this.onNoteOn = null;
        /** @type {Function|null} (mpeNote) => void */
        this.onNoteOff = null;
        /** @type {Function|null} (cc, value, channel) => void */
        this.onControl = null;
        /** @type {Function|null} (inputs[]) => void */
        this.onDeviceChange = null;
    }

    // ── Initialisation ───────────────────────────────

    /**
     * Request Web MIDI access and enumerate inputs.
     * @returns {Promise<boolean>} true if MIDI is available
     */
    async init() {
        if (!this.isSupported) {
            console.warn('[MIDI] Web MIDI API not supported in this browser');
            return false;
        }

        try {
            this.midiAccess = await navigator.requestMIDIAccess({ sysex: false });
            this._refreshInputs();

            // Listen for hot-plug
            this.midiAccess.onstatechange = () => {
                this._refreshInputs();
                if (this.onDeviceChange) this.onDeviceChange(this.inputs);
            };

            console.log(`[MIDI] Initialised — ${this.inputs.length} input(s) found`);
            return true;
        } catch (err) {
            console.error('[MIDI] Access denied:', err.message);
            return false;
        }
    }

    /** Refresh the list of available input ports. */
    _refreshInputs() {
        this.inputs = [];
        if (!this.midiAccess) return;
        for (const input of this.midiAccess.inputs.values()) {
            this.inputs.push({
                id: input.id,
                name: input.name || `MIDI Input ${input.id}`,
                manufacturer: input.manufacturer || '',
            });
        }
    }

    /**
     * Start listening on a specific MIDI input port.
     * @param {string} inputId  port ID from this.inputs
     * @returns {boolean}
     */
    selectInput(inputId) {
        if (!this.midiAccess) return false;

        // Disconnect previous
        if (this.activeInput) {
            this.activeInput.onmidimessage = null;
        }

        const port = this.midiAccess.inputs.get(inputId);
        if (!port) {
            console.warn(`[MIDI] Input ${inputId} not found`);
            return false;
        }

        this.activeInput = port;
        this.activeInput.onmidimessage = (e) => this._handleMessage(e);
        this.isConnected = true;
        this._channelsUsed.clear();
        this.mpeDetected = false;

        console.log(`[MIDI] Listening on: ${port.name}`);
        return true;
    }

    /** Auto-select the first available input. */
    autoConnect() {
        if (this.inputs.length > 0) {
            return this.selectInput(this.inputs[0].id);
        }
        return false;
    }

    /** Disconnect from current input. */
    disconnect() {
        if (this.activeInput) {
            this.activeInput.onmidimessage = null;
            this.activeInput = null;
        }
        this.isConnected = false;
        this.activeNotes.clear();
    }

    // ── MIDI Message Parsing ─────────────────────────

    /** @private */
    _handleMessage(event) {
        const [status, data1, data2] = event.data;
        const msgType = status & 0xF0;
        const channel = status & 0x0F;

        // Track channels for MPE auto-detection
        this._channelsUsed.add(channel);
        if (this._channelsUsed.size > 2) {
            this.mpeDetected = true;
        }

        const isMaster = channel === Config.midi.masterChannel;

        switch (msgType) {
            case 0x90: // Note On
                if (data2 > 0) {
                    this._noteOn(channel, data1, data2);
                } else {
                    this._noteOff(channel, data1); // velocity 0 = note off
                }
                break;

            case 0x80: // Note Off
                this._noteOff(channel, data1);
                break;

            case 0xD0: // Channel Aftertouch (MPE pressure)
                this._channelPressure(channel, data1);
                break;

            case 0xE0: // Pitch Bend
                this._pitchBend(channel, data1, data2, isMaster);
                break;

            case 0xB0: // Control Change
                this._controlChange(channel, data1, data2, isMaster);
                break;
        }
    }

    /** @private */
    _noteOn(channel, note, velocity) {
        const key = `${channel}:${note}`;
        const mpeNote = new MPENote(channel, note, velocity);

        // If MPE, carry over any existing channel expression
        // (pitch bend / slide may arrive before note-on in some controllers)
        const existing = this._findNoteOnChannel(channel);
        if (existing) {
            mpeNote.pitchBend = existing.pitchBend;
            mpeNote.slide = existing.slide;
            mpeNote.pressure = existing.pressure;
        }

        this.activeNotes.set(key, mpeNote);
        if (this.onNoteOn) this.onNoteOn(mpeNote);
    }

    /** @private */
    _noteOff(channel, note) {
        const key = `${channel}:${note}`;
        const mpeNote = this.activeNotes.get(key);
        if (mpeNote) {
            mpeNote.released = true;
            mpeNote.releaseTime = performance.now();
            if (this.onNoteOff) this.onNoteOff(mpeNote);
            // Keep briefly for release rendering, prune in getActiveNotes
        }
    }

    /** @private Channel aftertouch → MPE pressure */
    _channelPressure(channel, pressure) {
        const note = this._findNoteOnChannel(channel);
        if (note) note.pressure = pressure / 127;
    }

    /** @private 14-bit pitch bend */
    _pitchBend(channel, lsb, msb, isMaster) {
        const raw = (msb << 7) | lsb;       // 0–16383
        const normalised = (raw - 8192) / 8192; // -1 to +1

        if (isMaster) {
            this.masterPitchBend = normalised;
        } else {
            const note = this._findNoteOnChannel(channel);
            if (note) note.pitchBend = normalised;
        }
    }

    /** @private */
    _controlChange(channel, cc, value, isMaster) {
        const norm = value / 127;

        if (isMaster) {
            this.masterCC.set(cc, norm);
        }

        // CC74 = MPE slide (timbre / Y-axis)
        if (cc === 74) {
            const note = this._findNoteOnChannel(channel);
            if (note) note.slide = norm;
        }

        if (this.onControl) this.onControl(cc, norm, channel);
    }

    /** Find the active (non-released) note on a given channel. */
    _findNoteOnChannel(channel) {
        for (const note of this.activeNotes.values()) {
            if (note.channel === channel && !note.released) return note;
        }
        return null;
    }

    // ── Public Queries ───────────────────────────────

    /**
     * Get all currently active (sounding) notes.
     * Prunes released notes older than 0.5s.
     * @returns {MPENote[]}
     */
    getActiveNotes() {
        const alive = [];
        for (const [key, note] of this.activeNotes) {
            if (note.released && note.releasedAge > 0.5) {
                this.activeNotes.delete(key);
            } else {
                alive.push(note);
            }
        }
        return alive;
    }

    /**
     * Get only non-released (held) notes.
     * @returns {MPENote[]}
     */
    getHeldNotes() {
        return this.getActiveNotes().filter(n => !n.released);
    }

    /**
     * Aggregate all active notes into a single AudioFeatures-like object.
     * Useful for driving the same gesture system as audio.
     * @returns {import('../audio/featureExtraction.js').AudioFeatures}
     */
    getAggregateFeatures() {
        const notes = this.getHeldNotes();
        if (notes.length === 0) {
            return { amplitude: 0, pitch: 0, brightness: 0, onset: 0, bass: 0, mid: 0, treble: 0 };
        }

        let amp = 0, pitch = 0, bright = 0, onset = 0, bass = 0, mid = 0, treble = 0;
        for (const n of notes) {
            const f = n.toFeatures();
            amp = Math.max(amp, f.amplitude);
            pitch += f.pitch;
            bright = Math.max(bright, f.brightness);
            onset = Math.max(onset, f.onset);
            bass = Math.max(bass, f.bass);
            mid = Math.max(mid, f.mid);
            treble = Math.max(treble, f.treble);
        }

        return {
            amplitude: amp,
            pitch: pitch / notes.length,
            brightness: bright,
            onset,
            bass, mid, treble,
        };
    }

    /** Number of currently held notes. */
    get polyphony() {
        return this.getHeldNotes().length;
    }

    /** Master mod wheel (CC1) value 0–1. */
    get modWheel() { return this.masterCC.get(1) || 0; }

    /** Master expression (CC11) value 0–1. */
    get expression() { return this.masterCC.get(11) || 0; }
}

const midiManager = new MidiManager();
export default midiManager;
export { MPENote };
