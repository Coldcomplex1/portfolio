import { clamp, lerp, REDUCE } from '../util.js';

/* =====================================================================
   Round four: Hotelling's street. Customers spread along one street walk
   to whichever stall is closer. You drag your stall, your rival answers
   with its best reply, and the two of you end up side by side.
   ===================================================================== */

const GOLD = '#f2b84b', RED = '#d8342b', BONE = '#dfe7e0';
const N = 44, GAP = 0.035;

export function createStreet(root, data, onSettled) {
  const canvas = root.querySelector('canvas');
  const g = canvas.getContext('2d');
  const range = root.querySelector('input[type=range]');
  const share = root.querySelector('.street-share');
  const hint = root.querySelector('.street-hint');
  const settled = root.querySelector('.street-settled');

  const you = { x: 0.18, shown: 0.18 }, rival = { x: 0.82, shown: 0.82 };
  const folk = Array.from({ length: N }, (_, i) => ({ x: (i + 0.5) / N, y: 0, wob: i * 2.4 }));
  let raf = 0, running = false, lastMove = 0, done = false;

  const reply = (a) => (a < 0.5 ? a + GAP : a - GAP);          /* the rival's best answer: the bigger side */
  const split = () => (you.shown + rival.shown) / 2;
  const mine = () => (you.x < rival.x ? (you.x + rival.x) / 2 : 1 - (you.x + rival.x) / 2);

  function size() {
    const r = canvas.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
  }

  function stall(x, y, col, name, s) {
    g.fillStyle = col;
    g.beginPath(); g.roundRect(x - 15 * s, y - 34 * s, 30 * s, 12 * s, 4 * s); g.fill();
    g.fillStyle = 'rgba(5,7,10,.75)';
    g.fillRect(x - 12 * s, y - 22 * s, 24 * s, 22 * s);
    g.strokeStyle = col; g.lineWidth = 1.4 * s;
    g.strokeRect(x - 12 * s, y - 22 * s, 24 * s, 22 * s);
    g.fillStyle = BONE;
    g.font = `500 ${11 * s}px "Be Vietnam Pro", system-ui, sans-serif`;
    g.textAlign = 'center';
    g.fillText(name, x, y - 42 * s);
  }

  function draw(t) {
    const w = canvas.width, h = canvas.height, s = w / canvas.getBoundingClientRect().width;
    g.clearRect(0, 0, w, h);
    const m = 34 * s, y = h * 0.74, x0 = m, x1 = w - m, X = (u) => lerp(x0, x1, u);
    g.strokeStyle = 'rgba(223,231,224,.32)';
    g.lineWidth = 2 * s;
    g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke();
    const cut = split(), left = you.shown < rival.shown;
    g.fillStyle = 'rgba(242,184,75,.1)';
    if (left) g.fillRect(x0, y - 6 * s, X(cut) - x0, 12 * s);
    else g.fillRect(X(cut), y - 6 * s, x1 - X(cut), 12 * s);
    for (const f of folk) {
      const mineNow = left ? f.x < cut : f.x > cut;
      const px = X(f.x), py = y + (16 + 12 * Math.sin(f.wob)) * s + Math.sin(t * 0.003 + f.wob) * 1.4 * s;
      g.fillStyle = mineNow ? GOLD : RED;
      g.beginPath(); g.arc(px, py, 3.2 * s, 0, Math.PI * 2); g.fill();
    }
    stall(X(you.shown), y, GOLD, 'You', s);
    stall(X(rival.shown), y, RED, 'Rival', s);
  }

  function frame(t) {
    you.shown = lerp(you.shown, you.x, 0.2);
    rival.shown = lerp(rival.shown, rival.x, REDUCE ? 1 : 0.07);
    draw(t);
    if (running) raf = requestAnimationFrame(frame);
  }

  function refresh() {
    const pct = Math.round(mine() * 100);
    share.textContent = `You have ${pct}% of the street. Your rival has ${100 - pct}%.`;
  }

  function move(v) {
    you.x = clamp(v, 0, 1);
    refresh();
    lastMove = performance.now();
    clearTimeout(move.t);
    move.t = setTimeout(answer, 520);
  }

  function answer() {
    rival.x = reply(you.x);
    refresh();
    if (done) return;
    if (Math.abs(you.x - 0.5) < 0.07) {
      done = true;
      hint.hidden = true;
      settled.hidden = false;
      settled.classList.add('in');
      onSettled?.();
    } else {
      hint.textContent = data.hint;
      hint.hidden = false;
    }
  }

  range.addEventListener('input', () => move(+range.value / 100));
  new ResizeObserver(() => { size(); draw(performance.now()); }).observe(canvas);

  return {
    start() { if (!running) { running = true; size(); refresh(); raf = requestAnimationFrame(frame); } },
    stop() { running = false; cancelAnimationFrame(raf); },
  };
}
