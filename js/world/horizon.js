import * as THREE from 'three';
import { VNINDEX } from '../data/vnindex.js';
import { FOG_GLSL, fogUniforms } from './fog.js';
import { time, hdr, pointScale } from './lights.js';
import { noise2D, fbm } from '../util.js';

/* The far ridge the valley closes with is the VN-Index: one month per step,
   July 2000 on the left, October 2026 on the right. The silhouette is the
   chart, and a thin gold line runs along its crest. A pulse walks the line
   from 2000 to today, over and over. */

const C = new THREE.Vector2(0, 0);          /* centre of the arc (x, z) */
const R = 2600, SPAN = 0.56;                /* radius, half-angle: the whole chart fits the opening frame */
const FACING = -0.86;                       /* bearing of the chart's middle, west of north */
const SUB = 3;                              /* sub-samples per month */

const ang = (t, span = SPAN) => -Math.PI / 2 + FACING - span + 2 * span * t;     /* 0 → left, 1 → right */

const RIDGE_FS = /* glsl */ `
  uniform vec3 uFogColor;
  uniform vec3 uRock;
  uniform float uDark;
  varying vec3 vWorld;
  varying float vV;
  ${FOG_GLSL}
  void main() {
    vec3 dir = normalize(vWorld - cameraPosition);
    vec3 haze = fogTint(uFogColor, dir) * 1.12;
    float k = smoothstep(0.0, 1.0, vV);
    vec3 c = mix(haze, uRock, uDark * (0.3 + 0.7 * k));
    gl_FragColor = vec4(c, 1.0);
  }`;

const RIDGE_VS = /* glsl */ `
  attribute float aV;
  varying vec3 vWorld;
  varying float vV;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vV = aV;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;

function ridgeMesh(heights, radius, base, mat, span = SPAN) {
  const M = heights.length;
  const pos = new Float32Array(M * 6), av = new Float32Array(M * 2), idx = [];
  for (let j = 0; j < M; j++) {
    const a = ang(j / (M - 1), span);
    const x = C.x + radius * Math.cos(a), z = C.y + radius * Math.sin(a);
    pos.set([x, heights[j], z, x, base, z], j * 6);
    av[j * 2] = 1; av[j * 2 + 1] = 0;
    if (j < M - 1) {
      const p = j * 2, q = p + 2;
      idx.push(p, p + 1, q, q, p + 1, q + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aV', new THREE.BufferAttribute(av, 1));
  g.setIndex(idx);
  const m = new THREE.Mesh(g, mat);
  m.frustumCulled = false;
  return m;
}

export function createHorizon(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const vals = VNINDEX.values, N = vals.length;
  const vmax = Math.max(...vals);
  const height = (v) => 30 + 420 * Math.pow(v / vmax, 0.85);

  /* the chart, sampled between months */
  const M = (N - 1) * SUB + 1;
  const crest = new Float32Array(M);
  for (let j = 0; j < M; j++) {
    const mi = j / SUB, i0 = Math.floor(mi), i1 = Math.min(N - 1, i0 + 1), f = mi - i0;
    crest[j] = height(vals[i0] + (vals[i1] - vals[i0]) * f);
  }

  const mat = (rock, dark) => new THREE.ShaderMaterial({
    uniforms: { uRock: { value: new THREE.Color(rock) }, uDark: { value: dark }, ...fogUniforms },
    vertexShader: RIDGE_VS, fragmentShader: RIDGE_FS,
  });

  /* a farther range behind, pure noise, three-quarters eaten by haze; it runs
     wider than the chart so the horizon never simply stops */
  const n = noise2D(404), back = new Float32Array(M);
  for (let j = 0; j < M; j++) {
    const t = j / (M - 1);
    back[j] = 60 + 190 * (0.5 + 0.5 * fbm(n, t * 9.0, 0.3, 5)) + 40 * Math.sin(t * 13.0);
  }
  const backRidge = ridgeMesh(back, R + 420, -80, mat('#05080a', 0.42), 1.3);
  backRidge.renderOrder = -60;
  group.add(backRidge);

  const ridge = ridgeMesh(crest, R, -80, mat('#020405', 0.9));
  ridge.renderOrder = -50;
  group.add(ridge);

  /* the chart line: a ribbon laid along the crest, just in front of it. Its
     width is held in pixels in the vertex shader, so at two kilometres it is
     still a line and not a thread. */
  const r2 = R - 4;
  const lp = new Float32Array(M * 6), lo = new Float32Array(M * 6), lt = new Float32Array(M * 2), ls = new Float32Array(M * 2), li = [];
  for (let j = 0; j < M; j++) {
    const t = j / (M - 1), a = ang(t);
    const jp = Math.max(0, j - 1), jn = Math.min(M - 1, j + 1);
    const ds = (r2 * 2 * SPAN) / (M - 1) * (jn - jp), dh = crest[jn] - crest[jp];
    const l = Math.hypot(ds, dh);
    const ns = -dh / l, ny = ds / l;               /* normal in (arc, height) */
    const tx = -Math.sin(a), tz = Math.cos(a);     /* arc tangent, left → right */
    const x = C.x + r2 * Math.cos(a), z = C.y + r2 * Math.sin(a), y = crest[j];
    for (let s = 0; s < 2; s++) {
      const k = s ? 1 : -1;
      lp.set([x, y, z], (j * 2 + s) * 3);
      lo.set([tx * ns * k, ny * k, tz * ns * k], (j * 2 + s) * 3);
      lt[j * 2 + s] = t;
      ls[j * 2 + s] = k;
    }
    if (j < M - 1) { const p = j * 2, q = p + 2; li.push(p, p + 1, q, q, p + 1, q + 1); }
  }
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.BufferAttribute(lp, 3));
  lg.setAttribute('aOff', new THREE.BufferAttribute(lo, 3));
  lg.setAttribute('aT', new THREE.BufferAttribute(lt, 1));
  lg.setAttribute('aS', new THREE.BufferAttribute(ls, 1));
  lg.setIndex(li);
  const lineMat = new THREE.ShaderMaterial({
    uniforms: { uTime: time, uPx: pointScale, uCol: { value: hdr('#f2b84b', 1.25) } },
    vertexShader: /* glsl */ `
      attribute vec3 aOff;
      attribute float aT;
      attribute float aS;
      uniform float uPx;
      varying float vT;
      varying float vS;
      void main() {
        vT = aT; vS = aS;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        float dist = length(cameraPosition - wp.xyz);
        wp.xyz += aOff * (1.5 * dist / uPx);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uCol;
      varying float vT;
      varying float vS;
      void main() {
        float head = fract(uTime / 26.0) * 1.08 - 0.04;
        float dt = vT - head;
        float pulse = exp(-dt * dt * 2600.0) * 5.0 + (dt < 0.0 ? 0.6 * exp(dt * 9.0) : 0.0);
        float edge = 1.0 - vS * vS;
        float ends = smoothstep(0.0, 0.02, vT) * (1.0 - smoothstep(0.985, 1.0, vT));
        gl_FragColor = vec4(uCol * (0.75 + pulse) * edge * ends, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const line = new THREE.Mesh(lg, lineMat);
  line.renderOrder = -40;
  line.frustumCulled = false;
  group.add(line);

  /* today: a slow-breathing point at the end of the line, above the haze */
  const aEnd = ang(1);
  const mg = new THREE.BufferGeometry();
  mg.setAttribute('position', new THREE.Float32BufferAttribute([C.x + r2 * Math.cos(aEnd), crest[M - 1], C.y + r2 * Math.sin(aEnd)], 3));
  const marker = new THREE.Points(mg, new THREE.ShaderMaterial({
    uniforms: { uTime: time, uPx: pointScale, uCol: { value: hdr('#ffd27a', 7) } },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uPx;
      varying float vB;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vB = 0.6 + 0.4 * sin(uTime * 2.1);
        gl_PointSize = clamp(16.0 * uPx / -mv.z, 4.0, 40.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uCol;
      varying float vB;
      void main() {
        vec2 c = gl_PointCoord * 2.0 - 1.0;
        float r2 = dot(c, c);
        if (r2 > 1.0) discard;
        gl_FragColor = vec4(uCol * vB * (exp(-r2 * 9.0) + 0.15 * (1.0 - r2)), 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  marker.renderOrder = -39;
  marker.frustumCulled = false;
  group.add(marker);

  return { group };
}
