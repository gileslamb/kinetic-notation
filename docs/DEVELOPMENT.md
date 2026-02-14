# Development Guide

## Prerequisites

- A modern browser (Chrome 90+, Firefox 90+, Edge 90+, Safari 15+)
- Any static file server (see README for options)
- Microphone access (for live audio input)

## Architecture Overview

Kinetic Notation uses a modular ES6 architecture with no build step:

```
Audio Input → AudioAnalyzer → FeatureExtraction → ParameterMapping
                                                        ↓
Canvas ← TraceRenderer ← BlendingEngine ← MovementVocabulary
                ↓
            Effects (glow, particles)
```

### Data Flow (per frame)

1. **AudioAnalyzer** reads FFT and time-domain data from Web Audio API
2. **FeatureExtraction** computes amplitude, pitch, brightness, onset, frequency bands
3. **ParameterMapping** translates features into movement parameters (velocity, curvature, turbulence, etc.)
4. **MovementVocabulary** + **BlendingEngine** produce displacement vectors using natural motion algorithms
5. **TraceRenderer** draws smooth Bezier-interpolated lines on the canvas
6. **Effects** adds glow, particles, and ambient background

### Module Contracts

Each module exposes a clean API. Modules communicate through the main App controller — no direct cross-module imports except for shared utilities.

## Coding Conventions

- **ES6 modules** with `import`/`export`
- **Singleton pattern** for stateful managers (AudioAnalyzer, CanvasManager, etc.)
- **JSDoc** annotations on all public functions
- **Const-first** — prefer `const`, use `let` only when reassignment is needed
- **No `var`** — ever
- **camelCase** for variables and functions, **PascalCase** for classes
- **SCREAMING_SNAKE** for true constants in enums

## Performance Guidelines

- Target **60fps** on mid-range hardware
- Use `requestAnimationFrame` for the render loop
- Avoid allocations in the hot loop (pre-allocate buffers)
- Limit canvas state changes (batch draws by style)
- Use `ctx.setTransform()` instead of repeated `scale()`/`translate()`
- Profile with Chrome DevTools Performance tab

## Adding a New Motion Type

1. Define the type name in `movementVocabulary.js` → `MotionTypes`
2. Implement the motion function in `naturalMotions.js`
3. Register it in `getMotion()` lookup
4. Add mapping rules in `parameterMapping.js`
5. Test with the demo mode before wiring to audio

## Browser Compatibility

| Feature          | Chrome | Firefox | Safari | Edge |
| ---------------- | ------ | ------- | ------ | ---- |
| Web Audio API    | Yes    | Yes     | Yes    | Yes  |
| ES6 Modules      | Yes    | Yes     | Yes    | Yes  |
| Canvas 2D        | Yes    | Yes     | Yes    | Yes  |
| getUserMedia     | Yes    | Yes     | Yes    | Yes  |
| desynchronized   | Yes    | No*     | No*    | Yes  |

*Falls back gracefully — no visual difference, slightly higher latency.
