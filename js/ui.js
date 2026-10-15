import { REDUCE, clamp, sat } from './util.js';
import { grainDataURL } from './textures.js';

/* =====================================================================
   Page wiring: word masks, reveals, nav, the chapter sheet, the rail,
   the vertical chapter word, the floor meter, and the map from scroll
   position to a place on the journey.
   ===================================================================== */

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function initUI() {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  $('#grain').style.backgroundImage = `url(${grainDataURL()})`;

  /* word-level masks let every display heading arrive at a reading pace */
  for (const el of $$('.split')) {
    const text = el.textContent.trim().replace(/\s+/g, ' ');
    el.setAttribute('aria-label', text);
    el.innerHTML = text.split(' ')
      .map((w, i) => `<span class="w" aria-hidden="true"><span class="wi" style="--i:${i}">${esc(w)}</span></span>`)
      .join(' ');
  }

  /* the hero arrives in order once the page is up */
  const heroSeq = $$('#hero .reveal, #hero .split');
  heroSeq.forEach((el, i) => el.style.setProperty('--d', `${0.25 + i * 0.12}s`));

  const io = new IntersectionObserver((es) => {
    for (const e of es) {
      if (!e.isIntersecting) continue;
      e.target.classList.add('in');
      io.unobserve(e.target);
    }
  }, { rootMargin: '0px 0px -10% 0px', threshold: 0.04 });
  for (const el of $$('.reveal, .split')) io.observe(el);

  /* honors light up as they pass the middle of the screen */
  const honors = $$('.honor');
  const hio = new IntersectionObserver((es) => {
    for (const e of es) e.target.classList.toggle('on', e.isIntersecting);
  }, { rootMargin: '-40% 0px -40% 0px' });
  honors.forEach((li) => hio.observe(li));

  /* ------------------------------------------------------------ the sheet */
  const burger = $('#burger'), sheet = $('#sheet');
  const setSheet = (open) => {
    burger.setAttribute('aria-expanded', String(open));
    burger.setAttribute('aria-label', open ? 'Close the chapter menu' : 'Open the chapter menu');
    if (open) {
      sheet.hidden = false;
      requestAnimationFrame(() => sheet.classList.add('open'));
      $('a', sheet).focus({ preventScroll: true });
    } else {
      sheet.classList.remove('open');
      setTimeout(() => { if (!sheet.classList.contains('open')) sheet.hidden = true; }, 500);
    }
  };
  burger.addEventListener('click', () => setSheet(burger.getAttribute('aria-expanded') !== 'true'));
  sheet.addEventListener('click', (e) => { if (e.target.closest('a')) setSheet(false); });
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !sheet.hidden) { setSheet(false); burger.focus(); }
  });

  /* ------------------------------------------------------------ chapters */
  const chapters = ['hero', 'origin', 'research', 'leadership', 'honors', 'contact'].map((id) => $('#' + id));
  const navLinks = $$('.nav-links a'), railLinks = $$('#rail a');
  const vword = $('#vword'), vMain = $('.vword-main', vword), vGloss = $('.vword-gloss', vword);
  const nav = $('#nav'), hud = $('#hud'), fl = $('#fl'), alt = $('#alt');
  const hudFl = $('[data-fl]', hud), hudAlt = $('[data-alt]', hud);
  let active = -1, lastY = scrollY, swapT = 0;

  const top = (el) => el.getBoundingClientRect().top + scrollY;

  /* scroll → journey progress. Each stop holds while its chapter is read,
     then the camera travels while the next one comes up. In the climb, each
     honor is pinned to its floor: when it crosses the middle of the screen,
     the meter reads exactly the floor on its tag. */
  let breaks = [[0, 0], [1, 1]];
  function measure() {
    const vh = innerHeight;
    const B = [[0, 0]];
    const hold = (el, k) => {
      const t = top(el), h = el.offsetHeight;
      B.push([t - vh * 0.35, k]);
      B.push([Math.max(t - vh * 0.35 + 1, t + h - vh * 0.95), k + 0.08]);
    };
    hold(chapters[1], 1);
    hold(chapters[2], 2);
    hold(chapters[3], 3);
    B.push([top(chapters[4]), 4]);
    for (const li of honors) {
      const floor = parseFloat(li.dataset.floor || '1');
      B.push([top(li) + li.offsetHeight / 2 - vh / 2, 4 + (floor - 1) / 80]);
    }
    B.push([top(chapters[5]) - vh * 0.2, 6]);
    for (let i = 1; i < B.length; i++) if (B[i][0] <= B[i - 1][0]) B[i][0] = B[i - 1][0] + 1;
    breaks = B;
  }

  function progress(y = scrollY) {
    const B = breaks;
    if (y <= B[0][0]) return B[0][1];
    for (let i = 1; i < B.length; i++) {
      if (y < B[i][0]) {
        const [y0, p0] = B[i - 1], [y1, p1] = B[i];
        return p0 + (p1 - p0) * ((y - y0) / (y1 - y0));
      }
    }
    return B[B.length - 1][1];
  }

  function setActive(i) {
    if (i === active) return;
    active = i;
    navLinks.forEach((a) => a.classList.toggle('on', a.dataset.sec === chapters[i].id));
    railLinks.forEach((a, k) => a.classList.toggle('on', k === i));
    const sec = chapters[i];
    clearTimeout(swapT);
    vword.classList.add('swap');
    swapT = setTimeout(() => {
      vMain.textContent = sec.dataset.word;
      vGloss.textContent = sec.dataset.gloss;
      vword.classList.remove('swap');
    }, REDUCE ? 0 : 380);
  }

  function onScroll() {
    const y = scrollY, vh = innerHeight;
    let i = 0;
    chapters.forEach((el, k) => { if (top(el) - vh * 0.5 <= y) i = k; });
    setActive(i);
    /* the nav steps aside while reading down, returns on the way back up */
    if (y > lastY + 6 && y > vh * 0.7 && sheet.hidden) nav.classList.add('hide');
    else if (y < lastY - 6 || y < vh * 0.7) nav.classList.remove('hide');
    lastY = y;
  }
  addEventListener('scroll', onScroll, { passive: true });

  measure();
  onScroll();
  addEventListener('resize', measure);
  document.fonts?.ready?.then(measure);
  new ResizeObserver(() => measure()).observe(document.body);

  let lastFloor = -1, lastAlt = -1;
  return {
    measure,
    progress,
    update(state) {
      if (state.floor !== lastFloor || state.alt !== lastAlt) {
        lastFloor = state.floor; lastAlt = state.alt;
        const f = String(state.floor).padStart(2, '0');
        fl.textContent = f; hudFl.textContent = f;
        alt.textContent = state.alt; hudAlt.textContent = state.alt;
      }
      hud.classList.toggle('on', state.p > 3.9 && state.p < 5.6);
      document.documentElement.classList.toggle('deep', state.p > 0.55 && state.p < 5.75);
    },
    /* the page still keeps its meter when there is no 3-D world */
    staticMeter() {
      const tick = () => {
        const p = progress();
        const c = sat(p - 4);
        this.update({ p, floor: Math.round(1 + 80 * c), alt: Math.round(461 * c) });
      };
      addEventListener('scroll', tick, { passive: true });
      tick();
    },
  };
}
