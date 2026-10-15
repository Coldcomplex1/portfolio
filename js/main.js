/* =====================================================================
   QUYET — a night journey up the Saigon River.
   Everything in the world is generated at runtime: no photographs, no
   video, no assets beyond three.js, one web font, and a table of
   VN-Index month-end closes.
   ===================================================================== */
import * as THREE from 'three';
import { params, REDUCE, COARSE, smooth } from './util.js';
import { installFog, FOG, fogUniforms } from './world/fog.js';
import { time, pointScale, LightField } from './world/lights.js';
import { createRiver } from './world/river.js';
import { createSky } from './world/sky.js';
import { createHorizon } from './world/horizon.js';
import { createLandmarks } from './world/landmarks.js';
import { createCity } from './world/city.js';
import { createPetals, createWisps } from './world/life.js';
import { createForeground } from './world/foreground.js';
import { createRig } from './rig.js';
import { createPost } from './post.js';
import { initUI } from './ui.js';
import { initCards } from './cards.js';

const ui = initUI();
initCards();

function hasWebGL2() {
  try { return !!document.createElement('canvas').getContext('webgl2'); } catch { return false; }
}

if (params.has('nogl') || !hasWebGL2()) {
  fallback();
} else {
  /* give the page a moment to paint its words before the world is built */
  setTimeout(() => boot().catch((e) => { console.error(e); fallback(); }), 60);
}

function fallback() {
  document.documentElement.classList.add('no-gl');
  ui.staticMeter();
}

async function boot() {
  const canvas = document.getElementById('gl');
  const mobile = COARSE || Math.min(innerWidth, innerHeight) < 620;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, stencil: false, powerPreference: 'high-performance' });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x05070a, 1);
  /* the renderer trades resolution for frame rate on its own */
  const prMax = Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 1.75);
  const prMin = mobile ? 0.7 : 0.85;
  let pr = prMax;
  renderer.setPixelRatio(pr);
  renderer.setSize(innerWidth, innerHeight, false);

  installFog();
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(FOG.color, FOG.density);
  scene.fog.color = FOG.color;
  const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.4, 7600);
  camera.layers.enable(1);
  scene.add(camera);

  const lights = new LightField();
  const sky = createSky(scene, { dpr: pr });
  createHorizon(scene);
  const river = createRiver(scene, { lights, mobile, lanterns: mobile ? 140 : 240, reflectScale: mobile ? 0.36 : 0.5 });
  const marks = createLandmarks(scene, { lights });
  createCity(scene, { lights, count: mobile ? 1800 : 4200, lamps: mobile ? 9000 : 30000, exclusions: marks.exclusions, sites: marks.sites });
  scene.add(lights.build());
  const petals = createPetals(scene, { count: mobile ? 170 : 380 });
  const wisps = createWisps(camera, { max: mobile ? 60 : 140 });
  const rig = createRig(camera, marks.sites);

  /* the wordmark is painted in the page font, so wait for it (not forever) */
  await Promise.race([
    document.fonts ? document.fonts.load('600 200px "Be Vietnam Pro"') : Promise.resolve(),
    new Promise((r) => setTimeout(r, 2500)),
  ]);
  const fg = createForeground(scene);
  const post = createPost(renderer, scene, camera, { samples: mobile ? 0 : 4, strength: 0.6 });

  function resize() {
    const w = innerWidth, h = innerHeight;
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h, false);
    rig.resize(w / h);
    post.setSize(w, h, pr);
    river.resizeReflection(w * pr, h * pr);
    sky.setDpr(pr);
    fg.layout(rig.heroPose());
  }
  resize();
  addEventListener('resize', resize);

  /* the pointer, in normalised device coordinates */
  const pointer = { nx: 0, ny: 0, active: false, speed: 0 };
  addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    const nx = (e.clientX / innerWidth) * 2 - 1, ny = -((e.clientY / innerHeight) * 2 - 1);
    pointer.speed += Math.hypot(nx - pointer.nx, ny - pointer.ny);
    pointer.nx = nx; pointer.ny = ny; pointer.active = true;
  }, { passive: true });
  document.documentElement.addEventListener('pointerleave', () => { pointer.active = false; });

  /* debug: ?debug shows the frame budget, ?p=4.5 parks the camera */
  const fixedP = params.has('p') ? parseFloat(params.get('p')) : null;
  let hud = null;
  if (params.has('debug')) {
    hud = document.createElement('pre');
    hud.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:99;margin:0;padding:6px 8px;background:rgba(0,0,0,.6);color:#9f9;font:11px/1.4 ui-monospace,monospace;pointer-events:none';
    document.body.appendChild(hud);
    renderer.info.autoReset = false;
    window.__q = { THREE, scene, renderer, camera, post, river, rig, fg, ui };
  }

  renderer.compile(scene, camera);

  let last = performance.now(), running = true, first = true, age = 0;
  let acc = 0, frames = 0, good = 0, fpsShown = 0;
  const parallax = { x: 0, y: 0 };

  function frame(now) {
    if (!running) return;
    requestAnimationFrame(frame);
    tick(now);
  }

  function tick(now) {
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    age += dt;
    const t = now / 1000;
    time.value = t;

    const pT = fixedP ?? ui.progress();
    parallax.x = REDUCE ? 0 : pointer.nx;
    parallax.y = REDUCE ? 0 : pointer.ny;
    rig.update(dt, t, pT, parallax);
    pointScale.value = (innerHeight * pr) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));

    /* the air thins a little as the camera climbs the tower */
    const fd = FOG.density * (1 - 0.3 * smooth(8, 50, camera.position.y));
    fogUniforms.uFogDensity.value = fd;
    scene.fog.density = fd;

    sky.update(camera);
    river.update(dt, t, camera);
    petals.update(t, camera);
    wisps.update(dt, t, pointer);
    pointer.speed = 0;
    fg.update(dt, rig.state.p, rig.state.intro);
    ui.update(rig.state);

    if (hud) renderer.info.reset();
    post.render(t);

    if (first) {
      first = false;
      canvas.classList.add('ready');
      fg.rise();
    }

    /* the governor: animation never jumps, but the resolution follows the truth */
    acc += dt; frames++;
    if (acc >= 0.8) {
      const avg = acc / frames;
      fpsShown = Math.round(1 / avg);
      acc = 0; frames = 0;
      if (age > 2.5) {
        if (avg > 1 / 44 && pr > prMin) {
          pr = Math.max(prMin, pr - 0.15);
          if (pr < 1.1) post.setSamples(0);
          resize();
          good = 0;
        } else if (avg < 1 / 57) {
          if (++good > 4 && pr < prMax) { pr = Math.min(prMax, pr + 0.1); resize(); good = 0; }
        } else good = 0;
      }
    }
    if (hud) {
      const i = renderer.info.render;
      hud.textContent = `fps ${fpsShown}  dpr ${pr.toFixed(2)}  calls ${i.calls}  tris ${(i.triangles / 1000).toFixed(0)}k\np ${rig.state.p.toFixed(3)}  cam ${camera.position.x.toFixed(1)}, ${camera.position.y.toFixed(1)}, ${camera.position.z.toFixed(1)}`;
    }
  }
  requestAnimationFrame(frame);
  /* debug: step frames by hand, for when the page is not being painted */
  if (window.__q) window.__q.step = (n = 1, ms = 16.7) => { for (let i = 0; i < n; i++) tick(last + ms); };

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { running = false; return; }
    if (!running) { running = true; last = performance.now(); requestAnimationFrame(frame); }
  });
}
