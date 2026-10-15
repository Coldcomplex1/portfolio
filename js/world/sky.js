import * as THREE from 'three';
import { FOG_GLSL, HASH_GLSL, MOON_DIR, fogUniforms } from './fog.js';
import { time } from './lights.js';
import { moonTexture } from '../textures.js';
import { mulberry32 } from '../util.js';

const MOON_DIST = 2650;

/* The night sky itself: black at altitude, going to the fog colour at the
   horizon, with a thin deck of cloud lit from behind by the moon. */
const SKY_FS = /* glsl */ `
  uniform vec3 uFogColor;
  uniform float uTime;
  varying vec3 vDir;
  ${FOG_GLSL}
  ${HASH_GLSL}
  float cfbm(vec2 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
    return s;
  }
  void main() {
    vec3 d = normalize(vDir);
    vec3 hz = fogTint(uFogColor, d);
    vec3 zen = vec3(0.0011, 0.0017, 0.0032);
    float t = smoothstep(-0.02, 0.62, d.y);
    vec3 c = mix(hz, zen, pow(t, 0.55));
    float m = max(dot(d, MOON_DIR), 0.0);
    c += vec3(0.05, 0.028, 0.009) * pow(m, 1600.0) + vec3(0.011, 0.0058, 0.002) * pow(m, 70.0) + vec3(0.003, 0.0017, 0.0007) * pow(m, 8.0);
    /* a flat cloud deck, so no seam anywhere in the sky */
    if (d.y > 0.015) {
      vec2 cp = d.xz / (d.y + 0.08) * 1.6 + vec2(uTime * 0.0035, uTime * 0.001);
      float cl = smoothstep(0.5, 0.86, cfbm(cp)) * smoothstep(0.02, 0.12, d.y) * (1.0 - smoothstep(0.3, 0.62, d.y));
      vec3 lit = c * 0.55 + vec3(0.010, 0.0075, 0.0055) + vec3(0.08, 0.045, 0.016) * pow(m, 5.0);
      c = mix(c, lit, cl * 0.8);
    }
    gl_FragColor = vec4(c, 1.0);
  }`;

const STAR_VS = /* glsl */ `
  attribute float aMag;
  attribute float aPhase;
  uniform float uTime;
  uniform float uDpr;
  varying float vB;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float tw = 0.7 + 0.3 * sin(uTime * (1.3 + aPhase * 2.1) + aPhase * 40.0);
    vB = aMag * tw * smoothstep(0.02, 0.16, normalize(position).y);
    gl_PointSize = (1.0 + aMag * 1.4) * uDpr;
    gl_Position = projectionMatrix * mv;
  }`;
const STAR_FS = /* glsl */ `
  varying float vB;
  void main() {
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    float a = exp(-dot(c, c) * 3.5);
    gl_FragColor = vec4(vec3(0.82, 0.88, 1.0) * vB * a, 1.0);
  }`;

export function createSky(scene, { dpr = 1 } = {}) {
  /* the whole sky rides along with the camera: it hangs at infinity */
  const group = new THREE.Group();
  scene.add(group);

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(3400, 48, 24),
    new THREE.ShaderMaterial({
      uniforms: { uTime: time, ...fogUniforms },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = position;
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }`,
      fragmentShader: SKY_FS,
      side: THREE.BackSide,
      depthWrite: false,
    }),
  );
  dome.renderOrder = -100;
  dome.frustumCulled = false;
  group.add(dome);

  /* a scatter of stars, faint enough to survive the bloom */
  const rnd = mulberry32(77), N = 1700;
  const sp = new Float32Array(N * 3), sm = new Float32Array(N), sph = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const y = 0.02 + Math.pow(rnd(), 0.8) * 0.98, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - y * y);
    sp[i * 3] = Math.cos(a) * r * 3000; sp[i * 3 + 1] = y * 3000; sp[i * 3 + 2] = Math.sin(a) * r * 3000;
    sm[i] = Math.pow(rnd(), 3.2) * 1.1 + 0.08;
    sph[i] = rnd();
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  sg.setAttribute('aMag', new THREE.BufferAttribute(sm, 1));
  sg.setAttribute('aPhase', new THREE.BufferAttribute(sph, 1));
  const starMat = new THREE.ShaderMaterial({
    uniforms: { uTime: time, uDpr: { value: dpr } },
    vertexShader: STAR_VS, fragmentShader: STAR_FS,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const stars = new THREE.Points(sg, starMat);
  stars.renderOrder = -90;
  stars.frustumCulled = false;
  group.add(stars);

  /* the Mid-Autumn moon: gold, and bright enough for the bloom to find */
  const moonSize = 2 * MOON_DIST * Math.tan(THREE.MathUtils.degToRad(2.5));
  const moon = new THREE.Mesh(
    new THREE.PlaneGeometry(moonSize, moonSize),
    new THREE.MeshBasicMaterial({
      map: moonTexture(384), transparent: true, depthWrite: false, fog: false,
      color: new THREE.Color(1.5, 1.1, 0.7),
    }),
  );
  moon.renderOrder = -80;
  group.add(moon);

  const glowCanvas = document.createElement('canvas');
  glowCanvas.width = glowCanvas.height = 256;
  {
    const g = glowCanvas.getContext('2d'), grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.2, 'rgba(255,255,255,.5)');
    grd.addColorStop(0.45, 'rgba(255,255,255,.12)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 256, 256);
  }
  const glowTex = new THREE.CanvasTexture(glowCanvas);
  const corona = new THREE.Mesh(
    new THREE.PlaneGeometry(moonSize * 4.2, moonSize * 4.2),
    new THREE.MeshBasicMaterial({
      map: glowTex, transparent: true, depthWrite: false, fog: false,
      blending: THREE.AdditiveBlending, color: new THREE.Color(0.07, 0.036, 0.012),
    }),
  );
  corona.renderOrder = -79;
  group.add(corona);

  const v = new THREE.Vector3();
  function update(camera) {
    group.position.copy(camera.position);
    v.copy(MOON_DIR).multiplyScalar(MOON_DIST);
    moon.position.copy(v);
    corona.position.copy(v).multiplyScalar(1.001);
    moon.quaternion.copy(camera.quaternion);
    corona.quaternion.copy(camera.quaternion);
  }
  function setDpr(d) { starMat.uniforms.uDpr.value = d; }

  return { group, update, setDpr };
}
