import * as THREE from 'three';
import { FOG_GLSL, fogUniforms } from './fog.js';
import { time, hdr, WINDOWS_GLSL } from './lights.js';
import { BANK_Y } from './river.js';
import { eachRoad } from './map.js';
import { SAIGON } from '../data/saigon.js';
import { mulberry32, clamp, lerp } from '../util.js';

/* Saigon by night, from the map: every building stands on its real footprint
   at its real height where the map records one, every window is procedural. */
const CITY_VS = /* glsl */ `
  attribute float aSeed;
  attribute float aTop;
  varying vec3 vWorld;
  varying vec3 vN;
  varying float vSeed;
  varying float vTop;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vN = normal;
    vSeed = aSeed;
    vTop = aTop;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;

const CITY_FS = /* glsl */ `
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  uniform float uDim;
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
    float H = vTop - ${BANK_Y.toFixed(2)};
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
    /* the tall narrow signs that hang down the shophouses, a strip per bay */
    float bay = floor(fc.x / 0.62);
    float hasSign = step(0.66, hash12(vec2(bay, s * 37.0))) * (1.0 - step(2.6, H));
    float strip = 1.0 - smoothstep(0.07, 0.09, abs(fract(fc.x / 0.62) - 0.5) * 0.62);
    float span = step(0.42, y) * (1.0 - step(0.62 + 0.9 * hash12(vec2(bay, s)), y));
    vec3 signCol = mix(vec3(1.0, 0.16, 0.12), mix(vec3(0.16, 0.9, 1.0), vec3(1.0, 0.72, 0.18), step(0.5, hash12(vec2(s, bay)))), step(0.45, hash12(vec2(bay * 1.7, s))));
    c += signCol * 1.3 * hasSign * strip * span * wall;
    c = mix(c, vec3(0.003, 0.004, 0.005), 1.0 - wall);
    /* a lit crown on one tower in six */
    float crown = step(0.83, fract(s * 4.7)) * step(9.0, H);
    vec3 crownCol = mix(vec3(0.42, 0.29, 0.15), vec3(0.2, 0.32, 0.48), step(0.5, fract(s * 8.1)));
    c += crownCol * crown * smoothstep(vTop - 0.4, vTop - 0.06, vWorld.y) * wall;
    c *= 1.0 - 0.9 * uDim;
    float fogF = heightFog(cameraPosition, vWorld, uFogDensity);
    c = mix(c, fogTint(uFogColor, normalize(vWorld - cameraPosition)), fogF);
    gl_FragColor = vec4(c, 1.0);
  }`;

/* Every street of the map, painted once. The land reads it as a texture and
   the pin map draws it directly. */
export function paintStreets(map, size = 4096) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d', { alpha: false });
  g.fillStyle = '#000';
  g.fillRect(0, 0, size, size);
  const C = SAIGON.city, sx = size / (C.x1 - C.x0), sz = size / (C.z1 - C.z0), Q = map.quant;
  const k = size / 4096;
  const style = [[3.4, '255,196,130', 0.95], [2.8, '255,184,112', 0.85], [2.1, '255,170,96', 0.7], [1.5, '250,156,84', 0.52], [0.9, '240,140,72', 0.34]];
  g.lineCap = 'round'; g.lineJoin = 'round';
  g.globalCompositeOperation = 'lighter';
  for (const [wide, alpha] of [[3.4, 0.16], [1, 1]]) {
    for (let cls = 4; cls >= 0; cls--) {
      g.beginPath();
      eachRoad(map, (c, xz, at, n) => {
        if ((c & 7) !== cls || c >= 8) return;
        for (let i = 0; i < n; i++) {
          const x = (xz[at + i * 2] / Q - C.x0) * sx, y = (C.z1 - xz[at + i * 2 + 1] / Q) * sz;
          i ? g.lineTo(x, y) : g.moveTo(x, y);
        }
      });
      const [w, rgb, a] = style[cls];
      g.lineWidth = w * wide * k;
      g.strokeStyle = `rgba(${rgb},${a * alpha})`;
      g.stroke();
    }
  }
  return canvas;
}

export function cityTexture(canvas, renderer) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/* Motorbikes and cars down the big roads: red going one way, white the other.
   One line per road segment, the dashes moved along them on the GPU. */
function traffic(map) {
  const Q = map.quant, pos = [], arc = [], red = [];
  eachRoad(map, (c, xz, at, n) => {
    if (c >= 3) return;
    let s = (at * 0.37) % 11;
    for (let i = 0; i < n - 1; i++) {
      const ax = xz[at + i * 2] / Q, az = xz[at + i * 2 + 1] / Q, bx = xz[at + i * 2 + 2] / Q, bz = xz[at + i * 2 + 3] / Q;
      const l = Math.hypot(bx - ax, bz - az) || 1, nx = -(bz - az) / l * 0.3, nz = (bx - ax) / l * 0.3;
      for (const side of [0, 1]) {
        const o = side ? 1 : -1;
        pos.push(ax + nx * o, BANK_Y + 0.14, az + nz * o, bx + nx * o, BANK_Y + 0.14, bz + nz * o);
        arc.push(s, s + l);
        red.push(side, side);
      }
      s += l;
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aS', new THREE.Float32BufferAttribute(arc, 1));
  g.setAttribute('aRed', new THREE.Float32BufferAttribute(red, 1));
  const lines = new THREE.LineSegments(g, new THREE.ShaderMaterial({
    uniforms: { uTime: time, ...fogUniforms },
    vertexShader: /* glsl */ `
      attribute float aS;
      attribute float aRed;
      varying float vS;
      varying float vRed;
      varying vec3 vWorld;
      void main() {
        vS = aS; vRed = aRed;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uFogColor;
      uniform float uFogDensity;
      varying float vS;
      varying float vRed;
      varying vec3 vWorld;
      ${FOG_GLSL}
      void main() {
        float dir = vRed > 0.5 ? -1.0 : 1.0;
        float u = fract(vS / 2.3 + dir * uTime * 0.42);
        float u2 = fract(vS / 7.1 + dir * uTime * 0.19);
        float dash = max(exp(-u * 16.0), 0.7 * exp(-u2 * 22.0));
        vec3 col = mix(vec3(2.2, 1.9, 1.5), vec3(2.6, 0.26, 0.12), vRed);
        float f = heightFog(cameraPosition, vWorld, uFogDensity);
        gl_FragColor = vec4(col * dash * (1.0 - f), 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  lines.frustumCulled = false;
  return lines;
}

/* Metro Line 1, up on its viaduct, with a lit train running along it. */
function metro(map) {
  const Q = map.quant, deck = [], line = [], arc = [];
  let at = 0, s = 0;
  const y = BANK_Y + 1.5;
  for (let w = 0; w < map.railN.length; w++) {
    const n = map.railN[w];
    for (let i = 0; i < n - 1; i++) {
      const ax = map.railXZ[at + i * 2] / Q, az = map.railXZ[at + i * 2 + 1] / Q, bx = map.railXZ[at + i * 2 + 2] / Q, bz = map.railXZ[at + i * 2 + 3] / Q;
      const l = Math.hypot(bx - ax, bz - az) || 1, nx = -(bz - az) / l * 0.5, nz = (bx - ax) / l * 0.5;
      const k = deck.length / 3;
      deck.push(ax - nx, y, az - nz, ax + nx, y, az + nz, bx - nx, y, bz - nz, bx + nx, y, bz + nz);
      line.push(ax, y + 0.28, az, bx, y + 0.28, bz);
      arc.push(s, s + l);
      s += l;
    }
    at += n * 2;
  }
  const idx = [];
  for (let i = 0; i < deck.length / 12; i++) { const k = i * 4; idx.push(k, k + 1, k + 2, k + 2, k + 1, k + 3); }
  const dg = new THREE.BufferGeometry();
  dg.setAttribute('position', new THREE.Float32BufferAttribute(deck, 3));
  dg.setIndex(idx);
  const viaduct = new THREE.Mesh(dg, new THREE.MeshBasicMaterial({ color: '#0d1114', side: THREE.DoubleSide }));
  viaduct.frustumCulled = false;
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(line, 3));
  lg.setAttribute('aS', new THREE.Float32BufferAttribute(arc, 1));
  const train = new THREE.LineSegments(lg, new THREE.ShaderMaterial({
    uniforms: { uTime: time, ...fogUniforms },
    vertexShader: /* glsl */ `
      attribute float aS;
      varying float vS;
      varying vec3 vWorld;
      void main() {
        vS = aS;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uFogColor;
      uniform float uFogDensity;
      varying float vS;
      varying vec3 vWorld;
      ${FOG_GLSL}
      void main() {
        float u = fract(vS / 310.0 - uTime * 0.03);
        float car = step(u, 0.045) * step(0.3, fract(vS / 2.2));
        float f = heightFog(cameraPosition, vWorld, uFogDensity);
        gl_FragColor = vec4(vec3(1.6, 2.1, 2.6) * car * (1.0 - f), 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  train.frustumCulled = false;
  return [viaduct, train];
}

/* Road bridges from the map: a raised deck with piers and a line of lamps. */
function bridges(map, lights) {
  const Q = map.quant, pos = [], nor = [], idx = [];
  const lamp = hdr('#ffd3a0', 1.6);
  const tri = (a, b, c, d, nx, ny, nz) => {
    const k = pos.length / 3;
    for (const v of [a, b, c, d]) { pos.push(...v); nor.push(nx, ny, nz); }
    idx.push(k, k + 1, k + 2, k + 2, k + 1, k + 3);
  };
  eachRoad(map, (c, xz, at, n) => {
    if (c < 8) return;
    const cls = c & 7, half = [1.1, 0.95, 0.7, 0.55, 0.4][cls];
    const pts = [];
    let len = 0;
    for (let i = 0; i < n; i++) {
      const x = xz[at + i * 2] / Q, z = xz[at + i * 2 + 1] / Q;
      if (i) len += Math.hypot(x - pts[i - 1][0], z - pts[i - 1][1]);
      pts.push([x, z, len]);
    }
    if (len < 2) return;
    const yAt = (s) => BANK_Y + 0.08 + 0.75 * Math.sin(Math.PI * clamp(s / len, 0, 1));
    for (let i = 0; i < n - 1; i++) {
      const [ax, az, sa] = pts[i], [bx, bz, sb] = pts[i + 1];
      const l = Math.hypot(bx - ax, bz - az) || 1, nx = -(bz - az) / l * half, nz = (bx - ax) / l * half;
      const ya = yAt(sa), yb = yAt(sb);
      tri([ax - nx, ya, az - nz], [ax + nx, ya, az + nz], [bx - nx, yb, bz - nz], [bx + nx, yb, bz + nz], 0, 1, 0);
      tri([ax + nx, ya - 0.3, az + nz], [ax + nx, ya, az + nz], [bx + nx, yb - 0.3, bz + nz], [bx + nx, yb, bz + nz], nx / half, 0, nz / half);
      tri([ax - nx, ya, az - nz], [ax - nx, ya - 0.3, az - nz], [bx - nx, yb, bz - nz], [bx - nx, yb - 0.3, bz - nz], -nx / half, 0, -nz / half);
      for (let s = 0; s < l; s += 3) {
        const t = s / l;
        const x = lerp(ax, bx, t), z = lerp(az, bz, t), y = lerp(ya, yb, t);
        lights.add(x + nx, y + 0.4, z + nz, lamp, 0.15, 0);
        lights.add(x - nx, y + 0.4, z - nz, lamp, 0.15, 0);
      }
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: '#0d1114', side: THREE.DoubleSide }));
  m.frustumCulled = false;
  return m;
}

/* A column of light over the answer, so the reveal lands in the real city too. */
export function createBeacon(scene) {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.14, 0.14, 120, 10, 1, true).translate(0, 60, 0),
    new THREE.ShaderMaterial({
      uniforms: { uOn: { value: 0 } },
      vertexShader: /* glsl */ `
        varying float vY;
        void main() {
          vY = position.y / 120.0;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uOn;
        varying float vY;
        void main() {
          gl_FragColor = vec4(vec3(1.5, 0.95, 0.34) * uOn * pow(1.0 - vY, 2.2), 1.0);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }),
  );
  mesh.visible = false;
  scene.add(mesh);
  const on = mesh.material.uniforms.uOn;
  let target = 0;
  return {
    set(x, z, show) { mesh.position.set(x, BANK_Y, z); target = show ? 1 : 0; if (show) mesh.visible = true; },
    update(dt) {
      on.value += (target - on.value) * (1 - Math.exp(-2.4 * dt));
      if (target === 0 && on.value < 0.01) mesh.visible = false;
    },
  };
}

export function createCity(scene, { map, lights, lamps = 30000, keep = 1, exclusions }) {
  const rnd = mulberry32(1987);
  const Q = map.quant, { circles, corridors } = exclusions;
  const excluded = (x, z) => {
    for (const c of circles) if (Math.hypot(x - c.x, z - c.z) < c.r) return true;
    for (const k of corridors) {
      const dx = x - k.x, dz = z - k.z;
      const along = dx * k.ax + dz * k.az, across = Math.abs(-dx * k.az + dz * k.ax);
      if (Math.abs(along) < k.half && across < k.w) return true;
    }
    return false;
  };

  /* the buildings, merged by map tile so only what the camera can see is
     drawn: four vertices per wall, then a roof */
  const { bldXZ: xz, bldN: N, bldH: H, hsXZ, hsWDYH } = map;
  const TILE = 220, tiles = new Map();
  const route = [[-20, 90], [130, -163], [40, 180], [-520, 310]];
  const tileAt = (x, z) => {
    const key = `${Math.floor(x / TILE)},${Math.floor(z / TILE)}`;
    if (!tiles.has(key)) tiles.set(key, { rings: [], verts: 0, tris: 0, mx: 0, mz: 0 });
    return tiles.get(key);
  };
  const thin = (x, z, h) => keep < 1 && h < 3 && rnd() > keep && Math.min(...route.map(([a, b]) => Math.hypot(x - a, z - b))) > 240;
  const add = (ring, x, z, h) => {
    const t = tileAt(x, z), n = ring.length;
    t.rings.push(ring, h);
    t.verts += n * 5; t.tris += n * 3;
    t.mx += x; t.mz += z;
    count++;
  };
  let at = 0, count = 0;
  for (let i = 0; i < N.length; i++) {
    const n = N[i], ring = [];
    let cx = 0, cz = 0;
    for (let k = 0; k < n; k++) {
      const x = xz[at + k * 2] / Q, z = xz[at + k * 2 + 1] / Q;
      ring.push([x, z]);
      cx += x; cz += z;
    }
    at += n * 2;
    cx /= n; cz /= n;
    if (!excluded(cx, cz) && !thin(cx, cz, H[i] / 10)) add(ring, cx, cz, H[i] / 10);
  }
  /* tube houses, drawn up where the survey leaves a street front empty */
  for (let i = 0; i < hsXZ.length / 2; i++) {
    const cx = hsXZ[i * 2] / Q, cz = hsXZ[i * 2 + 1] / Q;
    if (excluded(cx, cz) || thin(cx, cz, 0)) continue;
    const w = hsWDYH[i * 4] / 400, d = hsWDYH[i * 4 + 1] / 200, a = (hsWDYH[i * 4 + 2] / 255) * Math.PI * 2, h = hsWDYH[i * 4 + 3] / 50;
    const c = Math.cos(a), s = Math.sin(a);
    add([[cx - c * w + s * d, cz - s * w - c * d], [cx + c * w + s * d, cz + s * w - c * d], [cx + c * w - s * d, cz + s * w + c * d], [cx - c * w - s * d, cz - s * w + c * d]], cx, cz, h);
  }

  const red = hdr('#ff2a1a', 4);
  const mat = new THREE.ShaderMaterial({ uniforms: { uDim: { value: 0 }, ...fogUniforms }, vertexShader: CITY_VS, fragmentShader: CITY_FS });
  const group = new THREE.Group(), meshes = [];
  scene.add(group);
  for (const t of tiles.values()) {
    const pos = new Float32Array(t.verts * 3), nor = new Float32Array(t.verts * 3);
    const seed = new Float32Array(t.verts), tops = new Float32Array(t.verts), idx = new Uint32Array(t.tris * 3);
    let v = 0, e = 0;
    for (let r = 0; r < t.rings.length; r += 2) {
      const ring = t.rings[r], h = t.rings[r + 1], n = ring.length, top = BANK_Y + h, s = rnd();
      for (let k = 0; k < n; k++) {
        const [ax, az] = ring[k], [bx, bz] = ring[(k + 1) % n];
        const l = Math.hypot(bx - ax, bz - az) || 1, nx = (bz - az) / l, nz = -(bx - ax) / l;
        const b = v;
        for (const [x, y, z] of [[ax, BANK_Y, az], [bx, BANK_Y, bz], [bx, top, bz], [ax, top, az]]) {
          pos[v * 3] = x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z;
          nor[v * 3] = nx; nor[v * 3 + 2] = nz;
          seed[v] = s; tops[v] = top;
          v++;
        }
        idx[e++] = b; idx[e++] = b + 2; idx[e++] = b + 1;
        idx[e++] = b; idx[e++] = b + 3; idx[e++] = b + 2;
      }
      const roof = v;
      for (const [x, z] of ring) {
        pos[v * 3] = x; pos[v * 3 + 1] = top; pos[v * 3 + 2] = z;
        nor[v * 3 + 1] = 1;
        seed[v] = s; tops[v] = top;
        v++;
      }
      if (n <= 4) {
        for (let k = 1; k < n - 1; k++) { idx[e++] = roof; idx[e++] = roof + k + 1; idx[e++] = roof + k; }
      } else {
        for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(ring.map(([x, z]) => new THREE.Vector2(x, z)), [])) {
          idx[e++] = roof + a; idx[e++] = roof + c; idx[e++] = roof + b;
        }
      }
      if (h > 13) lights.add(ring[0][0], top + 0.12, ring[0][1], red, 0.28, 0.45 + rnd() * 0.35);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, v * 3), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor.subarray(0, v * 3), 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed.subarray(0, v), 1));
    geo.setAttribute('aTop', new THREE.BufferAttribute(tops.subarray(0, v), 1));
    geo.setIndex(new THREE.BufferAttribute(idx.subarray(0, e), 1));
    geo.computeBoundingSphere();
    const m = new THREE.Mesh(geo, mat);
    const n = t.rings.length / 2;
    m.userData.c = [t.mx / n, t.mz / n];
    group.add(m);
    meshes.push(m);
  }

  /* a street lamp every few doors, on every road of the map, so the city
     glitters from high up the way the painted streets alone cannot */
  const sodium = hdr('#ffae5c', 2.3), led = hdr('#e8f0ff', 1.8);
  const spacing = [3.0, 3.0, 3.6, 4.6, 7.5];
  let placed = 0;
  eachRoad(map, (c, roads, a, n) => {
    if (placed >= lamps || c >= 8) return;
    const gap = spacing[c & 7], cool = c < 2;
    let carry = rnd() * gap;
    for (let i = 0; i < n - 1; i++) {
      const ax = roads[a + i * 2] / Q, az = roads[a + i * 2 + 1] / Q, bx = roads[a + i * 2 + 2] / Q, bz = roads[a + i * 2 + 3] / Q;
      const l = Math.hypot(bx - ax, bz - az);
      for (; carry < l; carry += gap) {
        const k = carry / l;
        lights.add(lerp(ax, bx, k), BANK_Y + 0.6, lerp(az, bz, k), cool && rnd() < 0.5 ? led : sodium, 0.42, 0);
        placed++;
      }
      carry -= l;
    }
  });

  /* the old streets of Chợ Lớn hang red lanterns from one end to the other */
  const lantern = hdr('#ff3c1e', 2.6), gold = hdr('#ffb648', 2.2);
  for (const line of SAIGON.streets) {
    let carry = 0;
    for (let i = 0; i + 3 < line.length; i += 2) {
      const ax = line[i], az = line[i + 1], bx = line[i + 2], bz = line[i + 3];
      const l = Math.hypot(bx - ax, bz - az) || 1, nx = -(bz - az) / l, nz = (bx - ax) / l;
      for (; carry < l; carry += 1.1) {
        const k = carry / l, o = Math.round(carry) % 2 ? 0.8 : -0.8;
        lights.add(lerp(ax, bx, k) + nx * o, BANK_Y + 0.5, lerp(az, bz, k) + nz * o, rnd() < 0.8 ? lantern : gold, 0.2, 0);
      }
      carry -= l;
    }
  }

  scene.add(traffic(map));
  scene.add(bridges(map, lights));
  scene.add(...metro(map));

  return {
    count,
    /* the haze hides anything past this distance, so it need not be drawn at all */
    update(camera) {
      const reach = 950 + camera.position.y * 9, x = camera.position.x, z = camera.position.z;
      for (const m of meshes) m.visible = Math.hypot(m.userData.c[0] - x, m.userData.c[1] - z) < reach;
    },
    setDim(v) { mat.uniforms.uDim.value = v; },
  };
}
