import { VNINDEX } from './data/vnindex.js';
import { REDUCE, COARSE, mulberry32, clamp, lerp, smooth, easeIO } from './util.js';

/* =====================================================================
   The research cards are small live drawings, each true to its project:
   813 records narrowed to 19 studies and a naive baseline none of them
   faced; Vietnamese speech in three regional voices; a browser that
   teaches English words while you read Vietnamese news.
   ===================================================================== */

const FONT = '"Be Vietnam Pro", system-ui, sans-serif';
const BONE = [223, 231, 224], RED = [216, 52, 43], GOLD = [242, 184, 75];
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const store = new WeakMap();
const once = (c, make) => { if (!store.has(c)) store.set(c, make()); return store.get(c); };

function fit(c) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const r = c.getBoundingClientRect();
  const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; return { w, h, dpr, changed: true }; }
  return { w, h, dpr, changed: false };
}

function indexPath(g, x0, y0, x1, y1, from = 0) {
  const v = VNINDEX.values.slice(from);
  let lo = Infinity, hi = -Infinity;
  for (const x of v) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
  g.beginPath();
  v.forEach((val, i) => {
    const x = lerp(x0, x1, i / (v.length - 1)), y = lerp(y1, y0, (val - lo) / (hi - lo));
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  });
  return { lo, hi, last: v[v.length - 1], n: v.length };
}

/* ------------------------------------------------------------ 01 · 813 → 19 */
function prisma(g, w, h, t, dpr) {
  const S = once(g.canvas, () => {
    const rnd = mulberry32(813), pts = [];
    for (let i = 0; i < 813; i++) pts.push({ x: 0.05 + rnd() * 0.9, y: 0.17 + rnd() * 0.58, s: rnd() });
    const keep = new Set();
    while (keep.size < 19) keep.add(Math.floor(rnd() * 813));
    [...keep].sort((a, b) => pts[a].x - pts[b].x).forEach((i, k) => {
      pts[i].keep = true; pts[i].tx = 0.12 + (k / 18) * 0.76; pts[i].ty = 0.4;
    });
    return { pts };
  });
  const T = 12, tt = t % T, out = 1 - smooth(11.0, 11.9, tt);
  g.clearRect(0, 0, w, h);

  /* the market the studies tried to forecast, faintly behind */
  g.lineWidth = 1.2 * dpr;
  g.strokeStyle = rgba(BONE, 0.09 * out);
  indexPath(g, w * 0.04, h * 0.2, w * 0.96, h * 0.78);
  g.stroke();

  const k = smooth(2.4, 5.2, tt), kk = easeIO(k);
  for (const p of S.pts) {
    const appear = smooth(p.s * 1.7, p.s * 1.7 + 0.5, tt) * out;
    let x = p.x, y = p.y, a, r, c;
    if (p.keep) {
      x = lerp(p.x, p.tx, kk); y = lerp(p.y, p.ty, kk);
      r = lerp(1.2, 3.4, kk); c = mix(BONE, RED, kk); a = appear;
    } else {
      y = p.y + k * k * 0.28 * (0.5 + p.s); r = 1.2; c = BONE; a = appear * (0.55 - 0.5 * k);
    }
    if (a <= 0.01) continue;
    g.fillStyle = rgba(c, a);
    g.beginPath();
    g.arc(x * w, y * h, r * dpr, 0, Math.PI * 2);
    g.fill();
    if (p.keep && kk > 0.2) {
      g.fillStyle = rgba(RED, 0.16 * kk * out);
      g.beginPath();
      g.arc(x * w, y * h, r * 3 * dpr, 0, Math.PI * 2);
      g.fill();
    }
  }

  /* the naive forecast: a flat line none of the 19 were measured against */
  const lk = smooth(5.6, 7.0, tt) * out;
  if (lk > 0) {
    const y = h * 0.55, x0 = w * 0.08, x1 = lerp(x0, w * 0.92, smooth(5.6, 7.0, tt));
    g.strokeStyle = rgba(GOLD, 0.85 * lk);
    g.setLineDash([6 * dpr, 5 * dpr]);
    g.lineWidth = 1.4 * dpr;
    g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke();
    g.setLineDash([]);
    g.font = `500 ${10 * dpr}px ${FONT}`;
    g.fillStyle = rgba(GOLD, 0.9 * lk);
    g.fillText('NAIVE FORECAST', x0, y - 9 * dpr);
    const tk = smooth(7.3, 8.1, tt) * out;
    if (tk > 0) {
      g.font = `300 ${13 * dpr}px ${FONT}`;
      g.fillStyle = rgba(BONE, 0.9 * tk);
      g.fillText('0 of 19 studies compared against it', x0, y + 24 * dpr);
    }
  }

  /* the screen count, top right */
  const n = Math.round(lerp(813, 19, k));
  g.textAlign = 'right';
  g.font = `200 ${30 * dpr}px ${FONT}`;
  g.fillStyle = rgba(BONE, 0.95 * Math.max(out, 0.001));
  g.fillText(String(n), w - 20 * dpr, 44 * dpr);
  g.font = `500 ${9.5 * dpr}px ${FONT}`;
  g.fillStyle = rgba(BONE, 0.55 * out);
  g.fillText(k < 0.5 ? 'RECORDS SCREENED' : 'STUDIES KEPT · PRISMA 2020', w - 20 * dpr, 60 * dpr);
  g.textAlign = 'left';
}

/* ------------------------------------------------------------ 02 · three regional voices */
const LINES = [
  ['MIỀN BẮC · NORTH', 'hôm nay trời đẹp quá'],
  ['MIỀN TRUNG · CENTRAL', 'mệ đi mô rứa'],
  ['MIỀN NAM · SOUTH', 'tui đi chợ nghen'],
];
function voice(g, w, h, t, dpr) {
  const P = 4.6, i = Math.floor(t / P) % LINES.length, tt = t % P;
  const [region, text] = LINES[i];
  const speaking = smooth(0.1, 0.4, tt) * (1 - smooth(2.6, 3.0, tt));
  const fade = smooth(0, 0.3, tt) * (1 - smooth(4.2, 4.6, tt));
  g.clearRect(0, 0, w, h);

  /* the waveform: mirrored bars, speech-shaped bursts drifting left */
  const mid = h * 0.36, bars = Math.floor(w / (4 * dpr)), bw = 2 * dpr;
  for (let b = 0; b < bars; b++) {
    const x = (b / bars) * w, u = b / bars;
    const env = Math.max(0, Math.sin(u * 9 - t * 3.2 + i)) * Math.max(0, Math.sin(u * 3.1 + t * 0.7 + i * 2));
    const a = (0.06 + speaking * env * (0.7 + 0.3 * Math.sin(b * 1.7 + t * 23))) * h * 0.2;
    const c = mix(GOLD, RED, u);
    g.fillStyle = rgba(c, 0.25 + 0.6 * speaking * env);
    g.fillRect(x, mid - a, bw, a * 2);
  }

  /* what the model heard, word by word */
  const words = text.split(' ');
  const shown = Math.floor(clamp((tt - 0.5) / 2.3, 0, 1) * words.length + 0.0001);
  g.font = `300 ${Math.min(20, w / dpr / 15) * dpr}px ${FONT}`;
  let x = 20 * dpr;
  const y = h * 0.62;
  for (let k = 0; k < words.length; k++) {
    const on = k < shown;
    g.fillStyle = rgba(BONE, (on ? 0.95 : 0.12) * fade);
    g.fillText(words[k], x, y);
    x += g.measureText(words[k] + ' ').width;
  }
  g.font = `500 ${9.5 * dpr}px ${FONT}`;
  g.fillStyle = rgba(GOLD, 0.85 * fade);
  g.fillText(region, 20 * dpr, y - 26 * dpr);
  g.textAlign = 'right';
  g.fillStyle = rgba(BONE, 0.6);
  g.fillText('WER 7.84% · CER 5.87%', w - 20 * dpr, 24 * dpr);
  g.textAlign = 'left';
}

/* ------------------------------------------------------------ 03 · a browser that teaches */
const PAIRS = [['học', 'learn'], ['tương lai', 'future'], ['bạn bè', 'friends'], ['thành phố', 'city']];
const SENT = ['Mỗi ngày đọc tin tức là một cơ hội để', 'học thêm về tương lai của thành phố,', 'cùng bạn bè và những người xung quanh.'];
function ext(g, w, h, t, dpr) {
  g.clearRect(0, 0, w, h);
  const m = 18 * dpr, x0 = m, y0 = 40 * dpr, x1 = w - m, y1 = Math.max(y0 + 120 * dpr, h * 0.72);
  const r = 10 * dpr;
  g.strokeStyle = rgba(BONE, 0.18);
  g.lineWidth = 1 * dpr;
  g.beginPath();
  g.roundRect(x0, y0, x1 - x0, y1 - y0, r);
  g.stroke();
  for (let k = 0; k < 3; k++) {
    g.fillStyle = rgba(k === 0 ? RED : BONE, k === 0 ? 0.8 : 0.25);
    g.beginPath(); g.arc(x0 + (14 + k * 11) * dpr, y0 + 12 * dpr, 3 * dpr, 0, Math.PI * 2); g.fill();
  }
  g.fillStyle = rgba(BONE, 0.07);
  g.beginPath(); g.roundRect(x0 + 52 * dpr, y0 + 5 * dpr, (x1 - x0) * 0.55, 14 * dpr, 7 * dpr); g.fill();

  /* the page: Vietnamese news, one word at a time turned into English */
  const P = 2.6, i = Math.floor(t / P) % PAIRS.length, tt = t % P;
  const [vi, en] = PAIRS[i];
  const fs = Math.min(13, (x1 - x0) / dpr / 26) * dpr;
  g.font = `300 ${fs}px ${FONT}`;
  let hit = null;
  SENT.forEach((line, li) => {
    const y = y0 + 52 * dpr + li * fs * 1.9;
    g.fillStyle = rgba(BONE, 0.55);
    g.fillText(line, x0 + 16 * dpr, y);
    const at = line.indexOf(vi);
    if (at >= 0 && !hit) {
      const pre = g.measureText(line.slice(0, at)).width, ww = g.measureText(vi).width;
      hit = { x: x0 + 16 * dpr + pre, y, w: ww };
    }
  });
  if (hit) {
    const k = smooth(0.2, 0.6, tt) * (1 - smooth(2.2, 2.6, tt));
    g.fillStyle = rgba(GOLD, 0.95);
    g.fillText(vi, hit.x, hit.y);
    g.fillStyle = rgba(GOLD, 0.9 * k);
    g.fillRect(hit.x, hit.y + 4 * dpr, hit.w, 1.2 * dpr);
    g.font = `500 ${11 * dpr}px ${FONT}`;
    const tw = g.measureText(en).width + 18 * dpr, bx = hit.x + hit.w / 2 - tw / 2, by = hit.y - fs - 26 * dpr + (1 - k) * 6 * dpr;
    g.fillStyle = rgba([20, 24, 28], 0.95 * k);
    g.beginPath(); g.roundRect(bx, by, tw, 20 * dpr, 6 * dpr); g.fill();
    g.strokeStyle = rgba(GOLD, 0.6 * k);
    g.stroke();
    g.fillStyle = rgba(BONE, k);
    g.fillText(en, bx + 9 * dpr, by + 14 * dpr);
  }

  /* and the usage bar, filling */
  const u = 0.12 + 0.6 * ((t % 9) / 9);
  const by = y1 - 22 * dpr, bx0 = x0 + 16 * dpr, bx1 = x1 - 16 * dpr;
  g.font = `500 ${9.5 * dpr}px ${FONT}`;
  g.fillStyle = rgba(BONE, 0.5);
  g.fillText('CLAUDE USAGE', bx0, by - 8 * dpr);
  g.textAlign = 'right';
  g.fillText(`${Math.round(u * 100)}%`, bx1, by - 8 * dpr);
  g.textAlign = 'left';
  g.fillStyle = rgba(BONE, 0.1);
  g.fillRect(bx0, by, bx1 - bx0, 3 * dpr);
  const grd = g.createLinearGradient(bx0, 0, bx1, 0);
  grd.addColorStop(0, rgba(GOLD, 0.95));
  grd.addColorStop(1, rgba(RED, 0.95));
  g.fillStyle = grd;
  g.fillRect(bx0, by, (bx1 - bx0) * u, 3 * dpr);
}

/* ------------------------------------------------------------ hero · now */
/* the last four years of the VN-Index, and the zero-return forecast drawn
   flat from today */
function spark(g, w, h, t, dpr) {
  g.clearRect(0, 0, w, h);
  const from = VNINDEX.values.length - 48;
  const x0 = 10 * dpr, x1 = w * 0.74, y0 = 22 * dpr, y1 = h - 14 * dpr;
  g.lineWidth = 1.3 * dpr;
  g.strokeStyle = rgba(BONE, 0.75);
  const s = indexPath(g, x0, y0, x1, y1, from);
  g.stroke();
  const yl = lerp(y1, y0, (s.last - s.lo) / (s.hi - s.lo));
  g.setLineDash([3 * dpr, 3 * dpr]);
  g.strokeStyle = rgba(GOLD, 0.9);
  g.beginPath(); g.moveTo(x1, yl); g.lineTo(w - 10 * dpr, yl); g.stroke();
  g.setLineDash([]);
  const pulse = 0.5 + 0.5 * Math.sin(t * 2.4);
  g.fillStyle = rgba(GOLD, 0.25 + 0.25 * pulse);
  g.beginPath(); g.arc(x1, yl, (5 + 3 * pulse) * dpr, 0, Math.PI * 2); g.fill();
  g.fillStyle = rgba(GOLD, 1);
  g.beginPath(); g.arc(x1, yl, 2.2 * dpr, 0, Math.PI * 2); g.fill();
  g.font = `500 ${8 * dpr}px ${FONT}`;
  g.fillStyle = rgba(BONE, 0.5);
  g.fillText('VN-INDEX', x0, 13 * dpr);
  g.fillStyle = rgba(GOLD, 0.85);
  g.textAlign = 'right';
  g.fillText('NAIVE', w - 10 * dpr, yl - 6 * dpr);
  g.textAlign = 'left';
}

const VIZ = { prisma, voice, ext, spark };

export function initCards() {
  const items = [...document.querySelectorAll('canvas[data-viz]')]
    .map((c) => ({ c, g: c.getContext('2d'), draw: VIZ[c.dataset.viz], on: false, drawn: false }))
    .filter((it) => it.draw && it.g);
  const io = new IntersectionObserver((es) => {
    for (const e of es) {
      const it = items.find((x) => x.c === e.target);
      if (it) it.on = e.isIntersecting;
    }
  }, { rootMargin: '120px' });
  items.forEach((it) => io.observe(it.c));
  const t0 = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    for (const it of items) {
      if (!it.on) continue;
      const { w, h, dpr, changed } = fit(it.c);
      /* still: one composed frame per card, redrawn only when it resizes */
      if (REDUCE && it.drawn && !changed) continue;
      it.draw(it.g, w, h, REDUCE ? 9.0 : (now - t0) / 1000, dpr);
      it.drawn = true;
    }
  }
  requestAnimationFrame(frame);

  /* cards lean toward the pointer, and a warm sheen follows it */
  if (COARSE || REDUCE) return;
  for (const el of document.querySelectorAll('[data-tilt]')) {
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      el.style.setProperty('--ry', `${((x - 0.5) * 5).toFixed(2)}deg`);
      el.style.setProperty('--rx', `${((0.5 - y) * 4).toFixed(2)}deg`);
      el.style.setProperty('--mx', `${(x * 100).toFixed(1)}%`);
      el.style.setProperty('--my', `${(y * 100).toFixed(1)}%`);
    });
    el.addEventListener('pointerleave', () => {
      el.style.setProperty('--rx', '0deg');
      el.style.setProperty('--ry', '0deg');
    });
  }
}
