import { JUNCTION as J } from '../data/junction.js';
import { REDUCE, sat, smooth, lerp } from '../util.js';

/* =====================================================================
   Round two: the real streets around the Chợ Lớn roundabout, as a graph.
   The lines are drawn over the 3D city with the camera looking straight
   down, so the mathematics sits exactly on the roads it came from.
   ===================================================================== */

const GOLD = '#f2b84b', BONE = '#dfe7e0';
const n = J.v.length / 2;
const vx = (i) => J.v[i * 2], vz = (i) => J.v[i * 2 + 1];

/* Dijkstra's algorithm: how far each corner is from the start, and the way back */
function shortest() {
  const adj = Array.from({ length: n }, () => []);
  J.e.forEach(([a, b, len], k) => { adj[a].push([b, len, k]); adj[b].push([a, len, k]); });
  const dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), via = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  dist[J.start] = 0;
  for (let c = 0; c < n; c++) {
    let u = -1, best = Infinity;
    for (let i = 0; i < n; i++) if (!done[i] && dist[i] < best) { best = dist[i]; u = i; }
    if (u < 0) break;
    done[u] = 1;
    for (const [v, len, k] of adj[u]) {
      if (dist[u] + len < dist[v]) { dist[v] = dist[u] + len; prev[v] = u; via[v] = k; }
    }
  }
  const path = [];
  for (let v = J.end; prev[v] >= 0; v = prev[v]) path.unshift([prev[v], v, via[v]]);
  return { dist, path };
}

export function createGraph(canvas, caps, total) {
  const g = canvas.getContext('2d');
  const { dist, path } = shortest();
  const far = dist[J.end];
  const onPath = new Set(path.map((p) => p[2]));
  /* a few road lengths written on the map, spaced apart so they stay readable */
  const tagged = [], used = [];
  for (const [k, e] of [...J.e.entries()].sort((a, b) => b[1][2] - a[1][2])) {
    const pts = e[3], mx = pts[pts.length >> 1 & ~1], mz = pts[(pts.length >> 1 & ~1) + 1];
    if (used.every(([x, z]) => Math.hypot(x - mx, z - mz) > 15)) { used.push([mx, mz]); tagged.push([k, mx, mz]); }
    if (tagged.length >= 12) break;
  }

  let world = null, running = false, t0 = 0, raf = 0, w = 1, h = 1, dpr = 1;
  const size = () => {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = innerWidth; h = innerHeight;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  };
  addEventListener('resize', size);
  size();

  /* without the 3D world, the graph simply fills the right of the screen */
  const flat = (x, z) => {
    const box = Math.min(h * 0.86, w * 0.62), s = box / (J.r * 2.1);
    return { x: w * (w > 960 ? 0.64 : 0.5) + (x - J.c[0]) * s, y: h * 0.5 + (z - J.c[1]) * s };
  };
  const P = (x, z) => (world ? world.project(x, z) : flat(x, z));

  function draw(now) {
    const t = REDUCE ? 99 : (now - t0) / 1000;
    const dots = smooth(0.2, 3, t), lines = smooth(3.4, 6.4, t), wave = smooth(7.2, 11.5, t), route = smooth(11.2, 13, t);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    g.lineCap = 'round'; g.lineJoin = 'round';

    J.e.forEach(([a, b, len, pts], k) => {
      const d = Math.min(dist[a], dist[b]) / far, hit = wave > 0 && d < wave * 1.04;
      const show = sat((lines - (k / J.e.length) * 0.7) / 0.3);
      if (show <= 0) return;
      g.strokeStyle = hit ? `rgba(255,150,90,${0.62 * show})` : `rgba(223,231,224,${0.34 * show})`;
      g.lineWidth = hit ? 2 : 1.3;
      g.beginPath();
      for (let i = 0; i + 1 < pts.length; i += 2) {
        const q = P(pts[i], pts[i + 1]);
        i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y);
      }
      g.stroke();
    });

    if (route > 0) {
      const count = route * path.length;
      g.shadowColor = GOLD; g.shadowBlur = 14;
      g.strokeStyle = GOLD; g.lineWidth = 3.4;
      path.forEach(([a, b, k], i) => {
        const f = sat(count - i);
        if (f <= 0) return;
        const pts = J.e[k][3];
        const forward = Math.hypot(pts[0] - vx(a), pts[1] - vz(a)) < Math.hypot(pts[0] - vx(b), pts[1] - vz(b));
        const N = pts.length / 2, last = Math.max(1, Math.ceil(f * (N - 1)));
        g.beginPath();
        for (let i2 = 0; i2 <= last; i2++) {
          const j = forward ? i2 : N - 1 - i2, q = P(pts[j * 2], pts[j * 2 + 1]);
          i2 ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y);
        }
        g.stroke();
      });
      g.shadowBlur = 0;
    }

    for (let i = 0; i < n; i++) {
      const r0 = Math.hypot(vx(i) - J.c[0], vz(i) - J.c[1]) / J.r, a = sat((dots - r0 * 0.8) / 0.2);
      if (a <= 0) continue;
      const q = P(vx(i), vz(i));
      g.fillStyle = dist[i] / far < wave ? `rgba(255,190,130,${a})` : `rgba(223,231,224,${a})`;
      g.beginPath(); g.arc(q.x, q.y, 2.4, 0, Math.PI * 2); g.fill();
    }

    if (lines > 0.5) {
      g.font = '500 10px "Be Vietnam Pro", system-ui, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      for (const [k, x, z] of tagged) {
        const q = P(x, z);
        g.lineWidth = 3; g.strokeStyle = 'rgba(5,7,10,.85)';
        g.strokeText(`${J.e[k][2]} m`, q.x, q.y - 8);
        g.fillStyle = `rgba(223,231,224,${(lines - 0.5) * 2})`;
        g.fillText(`${J.e[k][2]} m`, q.x, q.y - 8);
      }
    }
    if (t > 7) {
      g.font = '500 12px "Be Vietnam Pro", system-ui, sans-serif';
      for (const [i, label] of [[J.start, 'Start'], [J.end, 'Finish']]) {
        const q = P(vx(i), vz(i));
        g.fillStyle = GOLD;
        g.beginPath(); g.arc(q.x, q.y, 6, 0, Math.PI * 2); g.fill();
        g.lineWidth = 3; g.strokeStyle = 'rgba(5,7,10,.9)';
        g.strokeText(label, q.x, q.y - 16);
        g.fillStyle = BONE;
        g.fillText(label, q.x, q.y - 16);
      }
    }

    const step = t < 3.4 ? 0 : t < 7.2 ? 1 : 2;
    caps.forEach((c, i) => c.classList.toggle('on', i <= step));
    if (route >= 1 && total.hidden) {
      total.textContent = `The shortest way across is ${Math.round(far).toLocaleString('en-US')} metres, picked from ${J.e.length} stretches of road and ${n} corners.`;
      total.hidden = false;
    }
    if (running) raf = requestAnimationFrame(draw);
  }

  return {
    setWorld(v) { world = v; },
    start() {
      if (running) return;
      if (!t0) t0 = performance.now();
      running = true;
      canvas.classList.add('on');
      world?.dim(1);
      raf = requestAnimationFrame(draw);
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
      canvas.classList.remove('on');
      world?.dim(0);
    },
    distance: far,
  };
}

/* the first strokes, made directly on the photograph */
export function drawOnPhoto(frame, { points, lines }, w, h) {
  const NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('class', 'drawn');
  svg.setAttribute('aria-hidden', 'true');
  const pt = ([x, y]) => [x * w, y * h];
  lines.forEach(([a, b], i) => {
    const [x1, y1] = pt(points[a]), [x2, y2] = pt(points[b]);
    const l = document.createElementNS(NS, 'line');
    Object.entries({ x1, y1, x2, y2 }).forEach(([k, v]) => l.setAttribute(k, v));
    const len = Math.hypot(x2 - x1, y2 - y1);
    l.style.strokeDasharray = len;
    l.style.strokeDashoffset = len;
    l.style.setProperty('--d', `${0.5 + i * 0.13}s`);
    svg.appendChild(l);
  });
  points.forEach((p, i) => {
    const [cx, cy] = pt(p), c = document.createElementNS(NS, 'circle');
    Object.entries({ cx, cy, r: 9 }).forEach(([k, v]) => c.setAttribute(k, v));
    c.style.setProperty('--d', `${i * 0.08}s`);
    svg.appendChild(c);
  });
  frame.appendChild(svg);
  requestAnimationFrame(() => svg.classList.add('in'));
  return new Promise((r) => setTimeout(r, REDUCE ? 0 : 2300));
}
