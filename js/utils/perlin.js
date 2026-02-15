/**
 * Kinetic Notation — 2D Simplex Noise
 *
 * Fast, self-contained 2D simplex noise. No dependencies.
 * Returns values in -1 to +1 for any (x, y) coordinate.
 *
 * PERFORMANCE: ~0.002ms per call (500,000+/sec on modern hardware).
 * At 60fps with 5 clips, that's ~300 calls/frame → well under 1ms.
 *
 * Based on Stefan Gustavson's simplex noise implementation,
 * adapted for ES module export and minimal footprint.
 */

// ─── Gradient table ──────────────────────────────────

const GRAD = [
    [1,1],[-1,1],[1,-1],[-1,-1],
    [1,0],[-1,0],[0,1],[0,-1],
];

// Permutation table (256 entries, doubled to avoid wrapping)
const P = new Uint8Array(512);
const PERM_BASE = [
    151,160,137,91,90,15,131,13,201,95,96,53,194,233,7,225,
    140,36,103,30,69,142,8,99,37,240,21,10,23,190,6,148,
    247,120,234,75,0,26,197,62,94,252,219,203,117,35,11,32,
    57,177,33,88,237,149,56,87,174,20,125,136,171,168,68,175,
    74,165,71,134,139,48,27,166,77,146,158,231,83,111,229,122,
    60,211,133,230,220,105,92,41,55,46,245,40,244,102,143,54,
    65,25,63,161,1,216,80,73,209,76,132,187,208,89,18,169,
    200,196,135,130,116,188,159,86,164,100,109,198,173,186,3,64,
    52,217,226,250,124,123,5,202,38,147,118,126,255,82,85,212,
    207,206,59,227,47,16,58,17,182,189,28,42,223,183,170,213,
    119,248,152,2,44,154,163,70,221,153,101,155,167,43,172,9,
    129,22,39,253,19,98,108,110,79,113,224,232,178,185,112,104,
    218,246,97,228,251,34,242,193,238,210,144,12,191,179,162,241,
    81,51,145,235,249,14,239,107,49,192,214,31,181,199,106,157,
    184,84,204,176,115,121,50,45,127,4,150,254,138,236,205,93,
    222,114,67,29,24,72,243,141,128,195,78,66,215,61,156,180,
];
for (let i = 0; i < 256; i++) { P[i] = P[i + 256] = PERM_BASE[i]; }

// ─── Skew constants for 2D simplex ──────────────────

const F2 = 0.5 * (Math.sqrt(3.0) - 1.0);  // 0.3660…
const G2 = (3.0 - Math.sqrt(3.0)) / 6.0;  // 0.2113…

// ─── Core simplex 2D ─────────────────────────────────

function dot2(g, x, y) {
    return g[0] * x + g[1] * y;
}

/**
 * 2D simplex noise.
 * @param {number} x
 * @param {number} y
 * @returns {number} -1 to +1
 */
export function noise2D(x, y) {
    // Skew input space to determine simplex cell
    const s = (x + y) * F2;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);

    const t = (i + j) * G2;
    const X0 = i - t;
    const Y0 = j - t;
    const x0 = x - X0;
    const y0 = y - Y0;

    // Determine which simplex triangle we're in
    let i1, j1;
    if (x0 > y0) { i1 = 1; j1 = 0; }
    else          { i1 = 0; j1 = 1; }

    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1.0 + 2.0 * G2;
    const y2 = y0 - 1.0 + 2.0 * G2;

    const ii = i & 255;
    const jj = j & 255;

    // Contribution from three corners
    let n0 = 0, n1 = 0, n2 = 0;

    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 >= 0) {
        t0 *= t0;
        const gi0 = P[ii + P[jj]] & 7;
        n0 = t0 * t0 * dot2(GRAD[gi0], x0, y0);
    }

    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 >= 0) {
        t1 *= t1;
        const gi1 = P[ii + i1 + P[jj + j1]] & 7;
        n1 = t1 * t1 * dot2(GRAD[gi1], x1, y1);
    }

    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 >= 0) {
        t2 *= t2;
        const gi2 = P[ii + 1 + P[jj + 1]] & 7;
        n2 = t2 * t2 * dot2(GRAD[gi2], x2, y2);
    }

    // Scale to [-1, 1]
    return 70.0 * (n0 + n1 + n2);
}

/**
 * Fractional Brownian Motion — layered noise for richer texture.
 * @param {number} x
 * @param {number} y
 * @param {number} octaves  1–4 (more = richer, slower)
 * @param {number} lacunarity  frequency multiplier per octave (default 2)
 * @param {number} gain  amplitude multiplier per octave (default 0.5)
 * @returns {number} approximately -1 to +1
 */
export function fbm(x, y, octaves = 3, lacunarity = 2.0, gain = 0.5) {
    let value = 0;
    let amplitude = 1.0;
    let frequency = 1.0;
    let maxAmp = 0;

    for (let i = 0; i < octaves; i++) {
        value += amplitude * noise2D(x * frequency, y * frequency);
        maxAmp += amplitude;
        amplitude *= gain;
        frequency *= lacunarity;
    }

    return value / maxAmp;  // normalise
}
