/* =====================================================================
   Every surface on the page is painted here at boot: no photographs.
   ===================================================================== */
import * as THREE from 'three';
import { TAU, clamp, lerp, sat, smooth, mulberry32, noise2D, fbm, tileNoise } from './util.js';

export function cvs(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/* Canvas pixels are premultiplied; uploading them that way keeps light
   shapes on a transparent ground from growing a dark fringe. */
function canvasTex(c, { srgb = true, premul = true, aniso = 4 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.premultiplyAlpha = premul;
  t.anisotropy = aniso;
  return t;
}

function dataTex(data, w, h, { srgb = false, repeat = false } = {}) {
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

/* ------------------------------------------------------------ the moon */
/* The Mid-Autumn moon. Seas at roughly their near-side places (u right,
   v down), a scatter of craters, Tycho's rays, a gentle limb. */
const MARIA = [
  [-0.40, -0.30, 0.33, 1.0],   // Imbrium
  [-0.62, 0.04, 0.40, 0.85],   // Procellarum
  [0.13, -0.40, 0.19, 0.95],   // Serenitatis
  [0.31, -0.09, 0.23, 0.9],    // Tranquillitatis
  [0.67, -0.30, 0.12, 1.0],    // Crisium, the one that stands on its own
  [0.56, 0.13, 0.17, 0.8],     // Fecunditatis
  [0.31, 0.31, 0.11, 0.72],    // Nectaris
  [-0.21, 0.37, 0.19, 0.7],    // Nubium
  [-0.52, 0.37, 0.11, 0.72],   // Humorum
  [-0.04, -0.73, 0.29, 0.5],   // Frigoris
];

export function moonTexture(S = 384) {
  const data = new Uint8Array(S * S * 4);
  const n1 = noise2D(11), n2 = noise2D(23), n3 = noise2D(37);
  const rnd = mulberry32(5);
  const craters = [];
  for (let i = 0; i < 44; i++) {
    const a = rnd() * TAU, r = Math.sqrt(rnd()) * 0.93;
    craters.push([Math.cos(a) * r, Math.sin(a) * r, 0.012 + Math.pow(rnd(), 3) * 0.07]);
  }
  const TY = [-0.16, 0.71];          // Tycho
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = ((x + 0.5) / S) * 2 - 1, v = ((y + 0.5) / S) * 2 - 1;
      const r = Math.min(Math.hypot(u, v), 1);
      const lob = 0.22 * n1(u * 3.3, v * 3.3);
      let m = 0;
      for (const [mu, mv, mr, md] of MARIA) {
        const dd = Math.hypot(u - mu, v - mv) / (mr * (1 + lob));
        if (dd < 1.1) m = Math.max(m, md * (1 - smooth(0.68, 1.06, dd)));
      }
      m *= 0.78 + 0.22 * (0.5 + 0.5 * fbm(n2, u * 5, v * 5, 4));
      let b = lerp(1, 0.62, m);
      b *= 0.9 + 0.1 * (0.5 + 0.5 * fbm(n3, u * 22, v * 22, 3));
      for (const [cu, cv, cr] of craters) {
        const dd = Math.hypot(u - cu, v - cv) / cr;
        if (dd < 1.6) {
          b *= 1 - 0.15 * (1 - smooth(0.25, 0.95, dd)) * (1 - m * 0.5);
          b *= 1 + 0.1 * Math.exp(-Math.pow((dd - 1) * 5, 2));
        }
      }
      /* Tycho's rays, thrown clear across the southern highlands */
      const tu = u - TY[0], tv = v - TY[1], td = Math.hypot(tu, tv);
      if (td > 0.05) {
        const ray = Math.pow(0.5 + 0.5 * Math.sin(Math.atan2(tv, tu) * 9 + n1(tu * 2, tv * 2) * 3), 14);
        b *= 1 + 0.12 * ray * Math.exp(-td * 2.2) * (1 - m);
      }
      b *= 0.74 + 0.26 * Math.pow(Math.sqrt(Math.max(0, 1 - r * r)), 0.6);
      const o = ((S - 1 - y) * S + x) * 4;          /* data rows run bottom-up */
      data[o] = clamp(255 * b, 0, 255);
      data[o + 1] = clamp(238 * b * (1 - 0.05 * m), 0, 255);
      data[o + 2] = clamp(204 * b * (1 - 0.12 * m), 0, 255);
      /* a one-pixel feather on the limb: a moon in air, not a cut disc */
      data[o + 3] = 255 * sat((1 - Math.hypot(u, v)) * S * 0.5);
    }
  }
  return dataTex(data, S, S, { srgb: true });
}

/* ------------------------------------------------------------ the river */
/* A tiling height field turned into a normal map: blur-free, because the
   water shader samples it at three scales and the scales do the blending. */
export function waterNormalTexture(S = 256) {
  const ns = [tileNoise(4, 3), tileNoise(8, 5), tileNoise(16, 9), tileNoise(32, 13), tileNoise(64, 17)];
  const H = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let h = 0, a = 1;
      for (let k = 0; k < ns.length; k++) {
        const P = 4 << k;
        h += a * ns[k]((x / S) * P, (y / S) * P);
        a *= 0.55;
      }
      H[y * S + x] = h;
    }
  }
  const data = new Uint8Array(S * S * 4), k = 2.4;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const xl = (x - 1 + S) % S, xr = (x + 1) % S, yu = (y - 1 + S) % S, yd = (y + 1) % S;
      const nx = -(H[y * S + xr] - H[y * S + xl]) * k, ny = -(H[yd * S + x] - H[yu * S + x]) * k;
      const l = Math.hypot(nx, ny, 1), o = (y * S + x) * 4;
      data[o] = (nx / l * 0.5 + 0.5) * 255;
      data[o + 1] = (ny / l * 0.5 + 0.5) * 255;
      data[o + 2] = (1 / l * 0.5 + 0.5) * 255;
      data[o + 3] = 255;
    }
  }
  return dataTex(data, S, S, { repeat: true });
}

/* soft slab of mist, white, alpha only */
export function hazeTexture(W = 256, H = 128, seed = 21) {
  const n = noise2D(seed), data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = (x / W) * 2 - 1, v = (y / H) * 2 - 1;
      const e = Math.exp(-(u * u * 2.2 + v * v * 6.5));
      const k = 0.5 + 0.5 * fbm(n, u * 2.6 + 3, v * 5.2, 5);
      const o = (y * W + x) * 4;
      data[o] = data[o + 1] = data[o + 2] = 255;
      data[o + 3] = 255 * sat(e * (0.3 + 0.95 * k) - 0.06);
    }
  }
  return dataTex(data, W, H);
}

/* one phượng petal, white on transparent — tinted per instance */
export function petalTexture(S = 64) {
  const c = cvs(S, S), g = c.getContext('2d');
  g.translate(S / 2, S * 0.94);
  const petal = new Path2D();
  petal.moveTo(0, 0);
  petal.bezierCurveTo(-S * 0.08, -S * 0.2, -S * 0.44, -S * 0.42, -S * 0.32, -S * 0.7);
  petal.bezierCurveTo(-S * 0.22, -S * 0.9, S * 0.2, -S * 0.9, S * 0.32, -S * 0.7);
  petal.bezierCurveTo(S * 0.44, -S * 0.42, S * 0.08, -S * 0.2, 0, 0);
  g.fillStyle = '#fff';
  g.fill(petal);
  g.save();
  g.clip(petal);
  /* the narrow claw is darker, and a few veins fan out from it */
  const grd = g.createLinearGradient(0, 0, 0, -S * 0.8);
  grd.addColorStop(0, 'rgba(70,20,10,.75)');
  grd.addColorStop(0.35, 'rgba(70,20,10,0)');
  g.fillStyle = grd;
  g.fillRect(-S, -S, S * 2, S * 2);
  g.strokeStyle = 'rgba(90,20,10,.22)';
  g.lineWidth = 0.8;
  for (let i = -3; i <= 3; i++) {
    g.beginPath();
    g.moveTo(0, -S * 0.05);
    g.quadraticCurveTo(i * S * 0.05, -S * 0.45, i * S * 0.09, -S * 0.82);
    g.stroke();
  }
  g.restore();
  return canvasTex(c);
}

/* ------------------------------------------------------------ the foreground cut-outs */
/* Light comes from the moon, up and to the right: rims catch on the right. */

/* the riverbank's tall grass, with a few silvergrass (cỏ lau) plumes */
export function reedsTexture(seed = 3, tone = 0, W = 1024, H = 512) {
  const c = cvs(W, H), g = c.getContext('2d');
  const rnd = mulberry32(seed), n = noise2D(seed);
  const ground = (x) => H * (0.88 - 0.06 * Math.sin((x / W) * Math.PI) + 0.025 * n((x / W) * 5, 1.3));

  g.fillStyle = tone ? '#0b1214' : '#040607';
  g.beginPath();
  g.moveTo(0, H);
  for (let x = 0; x <= W; x += 8) g.lineTo(x, ground(x));
  g.lineTo(W, H);
  g.closePath();
  g.fill();

  const layers = tone
    ? [{ n: 300, len: [0.16, 0.42], w: [1, 2.2], col: '#141c1e' }, { n: 220, len: [0.2, 0.5], w: [1.3, 2.8], col: '#10181a' }]
    : [
        { n: 340, len: [0.18, 0.52], w: [1.2, 2.6], col: '#0c1312' },
        { n: 260, len: [0.24, 0.64], w: [1.6, 3.4], col: '#080d0c' },
        { n: 150, len: [0.3, 0.8], w: [2.2, 4.6], col: '#040706' },
      ];
  for (const L of layers) {
    for (let i = 0; i < L.n; i++) {
      const x0 = rnd() * W, y0 = ground(x0) + rnd() * H * 0.06;
      const len = H * lerp(L.len[0], L.len[1], Math.pow(rnd(), 0.8));
      const lean = (rnd() - 0.5) * 0.7 + ((x0 / W) - 0.5) * 0.5;
      const w = lerp(L.w[0], L.w[1], rnd());
      const tx = x0 + lean * len * 0.7, ty = y0 - len;
      const cx = x0 + lean * len * 0.12, cy = y0 - len * 0.55;
      g.beginPath();
      g.moveTo(x0 - w, y0);
      g.quadraticCurveTo(cx - w * 0.4, cy, tx, ty);
      g.quadraticCurveTo(cx + w * 0.4, cy, x0 + w, y0);
      g.closePath();
      g.fillStyle = L.col;
      g.fill();
      if (rnd() < 0.35) {
        g.strokeStyle = `rgba(196,176,128,${0.05 + rnd() * 0.1})`;
        g.lineWidth = 0.7;
        g.beginPath();
        g.moveTo(x0 + w * 0.6, y0 - len * 0.1);
        g.quadraticCurveTo(cx + w * 0.4, cy, tx, ty);
        g.stroke();
      }
    }
  }

  const plumes = tone ? 10 : 24;
  for (let i = 0; i < plumes; i++) {
    const x0 = rnd() * W, y0 = ground(x0);
    const len = H * lerp(0.48, 0.86, rnd()), lean = (rnd() - 0.5) * 0.5;
    const tx = x0 + lean * len * 0.6, ty = y0 - len;
    g.strokeStyle = tone ? '#121a1b' : '#090e0d';
    g.lineWidth = 1.4;
    g.beginPath();
    g.moveTo(x0, y0);
    g.quadraticCurveTo(x0 + lean * len * 0.1, y0 - len * 0.5, tx, ty);
    g.stroke();
    for (let k = 0; k < 80; k++) {
      const s = 1 - rnd() * 0.2;
      const px = lerp(x0, tx, s), py = lerp(y0, ty, s);
      const a = -Math.PI / 2 + lean + 0.55 + (rnd() - 0.5) * 1.5;
      const l = 6 + rnd() * 18;
      g.strokeStyle = `rgba(222,206,170,${(0.05 + rnd() * 0.15) * (tone ? 0.6 : 1)})`;
      g.lineWidth = 0.8;
      g.beginPath();
      g.moveTo(px, py);
      g.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l + l * 0.4);
      g.stroke();
    }
  }
  return canvasTex(c);
}

/* dừa nước, the nipa palm that lines the Saigon River's banks */
export function nipaTexture(seed = 5, W = 1024, H = 1024) {
  const c = cvs(W, H), g = c.getContext('2d'), rnd = mulberry32(seed);
  const fronds = 8;
  for (let f = 0; f < fronds; f++) {
    const t = f / (fronds - 1);
    const bx = W * (0.03 + 0.2 * rnd()), by = H * 1.03;
    const ang = lerp(-2.0, -0.62, t) + (rnd() - 0.5) * 0.14;
    const len = H * lerp(0.74, 1.04, rnd()) * (1 - Math.abs(t - 0.4) * 0.3);
    const droop = len * lerp(0.16, 0.42, rnd());
    const cx = bx + Math.cos(ang) * len * 0.62, cy = by + Math.sin(ang) * len * 0.62;
    const tx = bx + Math.cos(ang) * len, ty = by + Math.sin(ang) * len + droop;
    const P = (s) => [
      (1 - s) * (1 - s) * bx + 2 * (1 - s) * s * cx + s * s * tx,
      (1 - s) * (1 - s) * by + 2 * (1 - s) * s * cy + s * s * ty,
    ];
    const T = (s) => {
      const dx = 2 * (1 - s) * (cx - bx) + 2 * s * (tx - cx), dy = 2 * (1 - s) * (cy - by) + 2 * s * (ty - cy);
      const l = Math.hypot(dx, dy);
      return [dx / l, dy / l];
    };
    const shade = f % 2 ? '#050907' : '#070d09';
    for (let s = 0.1; s < 0.99; s += 0.015) {
      const [px, py] = P(s), [ux, uy] = T(s);
      const L = len * 0.21 * Math.sin(Math.PI * Math.min(1, (s - 0.04) / 0.96)) * (0.75 + rnd() * 0.4);
      for (const side of [-1, 1]) {
        const nx = -uy * side, ny = ux * side;
        let dx = ux * 0.55 + nx * 0.8, dy = uy * 0.55 + ny * 0.8 + 0.38;
        const dl = Math.hypot(dx, dy);
        dx /= dl; dy /= dl;
        const ex = px + dx * L, ey = py + dy * L + L * 0.12;
        const mx = px + dx * L * 0.5, my = py + dy * L * 0.5;
        const w = Math.max(1.3, L * 0.065);
        g.beginPath();
        g.moveTo(px, py);
        g.quadraticCurveTo(mx - dy * w, my + dx * w, ex, ey);
        g.quadraticCurveTo(mx + dy * w, my - dx * w, px, py);
        g.fillStyle = shade;
        g.fill();
        if (rnd() < 0.16) {
          g.strokeStyle = `rgba(170,170,130,${0.05 + rnd() * 0.08})`;
          g.lineWidth = 0.7;
          g.beginPath();
          g.moveTo(mx, my);
          g.lineTo(ex, ey);
          g.stroke();
        }
      }
    }
    for (let s = 0; s < 1; s += 0.02) {
      const [ax, ay] = P(s), [bx2, by2] = P(Math.min(1, s + 0.025));
      g.strokeStyle = '#0a0f0b';
      g.lineWidth = lerp(9, 1.2, s);
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(ax, ay);
      g.lineTo(bx2, by2);
      g.stroke();
    }
  }
  return canvasTex(c);
}

/* a phượng (flame tree) bough leaning into the top of frame, in bloom */
export function phuongTexture(seed = 9, W = 1024, H = 768) {
  const c = cvs(W, H), g = c.getContext('2d'), rnd = mulberry32(seed);
  const branches = [];
  function limb(x, y, ang, len, width, depth) {
    const steps = 12;
    let px = x, py = y, a = ang;
    const pts = [[px, py]];
    for (let i = 0; i < steps; i++) {
      a += (rnd() - 0.5) * 0.2 + 0.015;
      px += (Math.cos(a) * len) / steps;
      py += (Math.sin(a) * len) / steps;
      pts.push([px, py]);
    }
    branches.push({ pts, width, depth, a });
    if (depth < 3) {
      const kids = 4 - depth;
      for (let k = 0; k < kids; k++) {
        const i = 3 + Math.floor(rnd() * (steps - 4));
        const [bx, by] = pts[i];
        limb(bx, by, a + (rnd() < 0.5 ? -1 : 1) * (0.45 + rnd() * 0.6), len * (0.42 + rnd() * 0.2), width * 0.55, depth + 1);
      }
    }
  }
  limb(W * 1.03, H * 0.0, Math.PI * 0.82, W * 0.7, 18, 0);

  g.lineCap = 'round';
  for (const b of branches) {
    for (let i = 0; i < b.pts.length - 1; i++) {
      g.strokeStyle = '#0e0908';
      g.lineWidth = lerp(b.width, b.width * 0.45, i / b.pts.length);
      g.beginPath();
      g.moveTo(b.pts[i][0], b.pts[i][1]);
      g.lineTo(b.pts[i + 1][0], b.pts[i + 1][1]);
      g.stroke();
    }
  }

  /* bipinnate leaves: fern-like, a rachis of pinnae, each a ladder of leaflets */
  function leaf(x, y, a, L) {
    const pinnae = 9;
    g.strokeStyle = '#0a110c';
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * L, y + Math.sin(a) * L);
    g.stroke();
    for (let p = 0; p < pinnae; p++) {
      const s = (p + 1) / (pinnae + 1);
      const px = x + Math.cos(a) * L * s, py = y + Math.sin(a) * L * s;
      const pl = L * 0.34 * Math.sin(Math.PI * (0.2 + s * 0.8));
      for (const side of [-1, 1]) {
        const pa = a + side * 1.05;
        for (let q = 0; q < 9; q++) {
          const t = (q + 0.5) / 9;
          const lx = px + Math.cos(pa) * pl * t, ly = py + Math.sin(pa) * pl * t + t * t * pl * 0.25;
          g.fillStyle = q % 3 ? '#08100b' : '#0b150e';
          for (const s2 of [-1, 1]) {
            g.beginPath();
            g.ellipse(lx + Math.cos(pa + s2 * 1.4) * 2.4, ly + Math.sin(pa + s2 * 1.4) * 2.4, 3.1, 1.2, pa + s2 * 0.9, 0, TAU);
            g.fill();
          }
        }
      }
    }
  }
  for (const b of branches) {
    if (b.depth < 1) continue;
    for (let i = 2; i < b.pts.length; i += 2) {
      const [x, y] = b.pts[i];
      const a = b.a + Math.PI * 0.35 + (rnd() - 0.5) * 1.2;
      leaf(x, y, a, 60 + rnd() * 70);
    }
  }

  /* flowers: four scarlet petals and one standard flecked with gold */
  function flower(x, y, r, rot) {
    for (let p = 0; p < 5; p++) {
      const a = rot + (p / 5) * TAU;
      const std = p === 0;
      const pr = r * (std ? 1.1 : 1);
      const px = x + Math.cos(a) * pr * 0.55, py = y + Math.sin(a) * pr * 0.55;
      const grd = g.createRadialGradient(x, y, 0, px, py, pr * 0.7);
      grd.addColorStop(0, std ? '#f2d2a0' : '#8f160f');
      grd.addColorStop(0.45, std ? '#d9482a' : '#c7261b');
      grd.addColorStop(1, std ? '#e8643a' : '#dc3a26');
      g.fillStyle = grd;
      g.beginPath();
      g.ellipse(px, py, pr * 0.62, pr * 0.42, a, 0, TAU);
      g.fill();
      if (std) {
        g.strokeStyle = 'rgba(255,236,200,.7)';
        g.lineWidth = 0.7;
        for (let k = -1; k <= 1; k++) {
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(px + Math.cos(a + k * 0.4) * pr * 0.4, py + Math.sin(a + k * 0.4) * pr * 0.4);
          g.stroke();
        }
      }
    }
    g.strokeStyle = '#c22a1c';
    g.lineWidth = 0.8;
    for (let k = 0; k < 8; k++) {
      const a = rot + 0.3 + (k / 8) * 1.6;
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(x + Math.cos(a) * r * 0.6, y + Math.sin(a) * r * 0.6 - 2, x + Math.cos(a) * r * 1.05, y + Math.sin(a) * r * 1.05);
      g.stroke();
    }
  }
  for (const b of branches) {
    if (b.depth < 2) continue;
    const [x, y] = b.pts[b.pts.length - 1];
    const count = 6 + Math.floor(rnd() * 9);
    for (let k = 0; k < count; k++) {
      const a = rnd() * TAU, d = Math.sqrt(rnd()) * 34;
      flower(x + Math.cos(a) * d, y + Math.sin(a) * d * 0.8 + 6, 6.5 + rnd() * 5.5, rnd() * TAU);
    }
    for (let k = 0; k < 6; k++) {
      g.fillStyle = '#7d1610';
      g.beginPath();
      g.arc(x + (rnd() - 0.5) * 50, y + (rnd() - 0.5) * 40, 2.5 + rnd() * 2, 0, TAU);
      g.fill();
    }
  }
  return canvasTex(c);
}

/* ------------------------------------------------------------ the giant wordmark */
/* The word is set to the canvas width. The vertical wash is baked across the
   whole word so every letter shares one ramp, then weathered a little. */
export function wordmarkTexture(text = 'QUYET') {
  const fam = '"Be Vietnam Pro", system-ui, -apple-system, sans-serif';
  const W = 2048, track = 0.15, rnd = mulberry32(81);
  const m = cvs(8, 8).getContext('2d');
  let size = 300;
  m.font = `600 ${size}px ${fam}`;
  const glyphs = [...text];
  let widths = glyphs.map((ch) => m.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0) + track * size * (glyphs.length - 1);
  const k = (W * 0.97) / total;
  size *= k;
  widths = widths.map((w) => w * k);
  m.font = `600 ${size}px ${fam}`;
  const asc = m.measureText(text).actualBoundingBoxAscent || size * 0.72;
  const pad = Math.round(size * 0.05);
  const H = Math.ceil(asc + pad * 2);

  const c = cvs(W, H), g = c.getContext('2d');
  g.font = `600 ${size}px ${fam}`;
  g.textBaseline = 'alphabetic';
  const grd = g.createLinearGradient(0, pad, 0, H - pad);
  grd.addColorStop(0, '#f1f5f0');
  grd.addColorStop(0.55, '#d6dfd8');
  grd.addColorStop(1, '#a3ada6');
  g.fillStyle = grd;
  let x = (W - (widths.reduce((a, b) => a + b, 0) + track * size * (glyphs.length - 1))) / 2;
  glyphs.forEach((ch, i) => {
    g.fillText(ch, x, H - pad);
    x += widths[i] + track * size;
  });
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 2400; i++) {
    g.globalAlpha = rnd() * 0.32;
    g.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 2.5, 1 + rnd() * 2.5);
  }
  g.globalCompositeOperation = 'source-over';
  g.globalAlpha = 1;
  return { texture: canvasTex(c, { aniso: 8 }), aspect: W / H };
}

/* ------------------------------------------------------------ film grain for the CSS overlay */
export function grainDataURL(S = 192) {
  const c = cvs(S, S), g = c.getContext('2d'), img = g.createImageData(S, S), rnd = mulberry32(2);
  for (let i = 0; i < S * S; i++) {
    const v = 128 + (rnd() + rnd() + rnd() - 1.5) * 110;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = clamp(v, 0, 255);
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}
