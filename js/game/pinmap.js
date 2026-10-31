import { SAIGON } from '../data/saigon.js';
import { project } from '../world/map.js';
import { LABELS } from './content.js';
import { clamp, lerp, COARSE } from '../util.js';

/* =====================================================================
   The guessing map: the real land and streets of Saigon, no map tiles and
   no outside service. Drag to move, scroll or pinch to zoom, click to drop
   the pin. With the keyboard, the arrows move the pin and Enter guesses.
   ===================================================================== */

const C = SAIGON.city, W = C.x1 - C.x0, H = C.z1 - C.z0;
const GOLD = '#f2b84b', RED = '#d8342b', BONE = '#dfe7e0';
const labels = LABELS.map(([t, lat, lon]) => ({ t, ...project(lat, lon) }));

let base = null;

/* the land is painted once and shared by every round's map */
export function paintBase(map, streets) {
  const size = 1536, land = document.createElement('canvas');
  land.width = land.height = size;
  const g = land.getContext('2d');
  const sx = size / W, sz = size / H, Q = map.quant;
  g.fillStyle = '#111a1c';
  g.beginPath();
  let at = 0, r = 0;
  for (let p = 0; p < map.landPolyN.length; p++) {
    for (let k = 0; k < map.landPolyN[p]; k++) {
      const n = map.landRingN[r++];
      for (let i = 0; i < n; i++) {
        const x = (map.landXZ[at + i * 2] / Q - C.x0) * sx, y = (map.landXZ[at + i * 2 + 1] / Q - C.z0) * sz;
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.closePath();
      at += n * 2;
    }
  }
  g.fill('evenodd');
  base = { land, streets };
  return base;
}

export function createPinMap(canvas, { onPin, onEnter }) {
  const g = canvas.getContext('2d', { alpha: false });
  const view = { x: -150, z: 120, s: 1 };
  const goal = { x: view.x, z: view.z, s: 1 };
  let cssW = 1, cssH = 1, dpr = 1, minS = 0.2;
  let pin = null, reveal = null, locked = false, raf = 0;

  const fit = () => {
    const r = canvas.getBoundingClientRect();
    if (!r.width) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    cssW = r.width; cssH = r.height;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    minS = Math.max(cssW / W, cssH / H) * 1.02;
    if (goal.s < minS || view.s < minS) goal.s = view.s = Math.max(minS, 0.42);
    clampView(goal); clampView(view);
    draw();
  };
  function clampView(v) {
    v.s = clamp(v.s, minS, 11);
    const hw = cssW / 2 / v.s, hh = cssH / 2 / v.s;
    v.x = clamp(v.x, C.x0 + hw, Math.max(C.x0 + hw, C.x1 - hw));
    v.z = clamp(v.z, C.z0 + hh, Math.max(C.z0 + hh, C.z1 - hh));
  }

  const toPx = (x, z) => [(x - view.x) * view.s + cssW / 2, (z - view.z) * view.s + cssH / 2];
  const toWorld = (px, py) => ({ x: view.x + (px - cssW / 2) / view.s, z: view.z + (py - cssH / 2) / view.s });

  function marker(x, z, col) {
    const [px, py] = toPx(x, z);
    g.save();
    g.translate(px, py);
    g.shadowColor = 'rgba(0,0,0,.7)'; g.shadowBlur = 8;
    g.fillStyle = col;
    g.beginPath();
    g.moveTo(0, 0);
    g.bezierCurveTo(-3, -7, -10, -11, -10, -18);
    g.arc(0, -18, 10, Math.PI, 0);
    g.bezierCurveTo(10, -11, 3, -7, 0, 0);
    g.fill();
    g.shadowBlur = 0;
    g.fillStyle = '#05070a';
    g.beginPath(); g.arc(0, -18, 3.6, 0, Math.PI * 2); g.fill();
    g.restore();
  }

  function draw() {
    if (canvas.width < 2) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = '#071a24';
    g.fillRect(0, 0, cssW, cssH);
    if (!base) {
      g.fillStyle = 'rgba(223,231,224,.6)';
      g.font = '12px "Be Vietnam Pro", system-ui, sans-serif';
      g.textAlign = 'center';
      g.fillText('Loading the map', cssW / 2, cssH / 2);
      return;
    }
    const [x0, y0] = toPx(C.x0, C.z0), w = W * view.s, h = H * view.s;
    g.imageSmoothingQuality = 'high';
    g.drawImage(base.land, x0, y0, w, h);
    g.globalCompositeOperation = 'lighter';
    g.drawImage(base.streets, x0, y0, w, h);
    g.globalCompositeOperation = 'source-over';

    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '500 11px "Be Vietnam Pro", system-ui, sans-serif';
    for (const l of labels) {
      const [px, py] = toPx(l.x, l.z);
      if (px < -40 || py < -10 || px > cssW + 40 || py > cssH + 10) continue;
      g.lineWidth = 3; g.strokeStyle = 'rgba(5,7,10,.8)';
      g.strokeText(l.t, px, py);
      g.fillStyle = 'rgba(223,231,224,.82)';
      g.fillText(l.t, px, py);
    }

    if (reveal) {
      const [ax, ay] = toPx(reveal.x, reveal.z);
      if (reveal.show === 'area') {
        g.fillStyle = 'rgba(242,184,75,.16)'; g.strokeStyle = GOLD; g.lineWidth = 1.5;
        g.beginPath(); g.arc(ax, ay, 70 * view.s, 0, Math.PI * 2); g.fill(); g.stroke();
      }
      if (pin) {
        const [bx, by] = toPx(pin.x, pin.z), k = reveal.k;
        g.strokeStyle = reveal.right ? GOLD : RED; g.lineWidth = 2; g.setLineDash([5, 5]);
        g.beginPath(); g.moveTo(bx, by); g.lineTo(lerp(bx, ax, k), lerp(by, ay, k)); g.stroke();
        g.setLineDash([]);
      }
      if (reveal.show !== 'area') marker(reveal.x, reveal.z, GOLD);
    }
    if (pin) marker(pin.x, pin.z, reveal ? BONE : RED);
  }

  function animate() {
    cancelAnimationFrame(raf);
    const step = () => {
      const k = 0.16;
      view.x = lerp(view.x, goal.x, k); view.z = lerp(view.z, goal.z, k); view.s = lerp(view.s, goal.s, k);
      if (reveal) reveal.k = Math.min(1, reveal.k + 0.03);
      draw();
      const moving = Math.abs(view.s - goal.s) > 0.002 || Math.hypot(view.x - goal.x, view.z - goal.z) > 0.05 || (reveal && reveal.k < 1);
      if (moving) raf = requestAnimationFrame(step);
      else { view.x = goal.x; view.z = goal.z; view.s = goal.s; draw(); }
    };
    raf = requestAnimationFrame(step);
  }

  function zoomAt(px, py, factor) {
    const before = toWorld(px, py);
    goal.s = clamp(goal.s * factor, minS, 11);
    goal.x = before.x - (px - cssW / 2) / goal.s;
    goal.z = before.z - (py - cssH / 2) / goal.s;
    clampView(goal);
    animate();
  }

  /* ---------------------------------------------------------------- input */
  const pts = new Map();
  let downAt = null, moved = false, pinch = 0;
  const local = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, local(e));
    downAt = local(e); moved = false; pinch = 0;
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    const prev = pts.get(e.pointerId), now = local(e);
    pts.set(e.pointerId, now);
    if (pts.size === 2) {
      const [a, b] = [...pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (pinch) { view.s = goal.s = clamp(goal.s * (d / pinch), minS, 11); clampView(goal); clampView(view); draw(); }
      pinch = d; moved = true;
      return;
    }
    if (Math.hypot(now[0] - downAt[0], now[1] - downAt[1]) > 6) moved = true;
    if (moved) {
      goal.x -= (now[0] - prev[0]) / view.s; goal.z -= (now[1] - prev[1]) / view.s;
      clampView(goal);
      view.x = goal.x; view.z = goal.z;
      draw();
    }
  });
  const up = (e) => {
    if (!pts.has(e.pointerId)) return;
    const was = pts.size;
    pts.delete(e.pointerId);
    if (was === 1 && !moved && !locked) {
      const [px, py] = local(e);
      pin = toWorld(px, py);
      onPin?.(pin);
      draw();
    }
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', (e) => pts.delete(e.pointerId));
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const [px, py] = local(e);
    zoomAt(px, py, Math.exp(-e.deltaY * 0.0022));
  }, { passive: false });
  canvas.addEventListener('dblclick', (e) => { const [px, py] = local(e); zoomAt(px, py, 2); });
  canvas.addEventListener('keydown', (e) => {
    const step = 26 / view.s, d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (d && !locked) {
      e.preventDefault();
      pin = pin ?? { x: view.x, z: view.z };
      pin.x = clamp(pin.x + d[0], C.x0, C.x1); pin.z = clamp(pin.z + d[1], C.z0, C.z1);
      goal.x = pin.x; goal.z = pin.z;
      clampView(goal);
      onPin?.(pin);
      animate();
    } else if (e.key === '+' || e.key === '=') { zoomAt(cssW / 2, cssH / 2, 1.5); }
    else if (e.key === '-') { zoomAt(cssW / 2, cssH / 2, 1 / 1.5); }
    else if (e.key === 'Enter' && pin) { onEnter?.(); }
  });

  new ResizeObserver(fit).observe(canvas);

  return {
    hint: COARSE ? 'Pinch to zoom, tap to drop your pin.' : 'Scroll to zoom, click to drop your pin.',
    get pin() { return pin; },
    setPin(p) { pin = p; onPin?.(pin); draw(); },
    zoom(f) { zoomAt(cssW / 2, cssH / 2, f); },
    refresh: fit,
    reveal(answer, right) {
      locked = true;
      reveal = { x: answer.x, z: answer.z, show: answer.show, right, k: 0 };
      /* frame the guess and the answer together */
      const px = pin ?? answer, sp = Math.max(Math.abs(px.x - answer.x), 30), sq = Math.max(Math.abs(px.z - answer.z), 30);
      goal.s = clamp(Math.min(cssW / (sp * 2.8), cssH / (sq * 2.8)), minS, 6);
      goal.x = (px.x + answer.x) / 2; goal.z = (px.z + answer.z) / 2;
      clampView(goal);
      animate();
    },
  };
}
