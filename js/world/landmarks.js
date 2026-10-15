import * as THREE from 'three';
import { FOG_GLSL, fogUniforms } from './fog.js';
import { time, hdr, WINDOWS_GLSL } from './lights.js';
import { RIVER, SITES, BANK_Y } from './river.js';
import { lerp } from '../util.js';

/* =====================================================================
   The five stops, each modelled from a handful of parameters:
   Phú Mỹ Bridge · Bến Nhà Rồng · Bitexco · Ba Son Bridge · Landmark 81.
   Local frames: buildings face the river along +z; bridges cross it
   along +x, from the left bank to the right.
   ===================================================================== */

const col = (v) => (v instanceof THREE.Color ? v : new THREE.Color(v));

const FACADE_VS = /* glsl */ `
  varying vec3 vWorld;
  varying vec3 vN;
  varying vec3 vObj;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vObj = position;
    vN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;

/* A lit surface at night: a dark base, floodlight washing up from below,
   moonlight on the faces that turn to it, windows, an LED band sweeping up
   the façade, and a lit crown. */
const FACADE_FS = /* glsl */ `
  uniform vec3 uBase, uWin, uWin2, uUp, uLed, uTop, uFogColor;
  uniform vec2 uGrid, uSize, uLedK;
  uniform float uLit, uGlow, uUpH, uUpY, uRim, uTopY, uMode, uRadius, uSeed, uTime, uFogDensity;
  varying vec3 vWorld;
  varying vec3 vN;
  varying vec3 vObj;
  ${FOG_GLSL}
  ${WINDOWS_GLSL}
  void main() {
    vec3 N = normalize(vN);
    vec3 toCam = cameraPosition - vWorld;
    vec3 V = normalize(toCam);
    float wall = 1.0 - smoothstep(0.55, 0.85, abs(N.y));
    vec2 fc;
    if (uMode < 0.5) {
      vec2 t = vec2(-N.z, N.x);
      float tl = length(t);
      t = tl > 1e-3 ? t / tl : vec2(1.0, 0.0);
      fc = vec2(dot(vWorld.xz, t), vWorld.y);
    } else {
      fc = vec2(atan(vObj.z, vObj.x) * uRadius, vWorld.y);
    }
    vec4 W = windows(fc, uGrid, uSize, uLit, uSeed, uWin, uWin2);
    vec3 c = uBase;
    c += uUp * exp(-max(vWorld.y - uUpY, 0.0) / uUpH) * wall;
    c += vec3(0.05, 0.04, 0.03) * uRim * pow(max(dot(N, MOON_DIR), 0.0), 2.0);
    c = mix(c, W.rgb * uGlow, W.a * wall);
    float led = exp(-pow(fract(vWorld.y * uLedK.x - uTime * uLedK.y) - 0.5, 2.0) * 160.0);
    c += uLed * led * wall;
    c += uTop * smoothstep(uTopY - 0.8, uTopY, vWorld.y) * wall;
    float fogF = heightFog(cameraPosition, vWorld, uFogDensity);
    c = mix(c, fogTint(uFogColor, -V), fogF);
    gl_FragColor = vec4(c, 1.0);
  }`;

export function facade(o = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uBase: { value: col(o.base ?? '#0b1015') },
      uWin: { value: col(o.win ?? '#ffc988') },
      uWin2: { value: col(o.win2 ?? '#cfe0ff') },
      uGrid: { value: new THREE.Vector2(...(o.grid ?? [0.3, 0.36])) },
      uSize: { value: new THREE.Vector2(...(o.size ?? [0.6, 0.56])) },
      uLit: { value: o.lit ?? 0.5 },
      uGlow: { value: o.glow ?? 1.6 },
      uUp: { value: col(o.up ?? 0x000000) },
      uUpH: { value: o.upH ?? 1 },
      uUpY: { value: o.upY ?? BANK_Y },
      uRim: { value: o.rim ?? 0.35 },
      uLed: { value: col(o.led ?? 0x000000) },
      uLedK: { value: new THREE.Vector2(o.ledScale ?? 0.05, o.ledSpeed ?? 0.06) },
      uTop: { value: col(o.top ?? 0x000000) },
      uTopY: { value: o.topY ?? 1e4 },
      uMode: { value: o.cyl ? 1 : 0 },
      uRadius: { value: o.radius ?? 1 },
      uSeed: { value: o.seed ?? 1 },
      uTime: time,
      ...fogUniforms,
    },
    vertexShader: FACADE_VS,
    fragmentShader: FACADE_FS,
    side: o.side ?? THREE.FrontSide,
  });
}

/* stay cables, with light pulsing up them from the deck */
function cableMaterial(color, speed = 2.0, freq = 15) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: time, uCol: { value: color }, ...fogUniforms },
    vertexShader: /* glsl */ `
      attribute float aT;
      varying float vT;
      varying vec3 vWorld;
      void main() {
        vT = aT;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uCol;
      uniform vec3 uFogColor;
      uniform float uFogDensity;
      varying float vT;
      varying vec3 vWorld;
      ${FOG_GLSL}
      void main() {
        float p = pow(0.5 + 0.5 * sin(vT * ${freq.toFixed(1)} - uTime * ${speed.toFixed(2)}), 10.0);
        float f = heightFog(cameraPosition, vWorld, uFogDensity);
        gl_FragColor = vec4(uCol * (0.5 + 1.9 * p) * (1.0 - f), 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}

function cables(segs, mat) {
  const pos = [], t = [];
  for (const [ax, ay, az, bx, by, bz] of segs) { pos.push(ax, ay, az, bx, by, bz); t.push(0, 1); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aT', new THREE.Float32BufferAttribute(t, 1));
  return new THREE.LineSegments(g, mat);
}

const ledMat = (hex, k) => new THREE.LineBasicMaterial({
  color: hdr(hex, k), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
});

function lines(pts, mat) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return new THREE.LineSegments(g, mat);
}

function boxAt(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0), mat);
  m.position.set(x, y, z);
  return m;
}

/* a box that tapers from (w0, d0) to (w1, d1) and leans as it rises */
function taperGeo(w0, d0, w1, d1, h, leanX = 0, leanZ = 0) {
  const g = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = p.getY(i);
    p.setXYZ(i, p.getX(i) * lerp(w0, w1, t) + leanX * t, t * h, p.getZ(i) * lerp(d0, d1, t) + leanZ * t);
  }
  g.computeVertexNormals();
  return g;
}

/* a hipped roof: ridge along x, slopes on all four sides */
function hipRoof(w, d, h) {
  const r = Math.max(0, (w - d) / 2);
  const A = [-w / 2, 0, d / 2], B = [w / 2, 0, d / 2], Cc = [w / 2, 0, -d / 2], D = [-w / 2, 0, -d / 2];
  const P = [-r, h, 0], Q = [r, h, 0];
  const tris = [A, B, Q, A, Q, P, Cc, D, P, Cc, P, Q, D, A, P, B, Cc, Q];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(tris.flat(), 3));
  g.computeVertexNormals();
  return g;
}

/* a deck swept along x: top, bottom and both sides, following a height profile */
function deckGeometry(xs, yAt, halfW, thick) {
  const pos = [], idx = [];
  for (const x of xs) {
    const y = yAt(x);
    pos.push(x, y, -halfW, x, y, halfW, x, y - thick, -halfW, x, y - thick, halfW);
  }
  for (let i = 0; i < xs.length - 1; i++) {
    const a = i * 4, b = a + 4;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
    idx.push(a + 2, b + 2, a + 3, a + 3, b + 2, b + 3);
    idx.push(a, b, a + 2, a + 2, b, b + 2);
    idx.push(a + 1, a + 3, b + 1, b + 1, a + 3, b + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const RED = hdr('#ff2a1a', 6);
const LAMP = hdr('#ffd3a0', 1.7);

/* ------------------------------------------------------------ Phú Mỹ Bridge */
function buildPhuMy(hw) {
  const g = new THREE.Group(), L = [];
  const span = hw - 1.5, top = 4.6, reach = span + 104;
  const deckY = (x) => {
    const a = Math.abs(x);
    if (a <= span + 7) return top;
    const t = Math.min(1, (a - span - 7) / 96);
    return lerp(top, BANK_Y + 0.1, t * t * (3 - 2 * t));
  };
  const xs = [];
  for (let x = -reach; x <= reach + 0.01; x += 1.5) xs.push(x);
  const deckMat = facade({ base: '#0e1215', lit: 0, rim: 0.8, side: THREE.DoubleSide });
  g.add(new THREE.Mesh(deckGeometry(xs, deckY, 1.35, 0.4), deckMat));

  const pierMat = facade({ base: '#0b0e10', lit: 0, up: hdr('#ffcf9a', 0.12), upH: 1.2, upY: 0 });
  for (let x = span + 10; x < reach - 4; x += 9) {
    for (const s of [-1, 1]) {
      const h = deckY(x * s) - 0.4 - BANK_Y;
      if (h > 0.4) g.add(boxAt(0.55, h, 1.6, pierMat, x * s, BANK_Y, 0));
    }
  }

  /* H-shaped pylons, lit from the water up */
  const pyMat = facade({
    base: '#121518', lit: 0, rim: 0.9,
    up: hdr('#ffe0b5', 0.6), upH: 3.4, upY: 0,
    top: hdr('#f2b84b', 0.3), topY: 14.2,
  });
  const H = 15.2;
  const segs = [];
  for (const px of [-span, span]) {
    for (const zs of [-1, 1]) {
      const leg = new THREE.Mesh(taperGeo(0.85, 1.0, 0.5, 0.62, H, 0, -zs * 0.55), pyMat);
      leg.position.set(px, -0.6, zs * 1.6);
      g.add(leg);
      L.push([px, H - 0.45, zs * 1.05, RED, 0.38, 0.75]);
      /* the fan: eleven stays to midspan, eleven to the shore, per plane */
      for (let k = 0; k <= 10; k++) {
        const y = 10.4 + k * 0.4;
        const zl = zs * (1.6 - 0.55 * ((y + 0.6) / H));
        for (const dir of [-1, 1]) {
          const x = px + dir * (2.2 + k * 1.62);
          segs.push([px, y, zl, x, deckY(x) + 0.02, zs * 1.25]);
        }
      }
    }
    g.add(boxAt(0.55, 0.55, 3.3, pyMat, px, 3.5, 0));
    g.add(boxAt(0.45, 0.5, 2.3, pyMat, px, 13.1, 0));
  }
  g.add(cables(segs, cableMaterial(hdr('#ffcf8a', 0.32))));

  /* deck lamps and the gold strip along both edges */
  const edge = [];
  for (let x = -reach; x < reach; x += 1.5) {
    for (const z of [-1.36, 1.36]) edge.push(x, deckY(x) - 0.08, z, x + 1.5, deckY(x + 1.5) - 0.08, z);
  }
  g.add(lines(edge, ledMat('#f2b84b', 1.1)));
  for (let x = -reach + 1; x < reach; x += 3.2) {
    for (const z of [-1.2, 1.2]) L.push([x, deckY(x) + 0.55, z, LAMP, 0.17, 0]);
  }
  return { group: g, L, span, reach };
}

/* ------------------------------------------------------------ Bến Nhà Rồng */
function buildNhaRong() {
  const g = new THREE.Group(), L = [];
  const wallMat = facade({
    base: '#2a2219', win: '#ffcf8e', win2: '#ffe3b8',
    grid: [0.44, 0.6], size: [0.42, 0.6], lit: 0.86, glow: 1.5,
    up: hdr('#ffd9a8', 0.11), upH: 0.95, rim: 0.6, seed: 3,
  });
  const stone = facade({ base: '#14120f', lit: 0, up: hdr('#ffd9a8', 0.1), upH: 0.4 });
  const roofMat = facade({ base: '#2d0f09', lit: 0, rim: 1.2, up: hdr('#ff9a6a', 0.05), upH: 0.6, upY: 1.6 });

  g.add(boxAt(7.8, 0.26, 3.4, stone));
  g.add(boxAt(7.0, 1.3, 2.6, wallMat, 0, 0.26, 0));
  g.add(boxAt(1.9, 1.5, 3.0, wallMat, 0, 0.26, 0));
  const roof = new THREE.Mesh(hipRoof(7.5, 3.0, 0.9), roofMat);
  roof.position.y = 1.56;
  g.add(roof);
  const cap = new THREE.Mesh(hipRoof(2.3, 3.4, 1.05), roofMat);
  cap.position.y = 1.76;
  g.add(cap);

  /* lưỡng long chầu nguyệt: two dragons on the ridge, facing the pearl */
  const jade = new THREE.MeshBasicMaterial({ color: hdr('#4fb38c', 1.1) });
  for (const s of [-1, 1]) {
    const pts = [[2.15, 2.44], [2.0, 2.66], [1.84, 2.52], [1.66, 2.72], [1.5, 2.62], [1.33, 2.84], [1.18, 2.9]]
      .map(([x, y]) => new THREE.Vector3(x * s, y, 0));
    g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.055, 6), jade));
  }
  const pearl = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), new THREE.MeshBasicMaterial({ color: hdr('#ffd27a', 4) }));
  pearl.position.set(0, 2.98, 0);
  g.add(pearl);
  L.push([0, 2.98, 0, hdr('#ffc45a', 3), 0.7, -0.25]);

  /* the wharf: lamp posts along the quay, floodlights at the foot of the walls */
  const postMat = new THREE.MeshBasicMaterial({ color: '#07090b' });
  for (let x = -4.8; x <= 4.81; x += 1.6) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, 0.7, 6).translate(0, 0.35, 0), postMat);
    post.position.set(x, 0, 3.4);
    g.add(post);
    L.push([x, 0.74, 3.4, LAMP, 0.22, 0]);
  }
  for (let x = -3.2; x <= 3.21; x += 1.6) L.push([x, 0.08, 1.75, hdr('#ffe2b8', 1.2), 0.28, 0]);
  return { group: g, L };
}

/* ------------------------------------------------------------ Bitexco Financial Tower */
function buildBitexco() {
  const g = new THREE.Group(), L = [];
  const prof = [[0.001, 0], [2.15, 0], [2.3, 3], [2.42, 8], [2.38, 13], [2.16, 17], [1.86, 20], [1.46, 22.6], [0.96, 24.6], [0.36, 25.9], [0.001, 26.3]];
  const geo = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 72);
  geo.scale(1, 1, 0.8);
  const mat = facade({
    base: '#0a0f14', win: '#dbe8ff', win2: '#ffcf96',
    grid: [0.42, 0.33], size: [0.86, 0.5], lit: 0.46, glow: 1.0,
    cyl: true, radius: 2.3, rim: 0.6, seed: 7,
    led: hdr('#ffb347', 0.7), ledScale: 0.045, ledSpeed: 0.05,
  });
  g.add(new THREE.Mesh(geo, mat));

  /* the helipad, cantilevered out over the river at the 52nd floor */
  const padMat = facade({ base: '#0d1114', lit: 0, rim: 0.9, up: hdr('#9fffc0', 0.05), upH: 0.4, upY: 18.9 });
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.22, 0.16, 40), padMat);
  pad.position.set(0, 19.1, 2.9);
  g.add(pad);
  g.add(boxAt(0.95, 0.5, 1.5, padMat, 0, 18.6, 2.0));
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    L.push([Math.cos(a) * 1.22, 19.22, 2.9 + Math.sin(a) * 1.22, i % 3 ? hdr('#5dff8a', 2.4) : hdr('#ffffff', 2.4), 0.07, 0]);
  }
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.06, 2.6, 8).translate(0, 1.3, 0), new THREE.MeshBasicMaterial({ color: '#111518' }));
  antenna.position.y = 26.2;
  g.add(antenna);
  L.push([0, 28.85, 0, RED, 0.42, 0.65]);
  return { group: g, L };
}

/* ------------------------------------------------------------ Ba Son Bridge */
function buildBaSon(hw) {
  const g = new THREE.Group(), L = [];
  const px = hw + 1.2, top = 2.8, reach = hw + 46;
  const deckY = (x) => {
    const a = Math.abs(x);
    if (a <= hw + 5) return top;
    const t = Math.min(1, (a - hw - 5) / 40);
    return lerp(top, BANK_Y + 0.1, t * t * (3 - 2 * t));
  };
  const xs = [];
  for (let x = -reach; x <= reach + 0.01; x += 1.4) xs.push(x);
  g.add(new THREE.Mesh(deckGeometry(xs, deckY, 1.15, 0.34), facade({ base: '#0e1215', lit: 0, rim: 0.8, side: THREE.DoubleSide })));
  const pierMat = facade({ base: '#0b0e10', lit: 0 });
  /* approach piers on the far half of the river only: the stays carry the rest */
  for (let x = -hw + 5; x < -hw * 0.2; x += 10) g.add(boxAt(0.6, top + 0.16, 1.4, pierMat, x, -0.5, 0));

  /* one pylon on the city bank, leaning back toward the land */
  const lean = 1.9, PH = 12.0;
  const pyMat = facade({
    base: '#111418', lit: 0, rim: 0.9,
    up: hdr('#8f7dff', 0.55), upH: 4.5, upY: 0,
    top: hdr('#a8c8ff', 0.5), topY: 11.0,
  });
  const pylon = new THREE.Mesh(taperGeo(1.1, 0.95, 0.42, 0.42, PH, lean, 0), pyMat);
  pylon.position.set(px, -0.4, 0);
  g.add(pylon);
  L.push([px + lean, PH - 0.2, 0, RED, 0.38, 0.8]);
  const axisX = (y) => px + lean * ((y + 0.4) / PH);
  const segs = [];
  for (let k = 0; k <= 12; k++) {
    const y = 6.3 + k * 0.42, x = px - 2.6 - k * ((2 * hw - 3.4) / 12);
    segs.push([axisX(y), y, 0, x, deckY(x) + 0.02, 0]);
  }
  for (let k = 0; k < 6; k++) {
    const y = 9.0 + k * 0.4, x = px + 3.2 + k * 2.0;
    segs.push([axisX(y), y, 0, x, deckY(x) + 0.02, 0]);
  }
  g.add(cables(segs, cableMaterial(hdr('#9cc8ff', 0.42), 2.6, 18)));

  const edge = [];
  for (let x = -reach; x < reach; x += 1.4) {
    for (const z of [-1.16, 1.16]) edge.push(x, deckY(x) - 0.06, z, x + 1.4, deckY(x + 1.4) - 0.06, z);
  }
  g.add(lines(edge, ledMat('#7fb2ff', 1.0)));
  for (let x = -reach + 1; x < reach; x += 3) {
    for (const z of [-1.0, 1.0]) L.push([x, deckY(x) + 0.5, z, LAMP, 0.15, 0]);
  }
  return { group: g, L, px, lean, PH };
}

/* ------------------------------------------------------------ Landmark 81 */
/* Nine square tubes in a bundle, like bamboo, stepping up to a crown. */
export const L81 = {
  s: 2.1,
  heights: [[38.6, 41.4, 33.6], [42.1, 42.6, 39.8], [30.8, 36.4, 27.2]],
  crown: 3.0,
  top: 46.1,
};

function buildL81() {
  const g = new THREE.Group(), L = [];
  const { s, heights } = L81;
  const mat = facade({
    base: '#090d12', win: '#ffd9a6', win2: '#d6e5ff',
    grid: [0.24, 46.1 / 81], size: [0.72, 0.62], lit: 0.3, glow: 0.9, rim: 0.7, seed: 81,
    top: hdr('#ffcf8a', 0.7), topY: 41.0,
  });
  const led = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const h = heights[r][c], x = (c - 1) * s, z = (r - 1) * s;
      g.add(boxAt(s, h, s, mat, x, 0, z));
      const e = s / 2 + 0.01;
      const sq = [[x - e, z - e], [x + e, z - e], [x + e, z + e], [x - e, z + e]];
      for (let i = 0; i < 4; i++) led.push(sq[i][0], h + 0.01, sq[i][1], sq[(i + 1) % 4][0], h + 0.01, sq[(i + 1) % 4][1]);
    }
  }
  /* the four outer corners, lit full height */
  const E = 1.5 * s + 0.01;
  [[-E, -E, heights[0][0]], [E, -E, heights[0][2]], [-E, E, heights[2][0]], [E, E, heights[2][2]]]
    .forEach(([x, z, h]) => led.push(x, 1.3, z, x, h, z));

  /* the crown and its spire */
  const c0 = heights[1][1];
  const crownMat = facade({ base: '#0b1016', lit: 0, rim: 1.0, top: hdr('#ffd9a0', 1.6), topY: c0 + 2.2 });
  const crown = new THREE.Mesh(new THREE.ConeGeometry((s / 2) * Math.SQRT2 * 1.01, L81.crown, 4, 1), crownMat);
  crown.rotation.y = Math.PI / 4;
  crown.position.y = c0 + L81.crown / 2;
  g.add(crown);
  const apex = c0 + L81.crown;
  const hs = s / 2;
  for (const [x, z] of [[-hs, -hs], [hs, -hs], [hs, hs], [-hs, hs]]) led.push(x, c0, z, 0, apex, 0);
  const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, L81.top - apex + 0.4, 6).translate(0, (L81.top - apex + 0.4) / 2, 0), new THREE.MeshBasicMaterial({ color: '#111518' }));
  spire.position.y = apex - 0.2;
  g.add(spire);
  g.add(lines(led, ledMat('#ffd9a0', 1.3)));
  L.push([0, L81.top + 0.15, 0, RED, 0.45, 0.6]);
  L.push([-s, heights[1][0] + 0.2, 0, RED, 0.35, 0.7]);
  L.push([0, heights[0][1] + 0.2, -s, RED, 0.35, 0.7]);

  /* the podium, its shopfronts lit */
  const podMat = facade({ base: '#0b0e11', win: '#ffcf96', win2: '#ffe9c8', grid: [0.7, 0.65], size: [0.86, 0.62], lit: 0.85, glow: 1.2, seed: 12 });
  g.add(boxAt(9.4, 1.3, 9.4, podMat));
  return { group: g, L };
}

/* ------------------------------------------------------------ placing them on the river */
function placeAcross(obj, f) {
  obj.position.set(f.x, 0, f.z);
  obj.rotation.y = Math.atan2(-f.rz, f.rx);       /* local +x → the river's right */
}
function placeOnBank(obj, d, setback) {
  const f = RIVER.frame(d, {});
  const lat = f.hw + setback;
  obj.position.set(f.x + f.rx * lat, BANK_Y, f.z + f.rz * lat);
  obj.rotation.y = Math.atan2(-f.rx, -f.rz);      /* local +z → facing the river */
  return f;
}

export function createLandmarks(scene, { lights }) {
  const group = new THREE.Group();
  scene.add(group);
  const v = new THREE.Vector3();
  const flush = (b) => {
    b.group.updateMatrixWorld(true);
    for (const [x, y, z, c, s, k] of b.L) lights.addV(b.group.localToWorld(v.set(x, y, z)), c, s, k);
  };

  const fPM = RIVER.frame(SITES.phuMy, {});
  const pm = buildPhuMy(fPM.hw);
  placeAcross(pm.group, fPM);

  /* the wharf is drawn a little larger than life, so it can hold its chapter */
  const nr = buildNhaRong();
  nr.group.scale.setScalar(1.5);
  const fNR = placeOnBank(nr.group, SITES.nhaRong, 8);

  const bx = buildBitexco();
  const fBX = placeOnBank(bx.group, SITES.bitexco, 9);

  const fBS = RIVER.frame(SITES.baSon, {});
  const bs = buildBaSon(fBS.hw);
  placeAcross(bs.group, fBS);

  const l81 = buildL81();
  const fL = placeOnBank(l81.group, SITES.l81, 15);

  for (const b of [pm, nr, bx, bs, l81]) { group.add(b.group); flush(b); }

  const toWorld = (obj, x, y, z) => obj.localToWorld(new THREE.Vector3(x, y, z));
  const sites = {
    phuMy: { center: new THREE.Vector3(fPM.x, 4.6, fPM.z) },
    nhaRong: { pos: nr.group.position.clone(), look: toWorld(nr.group, 0, 1.4, 0) },
    bitexco: { pos: bx.group.position.clone(), look: toWorld(bx.group, 0, 16, 0) },
    baSon: { center: new THREE.Vector3(fBS.x, 2.8, fBS.z), pylonTop: toWorld(bs.group, bs.px + bs.lean, bs.PH - 0.4, 0) },
    l81: {
      pos: l81.group.position.clone(),
      toRiver: new THREE.Vector3(-fL.rx, 0, -fL.rz),
      along: new THREE.Vector3(fL.tx, 0, fL.tz),
    },
  };

  /* keep the generated city off the landmarks and the bridge approaches */
  const exclusions = {
    circles: [
      { x: nr.group.position.x, z: nr.group.position.z, r: 13 },
      { x: bx.group.position.x, z: bx.group.position.z, r: 6.5 },
      { x: l81.group.position.x, z: l81.group.position.z, r: 9 },
      /* the climb: a clear column of air between the tower and the river */
      { x: l81.group.position.x - fL.rx * 12, z: l81.group.position.z - fL.rz * 12, r: 9 },
      { x: sites.baSon.pylonTop.x, z: sites.baSon.pylonTop.z, r: 6 },
    ],
    corridors: [
      { x: fPM.x, z: fPM.z, ax: fPM.rx, az: fPM.rz, half: pm.reach + 4, w: 4.5 },
      { x: fBS.x, z: fBS.z, ax: fBS.rx, az: fBS.rz, half: fBS.hw + 50, w: 3.8 },
    ],
  };

  return { group, sites, exclusions };
}
