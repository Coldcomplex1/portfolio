import * as THREE from 'three';
import { FOG_GLSL, HASH_GLSL, fogUniforms } from './fog.js';
import { time } from './lights.js';
import { reedsTexture, nipaTexture, phuongTexture, wordmarkTexture } from '../textures.js';
import { easeOut, smooth, REDUCE } from '../util.js';

/* The hero's foreground: cut-out plates hung at their own depths in front of
   the opening camera, sized against the frustum at that depth, and the giant
   wordmark standing in the river behind them. */

const CUT_VS = /* glsl */ `
  uniform float uTime;
  uniform float uSway;
  uniform float uFrom;
  varying vec2 vUv;
  varying vec3 vWorld;
  void main() {
    vUv = uv;
    vec3 p = position;
    float k = uFrom > 0.5 ? (1.0 - uv.y) : uv.y;
    k *= k;
    p.x += (sin(uTime * 0.8 + uv.x * 3.0) + 0.35 * sin(uTime * 2.1 + uv.x * 11.0)) * uSway * k;
    vec4 wp = modelMatrix * vec4(p, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;

const CUT_FS = /* glsl */ `
  uniform sampler2D map;
  uniform float uOpacity;
  uniform vec3 uTint;
  uniform float uGlow;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  varying vec2 vUv;
  varying vec3 vWorld;
  ${FOG_GLSL}
  void main() {
    vec4 t = texture2D(map, vUv);
    if (t.a < 0.004) discard;
    vec3 rgb = t.rgb / t.a;
    float red = clamp(rgb.r - max(rgb.g, rgb.b) * 1.2, 0.0, 1.0);
    rgb = rgb * uTint + vec3(1.0, 0.22, 0.07) * red * uGlow;
    float f = heightFog(cameraPosition, vWorld, uFogDensity);
    rgb = mix(rgb, fogTint(uFogColor, normalize(vWorld - cameraPosition)), f);
    float a = t.a * uOpacity;
    gl_FragColor = vec4(rgb * a, a);
  }`;

/* the wordmark rises out of the river, then burns away as the camera closes */
const WORD_FS = /* glsl */ `
  uniform sampler2D map;
  uniform float uOpacity;
  uniform float uDissolve;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  varying vec2 vUv;
  varying vec3 vWorld;
  ${HASH_GLSL}
  ${FOG_GLSL}
  void main() {
    vec4 t = texture2D(map, vUv);
    if (t.a < 0.004) discard;
    float n = vnoise(vUv * vec2(40.0, 9.0)) * 0.62 + vnoise(vUv * vec2(170.0, 40.0)) * 0.38;
    float edge = uDissolve * 1.2 - 0.1;
    float keep = smoothstep(edge - 0.035, edge + 0.035, n);
    float burn = (1.0 - smoothstep(0.0, 0.06, abs(n - edge))) * step(0.001, uDissolve);
    vec3 rgb = (t.rgb / t.a) * vec3(0.86, 0.9, 0.87);
    rgb += vec3(2.0, 0.6, 0.14) * burn;
    float f = heightFog(cameraPosition, vWorld, uFogDensity);
    rgb = mix(rgb, fogTint(uFogColor, normalize(vWorld - cameraPosition)), f * 0.8);
    float a = t.a * uOpacity * keep;
    gl_FragColor = vec4(rgb * a, a);
  }`;

const PLATE_VS_WORD = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorld;
  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;

function plate(tex, { sway = 0.04, from = 'bottom', tint = [1, 1, 1], glow = 0 } = {}) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      map: { value: tex },
      uTime: time,
      uSway: { value: sway },
      uFrom: { value: from === 'top' ? 1 : 0 },
      uOpacity: { value: 1 },
      uTint: { value: new THREE.Vector3(...tint) },
      uGlow: { value: glow },
      ...fogUniforms,
    },
    vertexShader: CUT_VS, fragmentShader: CUT_FS,
    transparent: true, depthWrite: false, premultipliedAlpha: true,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  m.layers.set(1);
  m.frustumCulled = false;
  return m;
}

export function createForeground(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const reedsFar = plate(reedsTexture(17, 1, 2048, 512), { sway: 0.05, tint: [0.85, 0.9, 0.95] });
  const reedsNear = plate(reedsTexture(3, 0, 2048, 512), { sway: 0.06 });
  const nipa = plate(nipaTexture(5), { sway: 0.07 });
  const phuong = plate(phuongTexture(9), { sway: 0.05, from: 'top', glow: 0.25 });
  reedsFar.renderOrder = 20; reedsNear.renderOrder = 23; nipa.renderOrder = 24; phuong.renderOrder = 22;
  const plates = [
    /* mesh, depth, width as a share of the frame, texture aspect, anchor */
    { m: reedsFar, D: 9.5, wf: 1.3, asp: 4, place: 'bottom', sink: 0.06 },
    { m: reedsNear, D: 4.4, wf: 1.24, asp: 4, place: 'bottom', sink: 0.1 },
    { m: nipa, D: 3.7, hf: 1.2, asp: 1, place: 'left', hung: true },
    { m: phuong, D: 5.6, wf: 0.46, asp: 4 / 3, place: 'topright', hung: true },
  ];
  plates.forEach((p) => group.add(p.m));

  const W = wordmarkTexture('QUYET');
  const wordMat = new THREE.ShaderMaterial({
    uniforms: { map: { value: W.texture }, uOpacity: { value: 0 }, uDissolve: { value: 0 }, ...fogUniforms },
    vertexShader: PLATE_VS_WORD, fragmentShader: WORD_FS,
    transparent: true, depthWrite: false, premultipliedAlpha: true,
  });
  const word = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), wordMat);
  word.renderOrder = 10;
  word.frustumCulled = false;
  group.add(word);

  const tmp = new THREE.Vector3(), fwd = new THREE.Vector3();
  let wordH = 1, wordBase = 0, rise = REDUCE ? 1 : 0, rising = false;

  /* pose: the hero camera as composed by the rig */
  function layout(pose) {
    const { pos, quat, fov, aspect } = pose;
    const tv = Math.tan(THREE.MathUtils.degToRad(fov) / 2);
    for (const p of plates) {
      const hh = p.D * tv, hw = hh * aspect;
      let w, h, x, y;
      if (p.place === 'bottom') {
        w = 2 * hw * p.wf; h = w / p.asp;
        x = 0; y = -hh - p.sink * h + h / 2;
      } else if (p.place === 'left') {
        h = Math.min(2 * hh * p.hf * 0.5, 2.6 * hw); w = h * p.asp;
        x = -hw + w * 0.2; y = -hh + h * 0.42;
      } else {
        w = 2 * hw * p.wf * (aspect < 1 ? 1.5 : 1); h = w / p.asp;
        x = hw - w * 0.24; y = hh - h * 0.27;
      }
      p.m.geometry.dispose();
      p.m.geometry = new THREE.PlaneGeometry(w, h, 8, 4);
      tmp.set(x, y, -p.D).applyQuaternion(quat).add(pos);
      p.m.position.copy(tmp);
      p.m.quaternion.copy(quat);
    }
    /* the word is set to the frame width, standing in the river */
    const D = 15.5;
    const hh = D * tv, hw = hh * aspect;
    const ww = 2 * hw * (aspect < 1 ? 0.96 : 0.9);
    wordH = ww / W.aspect;
    word.geometry.dispose();
    word.geometry = new THREE.PlaneGeometry(ww, wordH);
    fwd.set(0, 0, -1).applyQuaternion(quat).setY(0).normalize();
    word.position.copy(pos).addScaledVector(fwd, D);
    wordBase = wordH * 0.5 - wordH * 0.1;
    word.rotation.set(0, Math.atan2(-fwd.x, -fwd.z), 0);
    word.position.y = wordBase - (1 - easeOut(rise)) * wordH * 1.05;
  }

  return {
    layout,
    rise() { rising = true; },
    /* intro: the opening dolly's progress. Plates hung in the air for the final
       framing (the bough, the palm) only arrive with the camera; from further
       back they would read as foliage floating over the river. */
    update(dt, p, intro = 1) {
      if (rising && rise < 1) rise = Math.min(1, rise + dt / 2.6);
      const e = easeOut(rise);
      word.position.y = wordBase - (1 - e) * wordH * 1.05;
      wordMat.uniforms.uOpacity.value = smooth(0, 0.35, rise);
      wordMat.uniforms.uDissolve.value = smooth(0.04, 0.42, p);
      const fade = 1 - smooth(0.05, 0.3, p);
      const arrive = smooth(0.62, 0.98, intro);
      for (const pl of plates) pl.m.material.uniforms.uOpacity.value = fade * (pl.hung ? arrive : 1);
      group.visible = p < 0.6;
    },
  };
}
