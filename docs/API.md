# Module API Reference

## js/utils/config.js

Central configuration object. Frozen at the top level.

```js
import Config from './utils/config.js';

Config.canvas.targetFPS      // 60
Config.audio.fftSize          // 2048
Config.presets.ember.colors   // ['#ff6b3d', '#ff9f6b', '#ffd093']
Config.ui.sensitivity         // 50
```

---

## js/utils/helpers.js

Pure utility functions.

| Function | Signature | Description |
|----------|-----------|-------------|
| `clamp` | `(value, min, max) → number` | Clamp value to range |
| `lerp` | `(a, b, t) → number` | Linear interpolation |
| `mapRange` | `(value, inMin, inMax, outMin, outMax) → number` | Remap value between ranges |
| `normalize` | `(value, maxInput) → number` | Normalize to 0–1 |
| `degToRad` | `(deg) → number` | Degrees to radians |
| `distance` | `(x1, y1, x2, y2) → number` | Euclidean distance |
| `smoothDamp` | `(current, target, decay) → number` | Exponential smoothing |
| `throttle` | `(fn, delay) → Function` | Throttle execution |
| `debounce` | `(fn, delay) → Function` | Debounce execution |
| `uid` | `(prefix?) → string` | Generate unique ID |

---

## js/visualization/canvas.js

Singleton `CanvasManager` — handles setup, resize, and drawing context.

| Method | Signature | Description |
|--------|-----------|-------------|
| `init` | `(canvasId?) → CanvasManager` | Initialize canvas element |
| `resize` | `() → void` | Resize to fill viewport |
| `clear` | `(color?) → void` | Clear with background color |
| `fade` | `(alpha) → void` | Apply semi-transparent overlay |
| `destroy` | `() → void` | Clean up listeners |

| Property | Type | Description |
|----------|------|-------------|
| `canvas` | `HTMLCanvasElement` | The canvas element |
| `ctx` | `CanvasRenderingContext2D` | Drawing context |
| `width` | `number` | Logical width (CSS px) |
| `height` | `number` | Logical height (CSS px) |
| `center` | `{x, y}` | Center point |
| `dpr` | `number` | Device pixel ratio |

---

## js/audio/audioAnalyzer.js

*(Sprint 2)* Singleton — Web Audio API integration.

| Method | Description |
|--------|-------------|
| `init(sourceType, audioElement?)` | Initialize audio context |
| `update()` | Read current frame's audio data |
| `getAmplitude()` | Overall loudness 0–1 |
| `getFrequencyData()` | Raw FFT data |
| `getTimeDomainData()` | Waveform data |
| `destroy()` | Clean up |

---

## js/audio/featureExtraction.js

*(Sprint 2)* Stateless functions for audio analysis.

| Function | Returns | Description |
|----------|---------|-------------|
| `extractFeatures(freqData, timeData, sampleRate)` | `AudioFeatures` | All features in one call |
| `detectPitch(timeData, sampleRate)` | `number` | Frequency in Hz |
| `detectOnset(current, previous, threshold?)` | `number` | Onset strength 0–1 |

---

## js/audio/parameterMapping.js

*(Sprint 4)* Map audio features to movement parameters.

| Function | Returns | Description |
|----------|---------|-------------|
| `mapParameters(features, uiParams)` | `MovementParams` | Audio → movement mapping |
| `smooth(current, target, smoothing?)` | `number` | Exponential smoothing |

---

## js/movement/movementVocabulary.js

*(Sprint 3)* Motion type registry.

| Export | Description |
|--------|-------------|
| `MotionTypes` | Enum of motion type names |
| `getMotion(type)` | Get motion function by type |
| `listMotions()` | List all available types |

---

## js/movement/naturalMotions.js

*(Sprint 3)* Individual motion implementations. Each returns `{dx, dy}`.

`drift` · `pulse` · `spiral` · `cascade` · `flutter` · `surge` · `scatter`

---

## js/movement/blendingEngine.js

*(Sprint 4)* Singleton — cross-fades between motion types.

| Method | Description |
|--------|-------------|
| `transitionTo(motionType, duration?)` | Start blending to new motion |
| `update(deltaTime)` | Advance blend state |
| `getBlendedMotion(time, params)` | Get blended displacement |

---

## js/movement/bvhParser.js

*(Sprint 6)* BVH file parsing.

| Function | Returns | Description |
|----------|---------|-------------|
| `parseBVH(bvhText)` | `BVHData` | Parse BVH file |
| `extractJointPath(bvhData, jointName)` | `[{x,y}]` | 2D path from joint |

---

## js/visualization/traceRenderer.js

*(Sprint 5)* Singleton — multi-trace drawing system.

| Method | Description |
|--------|-------------|
| `createTrace(id)` | Create a new trace |
| `addPoint(traceId, x, y, pressure?)` | Add point to trace |
| `render(preset)` | Draw all traces |
| `clear()` | Clear all traces |

---

## js/visualization/effects.js

*(Sprint 5)* Singleton — post-processing effects.

| Method | Description |
|--------|-------------|
| `glow(x, y, color, intensity?)` | Glow at a point |
| `emitParticles(x, y, color, count?)` | Burst particles |
| `updateParticles(deltaTime)` | Tick particle system |
| `backgroundAmbience(time, preset)` | Ambient background |
| `clear()` | Reset all effects |
