/* ------------------------------------------------------------ 0 · basics */
export const params = new URLSearchParams(location.search);
export const REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches || params.has('still');
export const COARSE = matchMedia('(hover: none)').matches;

export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const sat = (v) => clamp(v, 0, 1);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (e0, e1, x) => { const t = sat((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
export const smoother = (t) => t * t * t * (t * (t * 6 - 15) + 10);
export const easeOut = (t) => 1 - Math.pow(1 - t, 3);
export const easeIO = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
/* frame-rate independent damping */
export const damp = (cur, to, rate, dt) => lerp(cur, to, 1 - Math.exp(-rate * dt));

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* classic 2-D gradient noise, roughly −1 … 1 */
export function noise2D(seed) {
  const rnd = mulberry32(seed), p = new Uint8Array(256), perm = new Uint8Array(512);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = (rnd() * (i + 1)) | 0, t = p[i]; p[i] = p[j]; p[j] = t; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const G = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  return function (x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const X = xi & 255, Y = yi & 255, xf = x - xi, yf = y - yi;
    const u = fade(xf), v = fade(yf);
    const g = (h, dx, dy) => { const q = G[h & 7]; return q[0] * dx + q[1] * dy; };
    const aa = perm[perm[X] + Y], ab = perm[perm[X] + Y + 1];
    const ba = perm[perm[X + 1] + Y], bb = perm[perm[X + 1] + Y + 1];
    return lerp(lerp(g(aa, xf, yf), g(ba, xf - 1, yf), u),
                lerp(g(ab, xf, yf - 1), g(bb, xf - 1, yf - 1), u), v);
  };
}

export function fbm(n, x, y, oct = 4, lac = 2, gain = 0.5) {
  let a = 0.5, f = 1, s = 0, m = 0;
  for (let i = 0; i < oct; i++) { s += a * n(x * f, y * f); m += a; a *= gain; f *= lac; }
  return s / m;                                    /* −1 … 1 */
}

/* value noise that wraps every `period` cells, for textures that tile */
export function tileNoise(period, seed) {
  const rnd = mulberry32(seed), P = period, v = new Float32Array(P * P);
  for (let i = 0; i < v.length; i++) v[i] = rnd() * 2 - 1;
  const f = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), u = f(x - xi), w = f(y - yi);
    const x0 = ((xi % P) + P) % P, y0 = ((yi % P) + P) % P, x1 = (x0 + 1) % P, y1 = (y0 + 1) % P;
    return lerp(lerp(v[y0 * P + x0], v[y0 * P + x1], u), lerp(v[y1 * P + x0], v[y1 * P + x1], u), w);
  };
}
