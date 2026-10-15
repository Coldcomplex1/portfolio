import * as THREE from 'three';
import { RIVER, SITES, BANK_Y } from './world/river.js';
import { MOON_DIR } from './world/fog.js';
import { clamp, lerp, damp, sat, smooth, smoother, easeOut, REDUCE } from './util.js';

/* =====================================================================
   The camera rig. Seven stops, one per chapter, with via points between
   them; scroll position picks a place on the path and the rig eases to it.
     0 Phú Mỹ Bridge (hero) · 1 Nhà Rồng · 2 Bitexco · 3 Ba Son Bridge
     4 foot of Landmark 81 · 5 its crown (the climb is a straight line)
     6 the summit, looking out over the city toward the moon
   ===================================================================== */

const UP = new THREE.Vector3(0, 1, 0);

/* Every stop is composed for a frame: the subject is placed at (sx, sy) in
   normalised screen space, so the copy on the left keeps the dark water. */
function lookFrom(pos, target, sx, sy, fov, aspect) {
  const dir = target.clone().sub(pos).normalize();
  const yaw = Math.atan2(dir.x, -dir.z), pitch = Math.asin(clamp(dir.y, -1, 1));
  const tv = Math.tan(THREE.MathUtils.degToRad(fov) / 2), th = tv * aspect;
  const y2 = yaw - Math.atan(sx * th), p2 = pitch - Math.atan(sy * tv);
  return pos.clone().add(new THREE.Vector3(Math.sin(y2) * Math.cos(p2), Math.sin(p2), -Math.cos(y2) * Math.cos(p2)).multiplyScalar(60));
}

export function createRig(camera, sites) {
  const P = (d, k, y) => {
    const f = RIVER.frame(d, {});
    return new THREE.Vector3(f.x + f.rx * k * f.hw, y, f.z + f.rz * k * f.hw);
  };
  const S = SITES, T = sites.l81;
  const LP = (toRiver, along, y) => T.pos.clone().addScaledVector(T.toRiver, toRiver).addScaledVector(T.along, along).setY(y);

  const keys = [
    { pos: P(S.hero, -0.42, 2.1), target: sites.phuMy.center.clone().setY(7.2), sx: 0.2, sy: -0.07 },
    { pos: P(S.nhaRong - 21, -0.2, 2.3), target: sites.nhaRong.look, sx: 0.36, sy: -0.02 },
    { pos: P(S.bitexco - 42, -0.28, 7.2), target: sites.bitexco.look, sx: 0.3, sy: 0.04 },
    { pos: P(S.baSon - 32, -0.46, 2.6), target: sites.baSon.pylonTop.clone().setY(6.4), sx: 0.32, sy: 0.04 },
    { pos: LP(48, -26, 2.4), target: T.pos.clone().setY(21), sx: 0.12, sy: 0.06 },
    { pos: LP(17, -7, 41.5), target: T.pos.clone().setY(42.5), sx: 0.08, sy: 0 },
    { pos: LP(14, -14, 56), target: null, sx: 0, sy: 0 },
  ];
  const out = new THREE.Vector3(MOON_DIR.x, 0, MOON_DIR.z).normalize();
  keys[6].target = keys[6].pos.clone().addScaledVector(out, 100).add(new THREE.Vector3(0, 2.5, 0));

  /* via points between stops: [position, look-at] */
  const vias = [
    [[P(S.phuMy - 26, -0.3, 2.6), P(S.phuMy + 70, 0, 3.4)], [P(S.phuMy + 24, -0.25, 3.0), P(S.nhaRong, 0.4, 3.0)]],
    [[P((S.nhaRong + S.bitexco) / 2, -0.22, 5.0), sites.bitexco.look.clone()]],
    [[P((S.bitexco + S.baSon) / 2 - 8, -0.32, 5.0), P(S.baSon + 30, 0.25, 4.5)]],
    [[P(S.baSon + 2, -0.42, 6.4), T.pos.clone().setY(14)], [P(S.l81 - 60, -0.3, 3.6), T.pos.clone().setY(18)]],
    [],
    [],
  ];

  let segs = [];
  let aspect = camera.aspect, baseFov = 40;
  const hero = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), fov: 40, aspect: 1 };

  /* On a tall frame the rig steps back, widens and centres its subjects. */
  function build(asp) {
    aspect = asp;
    const tall = sat((1.15 - asp) / 0.65);
    baseFov = lerp(40, 60, tall);
    const pos = keys.map((k, i) => {
      if (tall <= 0 || i === 5) return k.pos.clone();
      const dir = k.target.clone().sub(k.pos).setY(0).normalize();
      return k.pos.clone().addScaledVector(dir, -6 * tall).add(new THREE.Vector3(0, 0.6 * tall, 0));
    });
    const looks = keys.map((k, i) => lookFrom(pos[i], k.target, k.sx * (1 - tall), k.sy, baseFov, asp));
    segs = [];
    for (let j = 0; j < keys.length - 1; j++) {
      segs.push({
        pos: new THREE.CatmullRomCurve3([pos[j], ...vias[j].map((v) => v[0]), pos[j + 1]], false, 'centripetal'),
        look: new THREE.CatmullRomCurve3([looks[j], ...vias[j].map((v) => v[1]), looks[j + 1]], false, 'centripetal'),
        linear: j === 4,
      });
    }
    hero.pos.copy(pos[0]);
    const m = new THREE.Matrix4().lookAt(pos[0], looks[0], UP);
    hero.quat.setFromRotationMatrix(m);
    hero.fov = baseFov;
    hero.aspect = asp;
  }
  build(camera.aspect);

  const pos = new THREE.Vector3(), look = new THREE.Vector3(), fwd = new THREE.Vector3();
  const right = new THREE.Vector3(), up = new THREE.Vector3();
  function evalAt(p) {
    const n = segs.length, pc = clamp(p, 0, n);
    const j = Math.min(n - 1, Math.floor(pc)), f = pc - j;
    /* clamped: smootherstep can round to 1 + ε, and getPointAt reads past its table */
    const s = segs[j], e = clamp(s.linear ? f : smoother(f), 0, 1);
    s.pos.getPointAt(e, pos);
    s.look.getPoint(e, look);
  }

  const state = { p: 0, intro: REDUCE ? 1 : 0, px: 0, py: 0, floor: 1, alt: 0, started: false };

  function update(dt, t, pTarget, pointer) {
    if (!state.started) {
      /* arriving mid-page (a reload, a deep link): start there, skip the dolly */
      state.started = true;
      state.p = pTarget;
      if (pTarget > 0.25) state.intro = 1;
    }
    /* reduced motion: no travelling shots, the camera cuts from stop to stop
       (in quarter steps up the tower) while the meter still tracks the scroll */
    const cut = pTarget > 4 && pTarget < 5 ? 4 + Math.round((pTarget - 4) * 4) / 4 : Math.round(pTarget);
    state.p = REDUCE ? cut : damp(state.p, pTarget, 2.8, dt);
    evalAt(state.p);

    /* the opening dolly: a long lens easing in from further back */
    if (!REDUCE) state.intro = Math.min(1, state.intro + dt / 3.8);
    const ei = easeOut(state.intro);
    const w = (1 - ei) * (1 - smooth(0, 0.6, state.p));
    fwd.copy(look).sub(pos).normalize();
    pos.addScaledVector(fwd, -18 * w);
    pos.y += 2.4 * w;

    /* parallax: a hand-held drift, never enough to break the frame */
    const k = REDUCE ? 0 : 1;
    state.px = damp(state.px, pointer.x, 2.2, dt);
    state.py = damp(state.py, pointer.y, 2.2, dt);
    right.crossVectors(fwd, UP).normalize();
    up.crossVectors(right, fwd);
    pos.addScaledVector(right, (state.px * 0.32 + Math.sin(t * 0.37) * 0.07) * k)
       .addScaledVector(up, (state.py * 0.16 + Math.sin(t * 0.53 + 1.3) * 0.045) * k);
    look.addScaledVector(right, state.px * 0.9 * k).addScaledVector(up, state.py * 0.45 * k);

    camera.position.copy(pos);
    camera.up.copy(UP);
    camera.lookAt(look);
    const fov = baseFov - 11 * w;
    if (Math.abs(camera.fov - fov) > 1e-3) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }

    /* Landmark 81: 81 floors, 461 metres */
    const climb = sat((REDUCE ? pTarget : state.p) - 4);
    state.floor = Math.round(1 + 80 * climb);
    state.alt = Math.round(461 * climb);
  }

  return {
    state,
    update,
    resize(asp) { build(asp); camera.aspect = asp; camera.updateProjectionMatrix(); },
    heroPose: () => hero,
  };
}
