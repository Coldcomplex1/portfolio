import { PLAYER, START, ROUNDS, END } from './content.js';
import { project } from '../world/map.js';
import { createPinMap, paintBase } from './pinmap.js';
import { createChess } from './chess.js';
import { createStreet } from './street.js';
import { createGraph, drawOnPhoto } from './graph.js';
import { params, REDUCE } from '../util.js';

/* =====================================================================
   The game. Each round is one section of the page, and the next one does
   not exist until this one is answered, so the page simply ends at the
   round in play. A right guess moves on by itself. A wrong guess waits
   for the Continue button, so nobody can get stuck.
   ===================================================================== */

const POINTS = 5000;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const $ = (s, r = document) => r.querySelector(s);
const metresText = (m) => (m >= 1000 ? `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km` : `${Math.round(m)} m`);

function credit(c) {
  const [name, url] = c.license;
  return `Photo by <a href="${c.url}" target="_blank" rel="noopener">${esc(c.by)}</a>, <a href="${url}" target="_blank" rel="noopener">${name}</a>`;
}

function frame(photo, extra = '') {
  return `<figure class="frame" style="aspect-ratio:${photo.w}/${photo.h}">
    <img src="${photo.src}" alt="${esc(photo.alt)}" width="${photo.w}" height="${photo.h}" loading="lazy">
    <div class="marks"></div>${extra}
    ${photo.sample ? '<span class="tag">Sample photo</span>' : ''}
    ${photo.credit ? `<figcaption class="credit">${credit(photo.credit)}</figcaption>` : ''}
  </figure>`;
}

function momentHTML(r, i) {
  const nextLabel = i === ROUNDS.length - 1 ? 'See how you did' : 'Next round';
  if (r.moment === 'graph') {
    return `<div class="moment math" data-stop="3" hidden>
      <div class="math-card">
        <p class="label"><i class="dot"></i>What I see</p>
        <ol class="caps">${r.captions.map((c) => `<li>${esc(c)}</li>`).join('')}</ol>
        <p class="math-total" hidden></p>
        <button class="go next" type="button">${nextLabel}</button>
      </div>
    </div>`;
  }
  if (r.moment === 'chess') {
    const c = r.chess;
    return `<div class="moment chess" hidden>
      <div class="table-step">
        ${frame(r.table, `<button class="hot" type="button" style="left:${r.table.hot.x * 100}%;top:${r.table.hot.y * 100}%"><i></i><span>${esc(r.table.label)}</span></button>`)}
      </div>
      <div class="chess-wrap" hidden>
        <div class="board-slot"></div>
        <div class="chess-text">
          ${c.sample ? `<p class="tag inline">${esc(c.sampleNote)}</p>` : ''}
          <p class="big">${esc(c.intro)}</p>
          <p class="chess-say" aria-live="polite">Click a white piece, then the square it should go to.</p>
          <button class="plain show-move" type="button">Show me the move</button>
          <div class="chess-after" hidden>
            ${c.reasoning.map((p) => `<p>${esc(p)}</p>`).join('')}
            <p class="source">${esc(c.source)}</p>
          </div>
        </div>
      </div>
      <button class="go next" type="button">${nextLabel}</button>
    </div>`;
  }
  if (r.moment === 'street') {
    const s = r.street;
    return `<div class="moment street" hidden>
      <p class="big">${esc(s.intro)}</p>
      <div class="street-stage" style="background-image:url(${r.photo.src})">
        <canvas></canvas>
        <input type="range" min="0" max="100" value="18" aria-label="Move your stall along the street">
      </div>
      <p class="street-share" aria-live="polite"></p>
      <p class="street-hint" aria-live="polite" hidden></p>
      <p class="street-settled big" hidden>${esc(s.settled)}</p>
      <button class="go next" type="button">${nextLabel}</button>
    </div>`;
  }
  return '';
}

const STOP = { r1: 1, r2: 2, r3: 4, r4: 5 };

function roundHTML(r, i) {
  return `<section class="round" id="${r.id}" data-stop="${STOP[r.id]}" data-word="${esc(r.word)}" data-gloss="${esc(r.gloss)}" hidden>
    <header class="round-head" tabindex="-1">
      <p class="label reveal"><i class="dot"></i>Round ${i + 1} of ${ROUNDS.length}</p>
      <h2 class="display split">${esc(r.title)}</h2>
      <p class="intro reveal">${esc(r.prompt)}</p>
    </header>
    <div class="stage">
      <div class="stage-main">
        ${frame(r.photo)}
        <div class="result" hidden>
          <p class="verdict"></p>
          <h3 class="place">${esc(r.answer.place)}</h3>
          <p class="big">${esc(r.reveal)}</p>
          <ol class="clues">${r.clues.map((c) => `<li>${esc(c.label)}</li>`).join('')}</ol>
          <button class="go proceed" type="button"><span>Continue</span></button>
        </div>
      </div>
      <aside class="guess" aria-label="Your guess">
        <div class="map-wrap">
          <canvas class="pinmap" tabindex="0" role="application" aria-label="Map of Saigon. Use the arrow keys to move your pin and Enter to guess."></canvas>
          <div class="zoom"><button type="button" aria-label="Zoom in">+</button><button type="button" aria-label="Zoom out">−</button></div>
        </div>
        <p class="map-hint"></p>
        <button class="go guess-btn" type="button" disabled>Guess</button>
      </aside>
    </div>
    ${momentHTML(r, i)}
  </section>`;
}

export function createGame() {
  $('#brand-name').textContent = PLAYER.name;
  $('#start-title').textContent = START.title;
  $('#start-lede').textContent = START.lede;
  $('#play').textContent = START.button;
  $('#end-title').textContent = END.title;
  $('#end-lede').textContent = END.lede;
  $('#end-contact').textContent = END.contact;
  $('#mail').textContent = PLAYER.email;
  $('#mail').href = `mailto:${PLAYER.email}`;
  $('#linkedin').href = PLAYER.linkedin;
  $('#copyright').textContent = `© ${new Date().getFullYear()} ${PLAYER.name}`;
  const photos = ROUNDS.flatMap((r) => [r.photo, r.table]).filter(Boolean);
  $('#credits').innerHTML = `Photographs from Wikimedia Commons by ${[...new Set(photos.map((p) => p.credit?.by).filter(Boolean))].map(esc).join(', ')}, used under Creative Commons licenses as marked on each photo.`;
  $('#rounds').innerHTML = ROUNDS.map(roundHTML).join('');

  const hud = $('#score');
  const state = ROUNDS.map((r, i) => {
    const el = $(`#${r.id}`);
    return { r, i, el, result: $('.result', el), moment: $('.moment', el), answered: false, right: false, metres: 0, points: 0, opened: false };
  });
  let ui = null, world = null, total = 0, played = -1, graph = null, street = null, chess = null, holdT = 0;

  const setHud = () => {
    const n = Math.min(played + 1, ROUNDS.length);
    hud.innerHTML = played < 0 ? '' : `<span>Round ${n} of ${ROUNDS.length}</span> <b>${total.toLocaleString('en-US')}</b>`;
  };

  /* ---------------------------------------------------------------- flow */
  function open(i) {
    const s = state[i];
    played = i;
    s.el.hidden = false;
    ui.measure();
    s.map.refresh();
    /* the next photograph is already waiting when the page gets there */
    if (ROUNDS[i + 1]) new Image().src = ROUNDS[i + 1].photo.src;
    setHud();
    ui.glideTo(s.el, { ms: i === 0 ? 2600 : 2000, offset: 0 }).then(() => $('.round-head', s.el).focus({ preventScroll: true }));
  }

  function guess(i) {
    const s = state[i], { r } = s;
    if (s.answered || !s.map.pin) return;
    s.answered = true;
    const a = project(r.answer.lat, r.answer.lon);
    s.metres = Math.hypot(s.map.pin.x - a.x, s.map.pin.z - a.z) * 10;
    s.right = s.metres <= r.answer.within;
    s.points = Math.round(POINTS * Math.exp(-s.metres / 1800));
    total += s.points;
    setHud();

    s.map.reveal({ ...a, show: r.answer.show }, s.right);
    world?.beacon(a.x, a.z, true);
    s.el.classList.add('answered', s.right ? 'right' : 'wrong');
    $('.guess-btn', s.el).hidden = true;
    $('.map-hint', s.el).hidden = true;
    $('.marks', s.el).innerHTML = r.clues.map((c, k) => `<span class="mark" style="left:${c.x * 100}%;top:${c.y * 100}%;--d:${0.3 + k * 0.25}s">${k + 1}</span>`).join('');
    $('.verdict', s.el).innerHTML = `<b>${s.right ? 'Right' : 'Not quite'}</b><span>${metresText(s.metres)} from the answer, ${s.points.toLocaleString('en-US')} points</span>`;
    s.result.hidden = false;
    ui.measure();

    const go = $('.proceed', s.el);
    if (s.right) {
      /* long enough to read, and never while someone is reading */
      const words = `${r.reveal} ${r.clues.map((c) => c.label).join(' ')}`.split(/\s+/).length;
      const hold = REDUCE ? 0 : Math.max(4500, words * 150);
      go.classList.add('counting');
      go.style.setProperty('--hold', `${hold}ms`);
      if (!REDUCE) {
        holdT = setTimeout(() => proceed(i), hold);
        s.result.addEventListener('pointerenter', () => { clearTimeout(holdT); go.classList.remove('counting'); }, { once: true });
      }
    }
    if (innerWidth <= 960) ui.glideTo(s.result, { ms: 1200, offset: 0.1 });
    else if (s.result.getBoundingClientRect().bottom > innerHeight) ui.glideTo(s.result, { ms: 1200, offset: 0.2 });
  }

  async function proceed(i) {
    clearTimeout(holdT);
    const s = state[i], { r } = s;
    if (s.opened) return;
    s.opened = true;
    world?.beacon(0, 0, false);
    $('.proceed', s.el).classList.remove('counting');
    $('.proceed', s.el).disabled = true;
    if (!r.moment) { next(i); return; }
    if (r.moment === 'graph') {
      await ui.glideTo($('.stage', s.el), { ms: 900, offset: 0.1 });
      await drawOnPhoto($('.frame', s.el), r.drawing, r.photo.w, r.photo.h);
    }
    s.moment.hidden = false;
    ui.measure();
    await ui.glideTo(s.moment, { ms: 2200, offset: 0.08 });
    if (r.moment === 'street') street.start();
  }

  function next(i) {
    if (i + 1 < ROUNDS.length) { open(i + 1); return; }
    finish();
  }

  function finish() {
    played = ROUNDS.length;
    const end = $('#end');
    end.hidden = false;
    $('#final').textContent = total.toLocaleString('en-US');
    $('#recap').innerHTML = state.map((s, k) => `<li><span>${esc(END.rounds[k])}</span><b>${s.points.toLocaleString('en-US')}</b></li>`).join('');
    ui.measure();
    setHud();
    world?.beacon(0, 0, false);
    $('#foot').hidden = false;
    ui.glideTo(end, { ms: 2600 });
  }

  /* ---------------------------------------------------------------- wiring */
  function attach(u) {
    ui = u;
    new Image().src = ROUNDS[0].photo.src;
    $('#play').addEventListener('click', () => open(0));
    $('#again').addEventListener('click', () => location.reload());
    for (const s of state) {
      const btn = $('.guess-btn', s.el), canvas = $('.pinmap', s.el);
      s.map = createPinMap(canvas, {
        onPin() { btn.disabled = false; },
        onEnter() { guess(s.i); },
      });
      $('.map-hint', s.el).textContent = s.map.hint;
      btn.addEventListener('click', () => guess(s.i));
      const [plus, minus] = s.el.querySelectorAll('.zoom button');
      plus.addEventListener('click', () => s.map.zoom(1.6));
      minus.addEventListener('click', () => s.map.zoom(1 / 1.6));
      $('.proceed', s.el).addEventListener('click', () => proceed(s.i));
      $('.next', s.el)?.addEventListener('click', () => next(s.i));
    }

    /* round two's moment runs only while it is on screen */
    const math = state.find((s) => s.r.moment === 'graph');
    graph = createGraph($('#math'), [...math.moment.querySelectorAll('.caps li')], $('.math-total', math.moment));
    if (world) graph.setWorld(world);
    new IntersectionObserver((es) => {
      for (const e of es) { if (e.isIntersecting) graph.start(); else graph.stop(); }
    }, { threshold: 0.35 }).observe(math.moment);

    /* round three: the table in the photograph opens the board */
    const ch = state.find((s) => s.r.moment === 'chess');
    $('.hot', ch.moment).addEventListener('click', () => {
      $('.table-step', ch.moment).hidden = true;
      $('.chess-wrap', ch.moment).hidden = false;
      chess ??= createChess(ch.moment, ch.r.chess, { reduce: REDUCE });
      ui.measure();
      ui.glideTo(ch.moment, { ms: 700, offset: 0.1 });
    });
    $('.show-move', ch.moment).addEventListener('click', (e) => { chess?.showAnswer(); e.currentTarget.hidden = true; });
    ch.moment.addEventListener('solved', () => {
      $('.show-move', ch.moment).hidden = true;
      ui.measure();
      const go = $('.next', ch.moment);
      if (go.getBoundingClientRect().bottom > innerHeight) ui.glideTo(go, { ms: 1200, offset: 0.78 });
    });

    const st = state.find((s) => s.r.moment === 'street');
    street = createStreet(st.moment, st.r.street, () => ui.measure());

    if (params.has('debug')) {
      window.__g = { state, open, guess, proceed, next, finish, pin: (i, lat, lon) => { const p = project(lat, lon); state[i].map.setPin(p); } };
    }
  }

  return {
    attach,
    setMap(map, streets) {
      paintBase(map, streets);
      for (const s of state) s.map.refresh();
    },
    setWorld(w) { world = w; graph?.setWorld(w); },
  };
}
