import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/* the passes that treat the frame as one image, after tone mapping:
   teal shadows, warm highs, a whisper of lens fringe, vignette, dither */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uRes: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    uVig: { value: 0.5 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uRes;
    uniform float uTime;
    uniform float uVig;
    varying vec2 vUv;
    float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 q = vUv - 0.5;
      vec2 ca = q * dot(q, q) * 0.014;
      vec3 c = vec3(texture2D(tDiffuse, vUv + ca).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - ca).b);
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c += vec3(-0.008, 0.005, 0.014) * (1.0 - smoothstep(0.0, 0.42, l));
      c += vec3(0.022, 0.007, -0.018) * smoothstep(0.36, 1.0, l);
      c = mix(vec3(l), c, 1.05);
      vec2 v = q;
      v.x *= uRes.x / uRes.y;
      c *= mix(1.0 - uVig, 1.0, 1.0 - smoothstep(0.2, 1.0, length(v)));
      c += (h(vUv * uRes + fract(uTime * 7.0)) - 0.5) / 255.0;
      gl_FragColor = vec4(max(c, 0.0), 1.0);
    }`,
};

/* one bad pixel anywhere would be smeared into a grey square by the bloom,
   so anything that is not a sensible colour stops here */
const ScrubShader = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: GradeShader.vertexShader,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      if (!(c.r < 1e4 && c.g < 1e4 && c.b < 1e4) || !(c.r >= 0.0 && c.g >= 0.0 && c.b >= 0.0)) c = vec3(0.0);
      gl_FragColor = vec4(min(c, vec3(48.0)), 1.0);
    }`,
};

export function createPost(renderer, scene, camera, { samples = 4, strength = 0.85 } = {}) {
  const size = renderer.getSize(new THREE.Vector2());
  const pr = renderer.getPixelRatio();
  const rt = new THREE.WebGLRenderTarget(size.x * pr, size.y * pr, { type: THREE.HalfFloatType, samples });
  const composer = new EffectComposer(renderer, rt);
  composer.setPixelRatio(pr);
  composer.setSize(size.x, size.y);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new ShaderPass(ScrubShader));
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x * pr, size.y * pr), strength, 0.42, 0.9);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);
  grade.uniforms.uRes.value.set(size.x * pr, size.y * pr);

  return {
    composer,
    bloom,
    setSize(w, h, p) {
      composer.setPixelRatio(p);
      composer.setSize(w, h);
      grade.uniforms.uRes.value.set(w * p, h * p);
    },
    /* multisampling is the first thing to go when the budget tightens */
    setSamples(n) {
      for (const t of [composer.renderTarget1, composer.renderTarget2]) {
        if (t.samples !== n) { t.samples = n; t.dispose(); }
      }
    },
    render(t) {
      grade.uniforms.uTime.value = t;
      composer.render();
    },
  };
}
