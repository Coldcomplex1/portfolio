import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { FOG, FOG_GLSL, HASH_GLSL, fogUniforms } from './fog.js';
import { time, hdr, lightMaterial, pointScale } from './lights.js';
import { mulberry32, clamp, lerp } from '../util.js';
import { waterNormalTexture, hazeTexture } from '../textures.js';
import { SAIGON } from '../data/saigon.js';

/* ------------------------------------------------------------ the course of the river */
/* The real river, traced down the middle of its OpenStreetMap outline by
   tools/build_map.py. One unit is ten metres, north is −z, east is +x. Going
   upstream, District 1 and Bình Thạnh are on the left and Thủ Thiêm is on the
   right, the way they are on any map of Saigon. */
const STEP = 4;
const R = SAIGON.river, SEG = R.length / 3 - 1, LEN = SEG * STEP;
const PX = new Float32Array(SEG + 1), PZ = new Float32Array(SEG + 1), HW = new Float32Array(SEG + 1);
const TX = new Float32Array(SEG + 1), TZ = new Float32Array(SEG + 1);
for (let i = 0; i <= SEG; i++) { PX[i] = R[i * 3]; PZ[i] = R[i * 3 + 1]; HW[i] = R[i * 3 + 2]; }
for (let i = 0; i <= SEG; i++) {
  const a = Math.max(0, i - 1), b = Math.min(SEG, i + 1);
  const dx = PX[b] - PX[a], dz = PZ[b] - PZ[a], l = Math.hypot(dx, dz) || 1;
  TX[i] = dx / l; TZ[i] = dz / l;
}

const F = {};
export const RIVER = {
  len: LEN,
  /* half-width: the river runs about 300 m wide through the city */
  hw(d) {
    const u = clamp(d / LEN, 0, 1) * SEG, i = Math.min(SEG - 1, Math.floor(u));
    return lerp(HW[i], HW[i + 1], u - i);
  },
  /* centre, tangent (upstream) and right-hand normal at distance d */
  frame(d, out = F) {
    const u = clamp(d / LEN, 0, 1) * SEG;
    const i = Math.min(SEG - 1, Math.floor(u)), f = u - i;
    out.x = lerp(PX[i], PX[i + 1], f);
    out.z = lerp(PZ[i], PZ[i + 1], f);
    let tx = lerp(TX[i], TX[i + 1], f), tz = lerp(TZ[i], TZ[i + 1], f);
    const l = Math.hypot(tx, tz) || 1;
    out.tx = tx / l; out.tz = tz / l;
    out.rx = -out.tz; out.rz = out.tx;
    out.hw = lerp(HW[i], HW[i + 1], f);
    out.d = d;
    return out;
  },
  point(d, lat, y = 0, v = new THREE.Vector3()) {
    const f = RIVER.frame(d, {});
    return v.set(f.x + f.rx * lat, y, f.z + f.rz * lat);
  },
  /* the nearest place on the river to a point on the map */
  dAt(x, z) {
    let best = 0, bd = Infinity;
    for (let i = 0; i <= SEG; i++) {
      const e = (PX[i] - x) ** 2 + (PZ[i] - z) ** 2;
      if (e < bd) { bd = e; best = i; }
    }
    return best * STEP;
  },
};

/* where the landmarks stand, as distances along the river */
const along = (k) => RIVER.dAt(SAIGON.sites[k].x, SAIGON.sites[k].z);
export const SITES = {
  phuMy: along('phuMy'),
  nhaRong: along('nhaRong'),
  bitexco: along('bitexco'),
  baSon: along('baSon'),
  l81: along('l81'),
};

export const BANK_Y = 0.35;

/* ------------------------------------------------------------ the banks */
const GROUND_VS = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;

/* The city floor: every real street of the map, painted into one texture by
   the city. From the river it is a sliver; from high up it is the whole of
   Saigon at night. Past the edge of the map it fades into its own glow. */
const GROUND_FS = /* glsl */ `
  uniform sampler2D tCity;
  uniform vec4 uCity;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  varying vec3 vWorld;
  ${FOG_GLSL}
  ${HASH_GLSL}
  void main() {
    vec2 uv = (vWorld.xz - uCity.xy) * uCity.zw;
    vec2 e = min(uv, 1.0 - uv);
    float inside = smoothstep(0.0, 0.05, min(e.x, e.y));
    vec3 t = texture2D(tCity, vec2(uv.x, 1.0 - uv.y)).rgb;
    float district = smoothstep(0.25, 0.65, vnoise(vWorld.xz * 0.006 + 3.1));
    vec3 c = vec3(0.0032, 0.0042, 0.0052) + t * t * 1.5;
    vec3 far = vec3(0.0032, 0.0042, 0.0052) + vec3(0.05, 0.023, 0.0075) * mix(0.2, 1.0, district);
    c = mix(far, c, inside);
    vec3 V = vWorld - cameraPosition;
    float fogF = heightFog(cameraPosition, vWorld, uFogDensity);
    c = mix(c, fogTint(uFogColor, normalize(V)), fogF);
    gl_FragColor = vec4(c, 1.0);
  }`;

const WALL_FS = /* glsl */ `
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  varying vec3 vWorld;
  ${FOG_GLSL}
  ${HASH_GLSL}
  void main() {
    float y = vWorld.y;
    vec3 c = vec3(0.008, 0.009, 0.01);
    /* the promenade lamps wash the top of the embankment */
    c += vec3(0.07, 0.042, 0.018) * smoothstep(-0.6, 0.35, y);
    /* tide line */
    c *= 0.55 + 0.45 * smoothstep(-0.1, 0.12, y);
    c *= 0.85 + 0.3 * hash12(floor(vWorld.xz * 0.5));
    float fogF = heightFog(cameraPosition, vWorld, uFogDensity);
    c = mix(c, fogTint(uFogColor, normalize(vWorld - cameraPosition)), fogF);
    gl_FragColor = vec4(c, 1.0);
  }`;

/* Every piece of land from the map, cut around the water, with an embankment
   wall dropped from each shoreline. */
function bankGeometries(map) {
  const { landXZ: xz, landRingN: ringN, landPolyN: polyN, quant: Q } = map;
  const top = [], topIdx = [], wall = [], wallIdx = [], shores = [];
  let at = 0, r = 0;
  for (let pi = 0; pi < polyN.length; pi++) {
    const rings = [];
    for (let k = 0; k < polyN[pi]; k++) {
      const n = ringN[r++], ring = [];
      for (let i = 0; i < n; i++) ring.push(new THREE.Vector2(xz[at + i * 2] / Q, xz[at + i * 2 + 1] / Q));
      at += n * 2;
      rings.push(ring);
    }
    shores.push(...rings);
    const base = top.length / 3;
    for (const ring of rings) for (const v of ring) top.push(v.x, BANK_Y, v.y);
    for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(rings[0], rings.slice(1))) topIdx.push(base + a, base + b, base + c);
  }
  for (const ring of shores) {
    const base = wall.length / 3, n = ring.length;
    for (const v of ring) wall.push(v.x, BANK_Y, v.y, v.x, -2.5, v.y);
    for (let i = 0; i < n; i++) {
      const a = base + i * 2, b = base + ((i + 1) % n) * 2;
      wallIdx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  /* beyond the survey the land simply carries on into the haze */
  const [x0, x1, z0, z1] = SAIGON.extent, F = 7000;
  const base = top.length / 3;
  for (const [ax, az, bx, bz] of [[-F, -F, F, z0], [-F, z1, F, F], [-F, z0, x0, z1], [x1, z0, F, z1]]) {
    const k = top.length / 3;
    top.push(ax, BANK_Y, az, bx, BANK_Y, az, ax, BANK_Y, bz, bx, BANK_Y, bz);
    topIdx.push(k, k + 1, k + 2, k + 2, k + 1, k + 3);
  }
  const mesh = (pos, idx) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeBoundingSphere();
    return g;
  };
  return { top: mesh(top, topIdx), wall: mesh(wall, wallIdx), shores };
}

/* ------------------------------------------------------------ the water */
/* A planar mirror, sampled along a short vertical smear — night water
   stretches every light into a column — and roughened by a tiling normal
   map at three scales. The moon throws a road of glints toward the viewer. */
const WaterShader = {
  name: 'SaigonWater',
  uniforms: {
    color: { value: null },
    tDiffuse: { value: null },
    textureMatrix: { value: null },
    tNormal: { value: null },
    uTime: { value: 0 },
    uFogColor: { value: null },
    uFogDensity: { value: FOG.density },
    uDeep: { value: new THREE.Color('#020507') },
    uMoonCol: { value: hdr('#ffc070', 1.5) },
    uSmear: { value: 1 },
  },
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vMirror;
    varying vec3 vWorld;
    void main() {
      vMirror = textureMatrix * vec4(position, 1.0);
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorld = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D tNormal;
    uniform float uTime;
    uniform vec3 uFogColor;
    uniform float uFogDensity;
    uniform vec3 uDeep;
    uniform vec3 uMoonCol;
    uniform float uSmear;
    varying vec4 vMirror;
    varying vec3 vWorld;
    ${FOG_GLSL}
    vec3 waterNormal(vec2 p, float dist) {
      vec2 q = p * vec2(1.0, 0.6);      /* ripples run across the current */
      vec2 n0 = texture2D(tNormal, q / 43.0 + vec2(0.004, 0.009) * uTime).xy * 2.0 - 1.0;
      vec2 n1 = texture2D(tNormal, q / 13.0 + vec2(-0.011, 0.015) * uTime).xy * 2.0 - 1.0;
      vec2 n2 = texture2D(tNormal, q / 4.3 + vec2(0.021, -0.027) * uTime).xy * 2.0 - 1.0;
      float fine = 1.0 - smoothstep(25.0, 120.0, dist);
      vec2 s = n0 * 0.55 + n1 * 0.4 + n2 * 0.32 * fine;
      return normalize(vec3(s.x, 1.0, s.y));
    }
    void main() {
      vec3 toCam = cameraPosition - vWorld;
      float dist = length(toCam);
      vec3 V = toCam / dist;
      vec3 N = waterNormal(vWorld.xz, dist);
      vec2 uv = vMirror.xy / vMirror.w;
      float graze = 1.0 - clamp(V.y, 0.0, 1.0);
      vec2 off = vec2(N.x * 0.016, N.z * 0.05) * (0.3 + 0.7 * graze) / (1.0 + dist * 0.004);
      vec3 refl = vec3(0.0);
      float wsum = 0.0;
      for (int i = -3; i <= 3; i++) {
        float fi = float(i);
        float w = exp(-fi * fi / 5.0);
        refl += texture2D(tDiffuse, uv + off + vec2(0.0, fi * 0.0042 * uSmear)).rgb * w;
        wsum += w;
      }
      refl /= wsum;
      float fres = 0.14 + 0.86 * pow(1.0 - max(dot(N, V), 0.0), 4.0);
      vec3 c = uDeep * (1.0 - fres) + refl * fres * 0.82;
      vec3 H = normalize(V + MOON_DIR);
      c += uMoonCol * pow(max(dot(N, H), 0.0), 900.0);
      float fogF = heightFog(cameraPosition, vWorld, uFogDensity);
      c = mix(c, fogTint(uFogColor, -V), fogF);
      gl_FragColor = vec4(c, 1.0);
    }`,
};

/* ------------------------------------------------------------ hoa đăng: the floating lanterns */
const LANTERN_VS = /* glsl */ `
  attribute float aSeed;
  uniform float uTime;
  uniform float uPx;
  uniform float uFogDensity;
  varying float vI;
  varying float vSeed;
  ${FOG_GLSL}
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vec4 mv = viewMatrix * wp;
    float s = 0.3 * uPx / max(-mv.z, 0.01);
    float flick = 0.78 + 0.22 * sin(uTime * 7.3 + aSeed * 40.0) * sin(uTime * 2.9 + aSeed * 13.0);
    float energy = s < 2.0 ? (s * s) / 4.0 : 1.0;
    vI = flick * energy * (1.0 - heightFog(cameraPosition, wp.xyz, uFogDensity));
    vSeed = aSeed;
    gl_PointSize = clamp(s, 2.0, 56.0);
    gl_Position = projectionMatrix * mv;
  }`;
const LANTERN_FS = /* glsl */ `
  varying float vI;
  varying float vSeed;
  void main() {
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(c, c);
    if (r2 > 1.0) discard;
    float core = exp(-r2 * 16.0), halo = exp(-r2 * 3.2) * 0.32;
    vec3 warm = mix(vec3(3.4, 1.55, 0.5), vec3(3.2, 0.8, 0.35), step(0.7, vSeed));
    gl_FragColor = vec4((warm * core + vec3(1.0, 0.34, 0.1) * halo) * vI, 1.0);
  }`;

/* ------------------------------------------------------------ the mist */
const HAZE_FS = /* glsl */ `
  uniform sampler2D map;
  uniform float uOpacity;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  varying vec2 vUv;
  varying vec3 vWorld;
  ${FOG_GLSL}
  void main() {
    float a = texture2D(map, vUv).a;
    vec3 V = vWorld - cameraPosition;
    float dist = length(V);
    vec3 dir = V / dist;
    float nearFade = smoothstep(8.0, 34.0, dist);
    vec3 col = fogTint(uFogColor, dir) * 2.6 + vec3(0.004, 0.0055, 0.007);
    float fogF = heightFog(cameraPosition, vWorld, uFogDensity);
    gl_FragColor = vec4(col, a * uOpacity * nearFade * (1.0 - 0.6 * fogF));
  }`;

/* ------------------------------------------------------------ build */
export function createRiver(scene, { map, cityTexture, lights, reflectScale = 0.5, lanterns = 240, mobile = false }) {
  const group = new THREE.Group();
  scene.add(group);
  const rnd = mulberry32(42);

  /* banks */
  const C = SAIGON.city;
  const groundMat = new THREE.ShaderMaterial({
    uniforms: {
      tCity: { value: cityTexture },
      uCity: { value: new THREE.Vector4(C.x0, C.z0, 1 / (C.x1 - C.x0), 1 / (C.z1 - C.z0)) },
      ...fogUniforms,
    },
    vertexShader: GROUND_VS, fragmentShader: GROUND_FS, side: THREE.DoubleSide,
  });
  const wallMat = new THREE.ShaderMaterial({
    uniforms: { ...fogUniforms },
    vertexShader: GROUND_VS, fragmentShader: WALL_FS, side: THREE.DoubleSide,
  });
  const banks = bankGeometries(map);
  const land = new THREE.Mesh(banks.top, groundMat), walls = new THREE.Mesh(banks.wall, wallMat);
  land.frustumCulled = walls.frustumCulled = false;
  group.add(land, walls);

  /* promenade lamps down both banks of the river itself, not the canals */
  const lamp = hdr('#ffd2a0', 1.5), lampCool = hdr('#d9e6ff', 1.2);
  const reach = [SITES.nhaRong - 420, SITES.l81 + 500];
  const shoreFrame = {};
  for (const ring of banks.shores) {
    let carry = 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length], len = a.distanceTo(b);
      for (let t = carry; t < len; t += 3.4) {
        const x = lerp(a.x, b.x, t / len), z = lerp(a.y, b.y, t / len);
        const d = RIVER.dAt(x, z);
        RIVER.frame(d, shoreFrame);
        const off = Math.hypot(x - shoreFrame.x, z - shoreFrame.z);
        if (d < reach[0] || d > reach[1] || off > shoreFrame.hw * 1.7) continue;
        const k = 0.7 / off, c = Math.floor(d / 160) % 3 === 0 ? lampCool : lamp;
        lights.add(x + (x - shoreFrame.x) * k, BANK_Y + 0.42, z + (z - shoreFrame.z) * k, c, 0.2);
      }
      carry = Math.max(0, carry - len);
      carry = (carry + 3.4 - (len % 3.4)) % 3.4;
    }
  }

  /* water */
  const normalTex = waterNormalTexture(256);
  const water = new Reflector(new THREE.PlaneGeometry(14000, 14000), {
    clipBias: 0.003,
    textureWidth: 512,
    textureHeight: 512,
    multisample: 0,
    shader: WaterShader,
  });
  water.rotation.x = -Math.PI / 2;
  const wu = water.material.uniforms;
  wu.tNormal.value = normalTex;
  wu.uFogColor.value = FOG.color;
  if (mobile) wu.uSmear.value = 1.3;
  group.add(water);

  function resizeReflection(w, h) {
    water.getRenderTarget().setSize(Math.max(64, Math.round(w * reflectScale)), Math.max(64, Math.round(h * reflectScale)));
  }

  /* hoa đăng, released around the bend and drifting down with the current */
  const dA = SITES.nhaRong - 150, dB = SITES.l81 + 90;
  const L = {
    n: lanterns,
    d: new Float32Array(lanterns), lat: new Float32Array(lanterns),
    v: new Float32Array(lanterns), ph: new Float32Array(lanterns),
  };
  const lPos = new Float32Array(lanterns * 3), lSeed = new Float32Array(lanterns);
  for (let i = 0; i < lanterns; i++) {
    /* thicker near the start of the journey, thinning upstream */
    L.d[i] = lerp(dA, dB, Math.pow(rnd(), 1.35));
    L.lat[i] = (rnd() * 2 - 1) * 0.82;
    L.v[i] = 0.25 + rnd() * 0.45;
    L.ph[i] = rnd() * 100;
    lSeed[i] = rnd();
  }
  const lGeo = new THREE.BufferGeometry();
  lGeo.setAttribute('position', new THREE.BufferAttribute(lPos, 3).setUsage(THREE.DynamicDrawUsage));
  lGeo.setAttribute('aSeed', new THREE.BufferAttribute(lSeed, 1));
  const lMat = new THREE.ShaderMaterial({
    uniforms: { uTime: time, uPx: pointScale, ...fogUniforms },
    vertexShader: LANTERN_VS, fragmentShader: LANTERN_FS,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const lanternPts = new THREE.Points(lGeo, lMat);
  lanternPts.frustumCulled = false;
  group.add(lanternPts);

  /* tour boats strung with coloured bulbs, as on any night on the Saigon River */
  const boats = [];
  const hullMat = new THREE.MeshBasicMaterial({ color: '#06080a' });
  const cabinMat = new THREE.MeshBasicMaterial({ color: '#0b0e11' });
  const glassMat = new THREE.MeshBasicMaterial({ color: hdr('#ffc98e', 2.2) });
  const palettes = [
    ['#ff3b4a', '#ffc04a', '#ff3b4a', '#ffffff'],
    ['#4ad8ff', '#a65bff', '#ffffff', '#4ad8ff'],
    ['#ffc04a', '#ff7a3c', '#ffe9b0', '#ffc04a'],
    ['#ff4fa3', '#4ad8ff', '#ffc04a', '#ffffff'],
  ];
  for (let b = 0; b < 4; b++) {
    const boat = new THREE.Group();
    const len = 4.4 + rnd() * 1.6;
    boat.add(new THREE.Mesh(new THREE.BoxGeometry(len, 0.42, 1.3).translate(0, 0.21, 0), hullMat));
    boat.add(new THREE.Mesh(new THREE.BoxGeometry(len * 0.7, 0.5, 1.06).translate(-len * 0.05, 0.67, 0), cabinMat));
    boat.add(new THREE.Mesh(new THREE.BoxGeometry(len * 0.68, 0.16, 1.08).translate(-len * 0.05, 0.7, 0), glassMat));
    boat.add(new THREE.Mesh(new THREE.BoxGeometry(len * 0.45, 0.32, 0.9).translate(-len * 0.1, 1.08, 0), cabinMat));
    const pal = palettes[b].map((h) => hdr(h, 2.4));
    const bp = [], bc = [], bs = [], bb = [];
    const ring = (w, d2, y, n) => {
      for (let i = 0; i < n; i++) {
        const t = i / n, per = 2 * (w + d2), s = t * per;
        let x, z;
        if (s < w) { x = -w / 2 + s; z = -d2 / 2; }
        else if (s < w + d2) { x = w / 2; z = -d2 / 2 + (s - w); }
        else if (s < 2 * w + d2) { x = w / 2 - (s - w - d2); z = d2 / 2; }
        else { x = -w / 2; z = d2 / 2 - (s - 2 * w - d2); }
        const c = pal[i % pal.length];
        bp.push(x - len * 0.05, y, z); bc.push(c.r, c.g, c.b); bs.push(0.13); bb.push(0);
      }
    };
    ring(len * 0.72, 1.12, 0.95, 40);
    ring(len * 0.47, 0.94, 1.27, 26);
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.Float32BufferAttribute(bp, 3));
    bg.setAttribute('aColor', new THREE.Float32BufferAttribute(bc, 3));
    bg.setAttribute('aSize', new THREE.Float32BufferAttribute(bs, 1));
    bg.setAttribute('aBlink', new THREE.Float32BufferAttribute(bb, 1));
    const bulbs = new THREE.Points(bg, lightMaterial());
    bulbs.frustumCulled = false;
    boat.add(bulbs);
    group.add(boat);
    boats.push({
      obj: boat,
      d: lerp(dA + 20, dB - 20, (b + rnd() * 0.5) / 4),
      lat: (b % 2 ? 0.42 : -0.18) + (rnd() - 0.5) * 0.12,
      v: (b % 2 ? -1 : 1) * (0.9 + rnd() * 0.6),
    });
  }

  /* lục bình: rafts of water hyacinth riding the current, as they always do here */
  const rafts = [];
  const raftGeo = new THREE.IcosahedronGeometry(1, 1);
  raftGeo.scale(1, 0.14, 0.72);
  const rn = mobile ? 34 : 80;
  const leaves = new THREE.InstancedMesh(raftGeo, new THREE.MeshBasicMaterial({ color: '#0a120c' }), rn);
  const flowers = new THREE.InstancedMesh(new THREE.SphereGeometry(0.06, 6, 4), new THREE.MeshBasicMaterial({ color: hdr('#c4b0ff', 1.1) }), rn);
  leaves.frustumCulled = flowers.frustumCulled = false;
  for (let i = 0; i < rn; i++) {
    rafts.push({
      d: lerp(dA, dB, rnd()), lat: (rnd() * 2 - 1) * 0.86, v: 0.12 + rnd() * 0.22,
      size: 0.35 + rnd() * rnd() * 1.5, yaw: rnd() * Math.PI, ph: rnd() * 100,
    });
  }
  group.add(leaves, flowers);

  /* slabs of mist low on the water, turned to face the camera */
  const hazeTex = hazeTexture();
  const hazeMat = new THREE.ShaderMaterial({
    uniforms: { map: { value: hazeTex }, uOpacity: { value: 0.16 }, ...fogUniforms },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vWorld;
      void main() {
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: HAZE_FS,
    transparent: true, depthWrite: false,
  });
  const hazes = [];
  const hGeo = new THREE.PlaneGeometry(1, 1);
  for (let i = 0; i < (mobile ? 9 : 16); i++) {
    const m = new THREE.Mesh(hGeo, hazeMat);
    const d = lerp(dA, dB + 100, i / (mobile ? 9 : 16)) + rnd() * 30;
    const f = RIVER.frame(d, {});
    const lat = (rnd() * 2 - 1) * f.hw * 0.9;
    m.position.set(f.x + f.rx * lat, 1.2 + rnd() * 1.6, f.z + f.rz * lat);
    m.scale.set(60 + rnd() * 60, 7 + rnd() * 6, 1);
    m.layers.set(1);
    m.renderOrder = 2;
    group.add(m);
    hazes.push({ m, d, lat, v: 0.2 + rnd() * 0.3 });
  }

  /* the mirror is the costliest thing on screen, and it only matters near the
     river: away from it, one refresh now and then is plenty */
  const mirror = water.onBeforeRender;
  let frame = 0;
  water.onBeforeRender = (...a) => { if (frame === 0) mirror.call(water, ...a); };

  const tmp = {}, M = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), S = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
  function update(dt, t, camera) {
    wu.uTime.value = t;
    wu.uFogDensity.value = fogUniforms.uFogDensity.value;
    RIVER.frame(RIVER.dAt(camera.position.x, camera.position.z), tmp);
    const away = Math.hypot(camera.position.x - tmp.x, camera.position.z - tmp.z) > 120;
    frame = away ? (frame + 1) % 45 : 0;

    for (let i = 0; i < L.n; i++) {
      let d = L.d[i] - L.v[i] * dt;
      if (d < dA) d += dB - dA;
      L.d[i] = d;
      const f = RIVER.frame(d, tmp);
      const lat = (L.lat[i] + 0.03 * Math.sin(t * 0.21 + L.ph[i])) * f.hw;
      lPos[i * 3] = f.x + f.rx * lat;
      lPos[i * 3 + 1] = 0.1 + 0.02 * Math.sin(t * 1.3 + L.ph[i]);
      lPos[i * 3 + 2] = f.z + f.rz * lat;
    }
    lGeo.attributes.position.needsUpdate = true;

    for (const b of boats) {
      b.d += b.v * dt;
      if (b.d > dB) b.d = dA + 1;
      if (b.d < dA) b.d = dB - 1;
      const f = RIVER.frame(b.d, tmp);
      const lat = b.lat * f.hw;
      b.obj.position.set(f.x + f.rx * lat, 0.02 + 0.03 * Math.sin(t * 0.9 + b.d), f.z + f.rz * lat);
      const s = Math.sign(b.v);
      b.obj.rotation.y = Math.atan2(-f.tz * s, f.tx * s);
    }

    rafts.forEach((r, i) => {
      r.d -= r.v * dt;
      if (r.d < dA) r.d += dB - dA;
      const f = RIVER.frame(r.d, tmp), lat = r.lat * f.hw;
      P.set(f.x + f.rx * lat, 0.05 + 0.02 * Math.sin(t * 0.8 + r.ph), f.z + f.rz * lat);
      Q.setFromAxisAngle(UP, r.yaw + 0.05 * Math.sin(t * 0.2 + r.ph));
      M.compose(P, Q, S.setScalar(r.size));
      leaves.setMatrixAt(i, M);
      P.y += 0.12 * r.size;
      flowers.setMatrixAt(i, M.compose(P, Q, S.setScalar(r.size * 0.7)));
    });
    leaves.instanceMatrix.needsUpdate = flowers.instanceMatrix.needsUpdate = true;

    for (const h of hazes) {
      h.m.rotation.y = Math.atan2(camera.position.x - h.m.position.x, camera.position.z - h.m.position.z);
    }
  }

  return { group, water, update, resizeReflection };
}
