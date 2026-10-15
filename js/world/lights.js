import * as THREE from 'three';
import { FOG_GLSL, HASH_GLSL, fogUniforms } from './fog.js';

/* Uniforms shared by reference across every material that animates. */
export const time = { value: 0 };
/* pixels per world unit at a distance of one unit: drawing-buffer height
   over 2·tan(fov/2). Updated on resize, read by every point shader. */
export const pointScale = { value: 800 };

export const hdr = (hex, k = 1) => new THREE.Color(hex).multiplyScalar(k);

/* Small lights as round, additive points. Size is in world units, clamped
   to at least a pixel or two; a light smaller than that keeps its energy
   instead of flaring into a fat dot at distance. */
export function lightMaterial({ minPx = 1.6, maxPx = 72 } = {}) {
  const mn = minPx.toFixed(2), mx = maxPx.toFixed(1);
  return new THREE.ShaderMaterial({
    uniforms: { uTime: time, uPx: pointScale, ...fogUniforms },
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute float aSize;
      attribute float aBlink;
      uniform float uTime;
      uniform float uPx;
      uniform float uFogDensity;
      varying vec3 vCol;
      ${FOG_GLSL}
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vec4 mv = viewMatrix * wp;
        float s = aSize * uPx / max(-mv.z, 0.01);
        float b = 1.0;
        if (aBlink > 0.0) {
          /* aviation strobe: a short on-phase, a faint off-phase */
          float ph = fract(uTime * aBlink + fract(aBlink * 91.7));
          b = smoothstep(0.0, 0.04, ph) * (1.0 - smoothstep(0.3, 0.42, ph)) + 0.05;
        } else if (aBlink < 0.0) {
          /* slow breathing */
          b = 0.62 + 0.38 * sin(uTime * -aBlink * 6.2831 + position.x);
        }
        float energy = s < ${mn} ? max(s / ${mn}, 0.18) : 1.0;
        vCol = aColor * b * energy * (1.0 - heightFog(cameraPosition, wp.xyz, uFogDensity));
        gl_PointSize = clamp(s, ${mn}, ${mx});
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vCol;
      void main() {
        vec2 c = gl_PointCoord * 2.0 - 1.0;
        float r2 = dot(c, c);
        if (r2 > 1.0) discard;
        float a = exp(-r2 * 7.0) + 0.22 * exp(-r2 * 2.2) * (1.0 - r2);
        gl_FragColor = vec4(vCol * a, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

export class LightField {
  constructor() { this.p = []; this.c = []; this.s = []; this.b = []; }
  add(x, y, z, color, size = 0.3, blink = 0) {
    this.p.push(x, y, z);
    this.c.push(color.r, color.g, color.b);
    this.s.push(size);
    this.b.push(blink);
    return this;
  }
  addV(v, color, size, blink) { return this.add(v.x, v.y, v.z, color, size, blink); }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('aColor', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('aSize', new THREE.Float32BufferAttribute(this.s, 1));
    g.setAttribute('aBlink', new THREE.Float32BufferAttribute(this.b, 1));
    const pts = new THREE.Points(g, lightMaterial());
    pts.frustumCulled = false;
    return pts;
  }
}

/* ------------------------------------------------------------ lit surfaces */
/* One window function shared by the city and the landmarks. fc is a facade
   coordinate in world units (along the wall, up the wall). Below a pixel per
   pane the pattern hands over to its own average, so distant towers read as
   a soft glow instead of a shimmering moiré. Returns rgb·intensity, coverage. */
export const WINDOWS_GLSL = /* glsl */ `
${HASH_GLSL}
vec4 windows(vec2 fc, vec2 grid, vec2 size, float litP, float seed, vec3 w1, vec3 w2) {
  vec2 g = fc / grid;
  vec2 id = floor(g), f = fract(g);
  vec2 w = fwidth(g);
  vec2 h = (1.0 - size) * 0.5;
  vec2 lo = smoothstep(h - w, h + w, f);
  vec2 hi = 1.0 - smoothstep(1.0 - h - w, 1.0 - h + w, f);
  float pane = lo.x * hi.x * lo.y * hi.y;
  /* whole floors go dark together now and then, the way offices empty */
  float floorOn = step(0.16, hash12(vec2(id.y, seed * 1.7)));
  float lit = step(hash12(id + seed * 17.31), litP) * floorOn;
  float tone = hash12(id.yx * 1.37 + seed);
  vec3 wc = mix(w1, w2, step(0.74, tone)) * (0.55 + 0.9 * hash12(id + 9.17 + seed));
  float far = smoothstep(0.35, 0.9, max(w.x, w.y));
  float cover = mix(pane * lit, size.x * size.y * litP * 0.5, far);
  vec3 col = mix(wc, mix(w1, w2, 0.26), far);
  return vec4(col, cover);
}
`;
