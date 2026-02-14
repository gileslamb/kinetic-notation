# Kinetic Notation

An audio-reactive visualization system that translates music into organic movement patterns. Live audio is captured and analyzed, then mapped to natural motion vocabularies — a slow descending melody moves like a drifting leaf, not just a declining graph.

## Tech Stack

- **Vanilla JavaScript** (ES6+ modules)
- **Web Audio API** — real-time FFT, pitch detection, feature extraction
- **HTML5 Canvas** — 2D trace rendering at 60fps
- **No frameworks or build tools** — zero dependencies for the core engine

## Features (Planned)

- Live microphone and audio file input
- Real-time frequency, amplitude, pitch, and timbre analysis
- 7+ organic motion patterns (drift, pulse, spiral, cascade, flutter, surge, scatter)
- Intelligent audio-to-movement mapping with smooth blending
- BVH motion capture data integration
- 4 color presets (Ember, Ocean, Forest, Void)
- Responsive UI with keyboard shortcuts

## Local Development

No build step required. Serve the project with any static file server:

```bash
# Option 1: Python
python3 -m http.server 8000

# Option 2: Node.js (npx, no install)
npx serve .

# Option 3: PHP
php -S localhost:8000

# Option 4: VS Code / Cursor
# Install "Live Server" extension → right-click index.html → "Open with Live Server"
```

Then open [http://localhost:8000](http://localhost:8000) in a modern browser (Chrome/Edge recommended for best Web Audio API support).

> **Note:** The app must be served over HTTP (not opened as a `file://` URL) because ES6 modules require a server and the Web Audio API requires a secure context for microphone access.

## Keyboard Shortcuts

| Key     | Action               |
| ------- | -------------------- |
| `Space` | Start / Pause        |
| `C`     | Clear canvas         |
| `H`     | Toggle control panel |

## Project Structure

```
kinetic-notation/
├── index.html              # Entry point
├── css/
│   ├── main.css            # Full-screen canvas, dark theme
│   ├── controls.css        # Control panel UI
│   └── responsive.css      # Mobile/tablet adaptations
├── js/
│   ├── main.js             # App controller & render loop
│   ├── audio/
│   │   ├── audioAnalyzer.js       # Web Audio API integration
│   │   ├── featureExtraction.js   # Pitch, onset, timbre analysis
│   │   └── parameterMapping.js    # Audio features → movement params
│   ├── movement/
│   │   ├── movementVocabulary.js  # Motion type registry
│   │   ├── naturalMotions.js      # Motion implementations
│   │   ├── bvhParser.js           # BVH motion capture parser
│   │   └── blendingEngine.js      # Cross-fade between motions
│   ├── visualization/
│   │   ├── canvas.js              # Canvas setup & resize handling
│   │   ├── traceRenderer.js       # Bezier trace drawing
│   │   └── effects.js             # Glow, particles, ambience
│   └── utils/
│       ├── config.js              # Central configuration
│       └── helpers.js             # Utility functions
├── data/
│   ├── motion-capture/            # BVH files (Sprint 6)
│   └── presets/                   # Saved parameter presets
└── docs/
    ├── DEVELOPMENT.md             # Development guide
    ├── DEPLOYMENT.md              # Deployment instructions
    └── API.md                     # Module API reference
```

## Development Roadmap

| Sprint | Focus                        | Status      |
| ------ | ---------------------------- | ----------- |
| 1      | Foundation & Architecture    | Complete    |
| 2      | Audio Analysis Engine        | Up next     |
| 3      | Movement Vocabulary Library  | Planned     |
| 4      | Intelligent Mapping Engine   | Planned     |
| 5      | Trace Visualization System   | Planned     |
| 6      | BVH Motion Capture           | Planned     |
| 7      | Polish & Optimization        | Planned     |
| 8      | Deployment (Render → DO)     | Planned     |

## Deployment

Deployment instructions coming in Sprint 8. Target: Render static site → Digital Ocean.

## License

All rights reserved.
