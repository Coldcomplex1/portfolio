import * as THREE from 'three';
import { FOG_GLSL, fogUniforms } from './fog.js';
import { time, pointScale } from './lights.js';
import { petalTexture } from '../textures.js';
import { mulberry32, damp, lerp, smooth, REDUCE, COARSE } from '../util.js';

/* ------------------------------------------------------------ the petal fall */
/* Phượng petals — the flame tree that blooms when Vietnamese students
   graduate. A box of petals rides around the camera; each one falls,
   side-slips and tumbles on the GPU, and wraps back to the top of the box. */
const PETAL_VS = /* glsl */ `
  attribute vec4 aRand;
  uniform float uTime;
  uniform vec3 uCam;
  uniform float uBox;
  varying vec2 vUv;
  varying float vShade;
  varying float vAlpha;
  varying vec3 vWorld;
  varying float vHue;
  mat3 rotAxis(vec3 a, float ang) {
    float s = sin(ang), c = cos(ang), oc = 1.0 - c;
    return mat3(oc * a.x * a.x + c,       oc * a.x * a.y + a.z * s, oc * a.z * a.x - a.y * s,
                oc * a.x * a.y - a.z * s, oc * a.y * a.y + c,       oc * a.y * a.z + a.x * s,
                oc * a.z * a.x + a.y * s, oc * a.y * a.z - a.x * s, oc * a.z * a.z + c);
  }
  void main() {
    float B = uBox;
    vec3 base = aRand.xyz * B;
    float fall = 0.42 + aRand.w * 0.5;
    vec3 p = base + vec3(0.32, -fall, 0.1) * uTime;
    /* the side-slip of a petal shedding air off one edge, then the other */
    p.x += sin(uTime * 0.9 + aRand.x * 31.0) * 0.6;
    p.z += cos(uTime * 0.7 + aRand.y * 17.0) * 0.5;
    vec3 rel = mod(p - uCam, B) - 0.5 * B;
    vec3 centre = uCam + rel + vec3(0.0, B * 0.22, 0.0);
    vec3 axis = normalize(vec3(aRand.y - 0.5, 0.7, aRand.x - 0.5));
    mat3 R = rotAxis(axis, uTime * (1.3 + aRand.w * 2.2) + aRand.z * 6.2831);
    float size = 0.075 + aRand.w * 0.06;
    vec3 wp = centre + R * (position * size);
    vShade = 0.42 + 0.58 * abs((R * vec3(0.0, 0.0, 1.0)).y);
    float dist = length(wp - cameraPosition);
    vAlpha = smoothstep(1.8, 4.0, dist) * (1.0 - smoothstep(B * 0.36, B * 0.5, dist)) * step(0.05, wp.y);
    vUv = uv;
    vWorld = wp;
    vHue = aRand.z;
    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  }`;

const PETAL_FS = /* glsl */ `
  uniform sampler2D map;
  uniform float uOpacity;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  varying vec2 vUv;
  varying float vShade;
  varying float vAlpha;
  varying vec3 vWorld;
  varying float vHue;
  ${FOG_GLSL}
  void main() {
    vec4 t = texture2D(map, vUv);
    float a = t.a * vAlpha * uOpacity;
    if (a < 0.01) discard;
    vec3 tint = mix(vec3(0.95, 0.11, 0.05), vec3(1.0, 0.32, 0.08), vHue);
    vec3 rgb = (t.rgb / max(t.a, 1e-3)) * tint * vShade;
    float f = heightFog(cameraPosition, vWorld, uFogDensity);
    rgb = mix(rgb, fogTint(uFogColor, normalize(vWorld - cameraPosition)), f);
    gl_FragColor = vec4(rgb * a, a);
  }`;

export function createPetals(scene, { count = 380 } = {}) {
  const rnd = mulberry32(31);
  const plane = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = plane.index;
  geo.setAttribute('position', plane.attributes.position);
  geo.setAttribute('uv', plane.attributes.uv);
  const r = new Float32Array(count * 4);
  for (let i = 0; i < r.length; i++) r[i] = rnd();
  geo.setAttribute('aRand', new THREE.InstancedBufferAttribute(r, 4));
  geo.instanceCount = count;
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      map: { value: petalTexture() },
      uTime: { value: 0 },
      uCam: { value: new THREE.Vector3() },
      uBox: { value: 34 },
      uOpacity: { value: 1 },
      ...fogUniforms,
    },
    vertexShader: PETAL_VS, fragmentShader: PETAL_FS,
    transparent: true, depthWrite: false, premultipliedAlpha: true, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.layers.set(1);
  scene.add(mesh);
  return {
    update(t, camera) {
      /* petals belong to the riverbank; they thin out as the camera climbs */
      mat.uniforms.uTime.value = REDUCE ? t * 0.35 : t;
      mat.uniforms.uCam.value.copy(camera.position);
      mat.uniforms.uOpacity.value = 0.85 * (1 - smooth(12, 26, camera.position.y));
    },
  };
}

/* ------------------------------------------------------------ the cursor wisps */
/* Fireflies trail the pointer: round motes, emitted where the hand moves,
   rising and fraying on a little curl, softening as they die. They hang a
   few metres in front of the lens and never appear in the river's mirror. */
const WISP_VS = /* glsl */ `
  attribute float aLife;
  attribute float aSize;
  uniform float uPx;
  varying float vA;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float env = smoothstep(0.0, 0.12, aLife) * (1.0 - smoothstep(0.5, 1.0, aLife));
    vA = env * step(aLife, 0.999);
    gl_PointSize = max(1.0, aSize * (1.0 - 0.35 * aLife) * uPx / max(-mv.z, 0.1));
    gl_Position = projectionMatrix * mv;
  }`;
const WISP_FS = /* glsl */ `
  varying float vA;
  void main() {
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(c, c);
    if (r2 > 1.0 || vA <= 0.0) discard;
    float a = exp(-r2 * 6.0) + 0.18 * (1.0 - r2);
    gl_FragColor = vec4(vec3(2.6, 1.7, 0.62) * a * vA, 1.0);
  }`;

export function createWisps(camera, { max = 140 } = {}) {
  const pos = new Float32Array(max * 3), vel = new Float32Array(max * 3);
  const life = new Float32Array(max).fill(1), ttl = new Float32Array(max).fill(1), size = new Float32Array(max);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aLife', new THREE.BufferAttribute(life, 1).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  const pts = new THREE.Points(geo, new THREE.ShaderMaterial({
    uniforms: { uPx: pointScale },
    vertexShader: WISP_VS, fragmentShader: WISP_FS,
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
  }));
  pts.frustumCulled = false;
  pts.renderOrder = 50;
  pts.layers.set(1);
  camera.add(pts);

  const rnd = mulberry32(9);
  const D = 3.2;
  const em = new THREE.Vector3(0, -0.4, -D), target = new THREE.Vector3(), prev = new THREE.Vector3();
  let next = 0, carry = 0;

  const pointer = { active: false };
  function spawn(n, ex, ey, ez, vx, vy) {
    for (let k = 0; k < n; k++) {
      const i = next; next = (next + 1) % max;
      pos[i * 3] = ex + (rnd() - 0.5) * 0.06;
      pos[i * 3 + 1] = ey + (rnd() - 0.5) * 0.06;
      pos[i * 3 + 2] = ez + (rnd() - 0.5) * 0.3;
      vel[i * 3] = vx * 0.25 + (rnd() - 0.5) * 0.16;
      vel[i * 3 + 1] = vy * 0.25 + 0.06 + rnd() * 0.1;
      vel[i * 3 + 2] = (rnd() - 0.5) * 0.08;
      life[i] = 0;
      ttl[i] = 1.6 + rnd() * 1.8;
      size[i] = pointer.active ? 0.016 + rnd() * 0.026 : 0.01 + rnd() * 0.016;
    }
    geo.attributes.aSize.needsUpdate = true;
  }

  return {
    update(dt, t, ptr) {
      pointer.active = ptr.active && !COARSE;
      const tv = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2), th = tv * camera.aspect;
      let rate;
      if (pointer.active) {
        target.set(ptr.nx * th * D, ptr.ny * tv * D, -D);
        rate = 6 + Math.min(ptr.speed / Math.max(dt, 1e-3), 6) * 26;
      } else {
        /* no pointer to brush it with: a slow wanderer low in the frame */
        target.set(Math.sin(t * 0.23) * th * D * 0.55, (-0.35 + Math.cos(t * 0.31) * 0.2) * tv * D, -D);
        rate = 2.2;
      }
      if (REDUCE) rate *= 0.3;
      prev.copy(em);
      em.x = damp(em.x, target.x, 9, dt);
      em.y = damp(em.y, target.y, 9, dt);
      em.z = target.z;
      const vx = (em.x - prev.x) / Math.max(dt, 1e-3), vy = (em.y - prev.y) / Math.max(dt, 1e-3);
      carry += rate * dt;
      const n = Math.floor(carry);
      carry -= n;
      if (n > 0) {
        /* lay each one at the distance along the segment it is owed */
        for (let k = 0; k < n; k++) {
          const s = (k + 1) / n;
          spawn(1, lerp(prev.x, em.x, s), lerp(prev.y, em.y, s), em.z, vx, vy);
        }
      }
      for (let i = 0; i < max; i++) {
        if (life[i] >= 1) continue;
        const x = pos[i * 3], y = pos[i * 3 + 1];
        /* curl-ish drift, so the trail frays instead of streaming in one line */
        vel[i * 3] += Math.sin(y * 4.1 + t * 0.8 + i) * 0.12 * dt;
        vel[i * 3 + 1] += (0.05 + Math.cos(x * 3.7 + t * 0.6) * 0.06) * dt;
        const k = Math.exp(-0.7 * dt);
        vel[i * 3] *= k; vel[i * 3 + 1] *= k; vel[i * 3 + 2] *= k;
        pos[i * 3] += vel[i * 3] * dt;
        pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
        pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
        life[i] = Math.min(1, life[i] + dt / ttl[i]);
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.aLife.needsUpdate = true;
    },
  };
}
