# Kinetic Notation — Jazz Edition

**Snapshot date:** 2026-02-15
**Sprint:** 2 (MIDI + continuity)

---

## Aesthetic: "Cubist Jazz Illustration"

Angular, overlapping gesture strokes that accumulate into dense, fragmented
compositions. Each musical phrase spawns a discrete arc; held notes sustain
by retracing the gesture's middle section, building up layers of crisscrossing
lines that evoke the energy of a jazz sketch — think Matisse paper cuts
animated by Coltrane.

---

## The "Line Quirk" — What Creates the Jazz Feel

The signature aesthetic comes from **sustain ping-pong retracing** combined
with **persistent canvas trails**. Here's the exact mechanism:

### 1. Sustain oscillation creates "return strokes"

**File:** `js/core/clipManager.js` — `GestureClip.update()`, SUSTAINING state

When a clip enters sustain (at 85% progress for MIDI, 100% for audio), it
doesn't freeze or loop forward. Instead, it **ping-pongs** through the middle
40% of the gesture path (eased progress 0.3 → 0.7 → 0.3 → …):

```javascript
let phase = (since / halfCycle) % 2.0;
if (phase > 1.0) phase = 2.0 - phase;   // ← ping-pong reversal
phase = easeInOutSine(phase);
const loopT = 0.3 + phase * 0.4;        // ← middle 40% band
```

Each frame pushes a new point to `clip.points[]`. The renderer draws line
segments between consecutive points. When the oscillation reverses direction,
the path **retraces itself** — creating visible "return strokes" that cross
over the forward path. This doubling/overlapping is the core of the jazz feel.

### 2. Positional drift offsets the return strokes

**File:** `js/core/clipManager.js` — sustain drift section

Sine-based positional wander ensures each pass is slightly offset from the
previous one, so the return strokes don't perfectly overlap:

```javascript
driftX = Math.sin(t * 0.7 + this.variation * 10) * this.scale * 5;
driftY = Math.cos(t * 0.5 + this.variation * 7)  * this.scale * 5;
breathWeight = 1 + 0.05 * Math.sin(t * 1.5);   // scale breathing
```

This creates an accumulation of angular, slightly-offset strokes — like a
jazz musician's hand sketching the same phrase with subtle variations.

### 3. Blend-in transition line

**File:** `js/core/clipManager.js` — sustain entry blend

When entering sustain from 85% progress, the clip blends from its current
position back toward the 0.3–0.7 loop range over 0.4 seconds:

```javascript
const blend = Math.min(since / 0.4, 1.0);
pathT = this._sustainEntryT * (1 - blendEased) + loopT * blendEased;
```

This creates a visible connecting line from the late-gesture position back
toward the middle — a "return stroke" that adds to the cubist composition.

### 4. Canvas trail persistence

**File:** `js/visualization/canvas.js` — `fade()` method

The canvas is never fully cleared. Each frame overlays a semi-transparent
dark rectangle (controlled by Trail Fade slider). Older strokes linger for
seconds, so the sustain's crisscrossing paths accumulate into dense texture:

```javascript
fade(alpha) {
    this.ctx.fillStyle = `rgba(10, 10, 15, ${alpha})`;
    this.ctx.fillRect(0, 0, this.width, this.height);
}
```

### 5. Multiple concurrent clips

**File:** `js/core/clipManager.js` — `ClipQueue` (maxConcurrent = 5)

Up to 5 clips render simultaneously from different origins with different
gesture templates. The overlapping arcs from whale, wing, spiral, scatter
etc. create a fragmented, multi-perspective composition.

### 6. Per-segment rendering (no single path)

**File:** `js/visualization/traceRenderer.js` — `_renderClip()`

Each point-to-point segment is drawn as an individual `beginPath()` +
`stroke()` call with its own alpha, color, and weight. This means weight
and opacity can vary within a single gesture, giving a brush-like quality
where strokes thicken and thin.

---

## MIDI Responsiveness

| Metric | Value |
|--------|-------|
| Note-on → clip spawn | ~3–5ms (event-driven) |
| Audio FFT latency | ~12ms (fftSize 1024) |
| Sustain entry | At 85% of gesture duration |
| Sustain loop range | Eased progress 0.3 – 0.7 |
| Release tail | Proportional to remaining path |
| Max concurrent clips | 5 |
| Clip spawn cooldown | 120ms |

---

## Key Parameters for the Jazz Aesthetic

Adjusting these changes the character significantly:

| Parameter | Jazz Value | Location |
|-----------|-----------|----------|
| Sustain ping-pong | ON (0.3→0.7) | `clipManager.js` SUSTAINING state |
| Drift magnitude | `scale * 5` px | `clipManager.js` sustain drift |
| Scale breathing | ±5% | `clipManager.js` breathWeight |
| Blend-in time | 0.4s | `clipManager.js` sustain blend |
| Canvas fade | rgba alpha 0.005–0.12 | `canvas.js` fade() |
| Max concurrent | 5 clips | `clipManager.js` ClipQueue |
| Sustain entry | 85% progress | `clipManager.js` sustainThreshold |
| Template count | 11 vocabularies | `blendingEngine.js` TEMPLATES |

---

## File Manifest

```
js/
  main.js                    — App controller, input mode switching
  audio/
    audioAnalyzer.js         — Web Audio API, low-latency FFT
    featureExtraction.js     — Amplitude, bands, onset, phrase detection
    parameterMapping.js      — Feature → movement param mapping
  core/
    clipManager.js           — GestureClip + ClipQueue (sustain/release)
  input/
    midiManager.js           — Web MIDI + MPE support
  movement/
    blendingEngine.js        — 11 gesture templates + clip factories
    movementVocabulary.js    — Vocabulary definitions
    naturalMotions.js        — Natural motion patterns
    bvhParser.js             — BVH file parser
  visualization/
    canvas.js                — Canvas setup, fade, DPR
    traceRenderer.js         — Clip → canvas rendering
    effects.js               — Visual effects
  utils/
    config.js                — Central configuration
    helpers.js               — Utility functions
css/
  main.css                   — Base styles
  controls.css               — Control panel + MIDI UI
  responsive.css             — Responsive breakpoints
index.html                   — Entry point
```
