import * as THREE from 'three';
import { project } from './world/map.js';
import { clamp, damp, lerp, sat, smooth, easeOut, REDUCE } from './util.js';

/* =====================================================================
   The camera rig. One smooth path through the real city, one knot per
   stop of the game, with a couple of extra knots to fly over the rooftops.
   Scroll position picks a place on the path, and the camera glides there
   at a capped speed, so the background never lurches however fast the
   page moves.
     0 the river at Nhà Rồng · 1 round one · 2 round two, the photograph
     3 round two, straight above the junction · 4 round three
     5 round four · 6 the end, looking back across the city
   ===================================================================== */

const UP = new THREE.Vector3(0, 1, 0);
const MAX_SPEED = 150;                   /* world units a second: 1.5 km/s from high up */

/* Every composed frame puts its subject at (sx, sy) in normalised screen
   space, so the words on the left keep the dark water. */
function lookFrom(pos, target, sx, sy, fov, aspect) {
  const dir = target.clone().sub(pos).normalize();
  const yaw = Math.atan2(dir.x, -dir.z), pitch = Math.asin(clamp(dir.y, -1, 1));
  const tv = Math.tan(THREE.MathUtils.degToRad(fov) / 2), th = tv * aspect;
  const y2 = yaw - Math.atan(sx * th), p2 = pitch - Math.atan(sy * tv);
  return pos.clone().add(new THREE.Vector3(Math.sin(y2) * Math.cos(p2), Math.sin(p2), -Math.cos(y2) * Math.cos(p2)).multiplyScalar(60));
}

const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
const near = (lat, lon, y, dx = 0, dz = 0) => { const p = project(lat, lon); return v3(p.x + dx, y, p.z + dz); };

export function createRig(camera, sites, places) {
  const { r1, r2, r3, r4 } = places;
  const skyline = sites.bitexco.pos.clone().setY(13);

  /* k: the stop of the game this knot belongs to; the in-between knots only shape the flight */
  const knots = [
    { k: 0, pos: v3(38, 2.1, 186), target: skyline, sx: 0.26, sy: 0.05 },
    { k: 0.3, pos: v3(-120, 34, 262), target: v3(-300, 8, 320) },
    { k: 0.65, pos: v3(-300, 44, 318), target: v3(-440, 6, 300) },
    { k: 1, pos: near(r1.lat, r1.lon, 26, 26, 44), target: near(r1.lat, r1.lon, 2) },
    { k: 2, pos: near(r2.lat, r2.lon, 30, 34, 26), target: near(r2.lat, r2.lon, 2) },
    { k: 3, pos: near(r2.lat, r2.lon, 132, -22), target: near(r2.lat, r2.lon, 0, -22, -0.8), overhead: true },
    { k: 4, pos: near(r3.lat, r3.lon, 24, 22, 30), target: near(r3.lat, r3.lon, 2) },
    { k: 5, pos: near(r4.lat, r4.lon, 20, -18, 28), target: near(r4.lat, r4.lon, 2) },
    { k: 6, pos: near(r4.lat, r4.lon, 74, -46, 58), target: skyline.clone().setY(4) },
  ];
  const last = knots[knots.length - 1].k;

  let posC, lookC, table = [], total = 1;
  let aspect = camera.aspect, baseFov = 40;
  const hero = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), fov: 40, aspect: 1 };

  const uAt = (p) => {
    const pc = clamp(p, 0, last);
    let i = 0;
    while (i < knots.length - 2 && pc >= knots[i + 1].k) i++;
    const a = knots[i].k, b = knots[i + 1].k;
    return (i + (pc - a) / (b - a)) / (knots.length - 1);
  };

  /* On a tall frame the rig widens and centres its subjects. */
  function build(asp) {
    aspect = asp;
    const tall = sat((1.15 - asp) / 0.65);
    baseFov = lerp(40, 58, tall);
    /* straight above the junction, a tall frame climbs higher and keeps the graph
       in the top half of the screen, clear of the words below it */
    const lift = (v, k) => (k.overhead ? v.clone().add(new THREE.Vector3(22 * tall, v === k.pos ? 62 * tall : 0, 48 * tall)) : v.clone());
    const pos = knots.map((k) => lift(k.pos, k));
    const looks = knots.map((k, i) => lookFrom(pos[i], lift(k.target, k), (k.sx ?? 0) * (1 - tall), k.sy ?? 0, baseFov, asp));
    posC = new THREE.CatmullRomCurve3(pos, false, 'centripetal');
    lookC = new THREE.CatmullRomCurve3(looks, false, 'centripetal');
    /* arc length along the path against scroll progress, so speed can be capped in world units */
    const N = 480, tmp = new THREE.Vector3(), prev = new THREE.Vector3();
    table = new Float32Array(N + 1);
    posC.getPoint(uAt(0), prev);
    for (let i = 1; i <= N; i++) {
      posC.getPoint(uAt((i / N) * last), tmp);
      table[i] = table[i - 1] + tmp.distanceTo(prev);
      prev.copy(tmp);
    }
    total = table[N];
    hero.pos.copy(pos[0]);
    hero.quat.setFromRotationMatrix(new THREE.Matrix4().lookAt(pos[0], looks[0], UP));
    hero.fov = baseFov;
    hero.aspect = asp;
  }
  build(camera.aspect);

  const sAt = (p) => {
    const t = (clamp(p, 0, last) / last) * (table.length - 1), i = Math.min(table.length - 2, Math.floor(t));
    return lerp(table[i], table[i + 1], t - i);
  };
  const pAt = (s) => {
    let a = 0, b = table.length - 1;
    while (b - a > 1) { const m = (a + b) >> 1; if (table[m] <= s) a = m; else b = m; }
    const f = (s - table[a]) / Math.max(1e-6, table[b] - table[a]);
    return ((a + f) / (table.length - 1)) * last;
  };

  const pos = new THREE.Vector3(), look = new THREE.Vector3(), fwd = new THREE.Vector3();
  const right = new THREE.Vector3(), up = new THREE.Vector3();
  const state = { p: 0, s: 0, intro: REDUCE ? 1 : 0, px: 0, py: 0, started: false };

  function update(dt, t, pTarget, pointer) {
    const want = sAt(pTarget);
    if (!state.started) {
      /* arriving mid-page (a reload, a deep link): start there, skip the dolly */
      state.started = true;
      state.s = want;
      if (pTarget > 0.25) state.intro = 1;
    }
    if (REDUCE) {
      /* reduced motion: no travelling shots, the camera cuts from stop to stop */
      state.s = sAt(Math.round(pTarget));
    } else {
      const step = (want - state.s) * (1 - Math.exp(-2 * dt)), cap = MAX_SPEED * dt;
      state.s += clamp(step, -cap, cap);
    }
    state.p = pAt(state.s);
    const u = uAt(state.p);
    posC.getPoint(u, pos);
    lookC.getPoint(u, look);

    /* the opening dolly: a long lens easing in from further back */
    if (!REDUCE) state.intro = Math.min(1, state.intro + dt / 3.8);
    const ei = easeOut(state.intro);
    const w = (1 - ei) * (1 - smooth(0, 0.2, state.p));
    fwd.copy(look).sub(pos).normalize();
    pos.addScaledVector(fwd, -14 * w);
    pos.y += 1.8 * w;

    /* parallax: a faint hand-held drift, never enough to break the frame */
    const k = REDUCE ? 0 : 1;
    state.px = damp(state.px, pointer.x, 1.8, dt);
    state.py = damp(state.py, pointer.y, 1.8, dt);
    right.crossVectors(fwd, UP).normalize();
    up.crossVectors(right, fwd);
    pos.addScaledVector(right, (state.px * 0.12 + Math.sin(t * 0.37) * 0.04) * k)
       .addScaledVector(up, (state.py * 0.07 + Math.sin(t * 0.53 + 1.3) * 0.025) * k);
    look.addScaledVector(right, state.px * 0.34 * k).addScaledVector(up, state.py * 0.18 * k);

    camera.position.copy(pos);
    camera.up.copy(UP);
    camera.lookAt(look);
    const fov = baseFov - 8 * w;
    if (Math.abs(camera.fov - fov) > 1e-3) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  }

  return {
    state,
    update,
    resize(asp) { build(asp); camera.aspect = asp; camera.updateProjectionMatrix(); },
    heroPose: () => hero,
  };
}
