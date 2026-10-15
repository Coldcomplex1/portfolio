import * as THREE from 'three';
import { FOG_GLSL, fogUniforms } from './fog.js';
import { time, hdr, WINDOWS_GLSL } from './lights.js';
import { RIVER, SITES, BANK_Y } from './river.js';
import { mulberry32, clamp, lerp } from '../util.js';

/* Saigon by night: one instanced box per building, every window procedural. */
const CITY_VS = /* glsl */ `
  attribute float aSeed;
  varying vec3 vWorld;
  varying vec3 vN;
  varying float vSeed;
  varying float vTop;
  void main() {
    mat4 m = modelMatrix * instanceMatrix;
    vec4 wp = m * vec4(position, 1.0);
    vWorld = wp.xyz;
    vN = normalize(mat3(m) * normal);
    vSeed = aSeed;
    vTop = (m * vec4(0.0, 1.0, 0.0, 1.0)).y;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;

const CITY_FS = /* glsl */ `
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  varying vec3 vWorld;
  varying vec3 vN;
  varying float vSeed;
  varying float vTop;
  ${FOG_GLSL}
  ${WINDOWS_GLSL}
  void main() {
    vec3 N = normalize(vN);
    float wall = 1.0 - step(0.5, abs(N.y));
    vec2 t = vec2(-N.z, N.x);
    float tl = length(t);
    t = tl > 1e-3 ? t / tl : vec2(1.0, 0.0);
    float y = vWorld.y - ${BANK_Y.toFixed(2)};
    vec2 fc = vec2(dot(vWorld.xz, t), y);
    float s = vSeed;
    vec2 grid = vec2(0.24 + 0.14 * fract(s * 7.31), 0.32 + 0.07 * fract(s * 3.71));
    float litP = 0.16 + 0.44 * fract(s * 13.13);
    vec3 w1 = mix(vec3(1.0, 0.58, 0.26), vec3(1.0, 0.84, 0.6), fract(s * 5.17));
    vec3 w2 = mix(vec3(0.58, 0.74, 1.0), vec3(0.76, 1.0, 0.92), fract(s * 2.3));
    vec4 W = windows(fc, grid, vec2(0.6, 0.54), litP, s * 113.0, w1, w2);
    vec3 c = vec3(0.004, 0.0055, 0.0075) * (0.75 + 0.5 * fract(s * 21.7));
    c += vec3(0.045, 0.022, 0.008) * exp(-y * 1.3) * wall;
    float glow = 0.55 + 0.7 * fract(s * 9.13);
    c = mix(c, W.rgb * glow, W.a * wall * step(0.45, y));
    /* shopfronts along the ground floor */
    float shop = step(0.06, y) * (1.0 - step(0.4, y)) * wall * step(0.35, fract(s * 3.3));
    vec2 sid = floor(fc / vec2(0.85, 1.0));
    c += vec3(0.9, 0.5, 0.24) * shop * (0.3 + 0.7 * hash12(sid + s));
    c = mix(c, vec3(0.003, 0.004, 0.005), 1.0 - wall);
    /* a lit crown on one tower in six */
    float crown = step(0.83, fract(s * 4.7)) * step(9.0, vTop - ${BANK_Y.toFixed(2)});
    vec3 crownCol = mix(vec3(0.42, 0.29, 0.15), vec3(0.2, 0.32, 0.48), step(0.5, fract(s * 8.1)));
    c += crownCol * crown * smoothstep(vTop - 0.4, vTop - 0.06, vWorld.y) * wall;
    float fogF = heightFog(cameraPosition, vWorld, uFogDensity);
    c = mix(c, fogTint(uFogColor, normalize(vWorld - cameraPosition)), fogF);
    gl_FragColor = vec4(c, 1.0);
  }`;

export function createCity(scene, { count = 2400, lamps = 20000, exclusions, sites, lights }) {
  const rnd = mulberry32(1987);
  const { circles, corridors } = exclusions;
  const CELL = 8, grid = new Map();
  const key = (i, j) => i * 100003 + j;

  const free = (x, z, r) => {
    const i0 = Math.floor((x - r - 4) / CELL), i1 = Math.floor((x + r + 4) / CELL);
    const j0 = Math.floor((z - r - 4) / CELL), j1 = Math.floor((z + r + 4) / CELL);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const list = grid.get(key(i, j));
        if (!list) continue;
        for (const [bx, bz, br] of list) if (Math.hypot(x - bx, z - bz) < r + br + 0.45) return false;
      }
    }
    return true;
  };
  const mark = (x, z, r) => {
    const k = key(Math.floor(x / CELL), Math.floor(z / CELL));
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push([x, z, r]);
  };
  const excluded = (x, z, r) => {
    for (const c of circles) if (Math.hypot(x - c.x, z - c.z) < c.r + r) return true;
    for (const k of corridors) {
      const dx = x - k.x, dz = z - k.z;
      const along = dx * k.ax + dz * k.az, across = Math.abs(-dx * k.az + dz * k.ax);
      if (Math.abs(along) < k.half && across < k.w + r) return true;
    }
    return false;
  };

  const D1 = sites.bitexco.pos, VCP = sites.l81.pos;
  const geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const seeds = new Float32Array(count);
  const mat = new THREE.ShaderMaterial({ uniforms: { uTime: time, ...fogUniforms }, vertexShader: CITY_VS, fragmentShader: CITY_FS });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), S = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
  const red = hdr('#ff2a1a', 4);
  const f = {};
  let n = 0;

  for (let tries = 0; n < count && tries < count * 14; tries++) {
    const d = 20 + rnd() * (RIVER.len - 40);
    const side = rnd() < 0.5 ? -1 : 1;
    RIVER.frame(d, f);
    const o = f.hw + 3.2 + Math.pow(rnd(), 1.7) * 560;
    const x = f.x + f.rx * side * o, z = f.z + f.rz * side * o;
    const w = 1.3 + rnd() * 2.5, dep = 1.3 + rnd() * 2.5;
    const r = 0.5 * Math.hypot(w, dep);
    if (o - r < f.hw + 2.4) continue;

    /* Thủ Thiêm, across from District 1, is still mostly open ground */
    if (side < 0 && Math.abs(d - SITES.bitexco) < 150 && rnd() < 0.6) continue;
    if (excluded(x, z, r) || !free(x, z, r)) continue;

    const near = Math.exp(-(o - f.hw) / 70);
    let h = 0.7 + Math.pow(rnd(), 2.4) * 7.5;
    h *= 1 + 0.9 * near;
    const dD1 = Math.hypot(x - D1.x, z - D1.z);
    if (side > 0 && dD1 < 170) h = Math.max(h, (4 + rnd() * 15) * (1 - dD1 / 210));
    const dV = Math.hypot(x - VCP.x, z - VCP.z);
    if (dV < 130 && dV > 12) h = Math.max(h, (9 + rnd() * 13) * (1 - dV / 170));
    h *= lerp(1, 0.45, clamp((o - f.hw) / 600, 0, 1));
    h = clamp(h, 0.6, 24);

    const yaw = Math.atan2(-f.rz, f.rx) + (rnd() < 0.5 ? 0 : Math.PI / 2) + (rnd() - 0.5) * 0.12;
    Q.setFromAxisAngle(Y, yaw);
    M.compose(P.set(x, BANK_Y, z), Q, S.set(w, h, dep));
    mesh.setMatrixAt(n, M);
    seeds[n] = rnd();
    mark(x, z, r);
    if (h > 13) lights.add(x, BANK_Y + h + 0.12, z, red, 0.28, 0.45 + rnd() * 0.35);
    n++;
  }
  /* street lamps as points, so the city glitters from the top of the tower
     the way the ground pattern alone cannot: snapped to the same street grid */
  const ca = Math.cos(0.33), sa = Math.sin(0.33);
  const sodium = hdr('#ffae5c', 2.3), led = hdr('#e8f0ff', 1.8);
  for (let i = 0; i < lamps; i++) {
    const d = 20 + rnd() * (RIVER.len - 40);
    const side = rnd() < 0.5 ? -1 : 1;
    RIVER.frame(d, f);
    const o = f.hw + 6 + Math.pow(rnd(), 1.15) * 760;
    let x = f.x + f.rx * side * o, z = f.z + f.rz * side * o;
    /* into street space, onto the nearest street, back out */
    /* the same rotation as the ground shader's mat2 (column-major there) */
    let qx = ca * x + sa * z, qz = -sa * x + ca * z;
    if (rnd() < 0.5) qx = Math.round(qx / 7.5) * 7.5 + (rnd() - 0.5) * 0.4;
    else qz = Math.round(qz / 7.5) * 7.5 + (rnd() - 0.5) * 0.4;
    x = ca * qx - sa * qz; z = sa * qx + ca * qz;
    if (excluded(x, z, 0.5)) continue;
    lights.add(x, BANK_Y + 0.25, z, rnd() < 0.78 ? sodium : led, 0.45, 0);
  }

  mesh.count = n;
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  scene.add(mesh);
  return { mesh, count: n };
}
