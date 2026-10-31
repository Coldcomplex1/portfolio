import { REDUCE } from './util.js';
import { grainDataURL } from './textures.js';

/* =====================================================================
   Page wiring: word masks, reveals, the vertical chapter word, and the map
   from scroll position to a place on the camera's path. Each element with
   a data-stop is pinned to that stop, and sections that are still locked
   take up no room, so the page ends at the round in play.
   ===================================================================== */

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function initUI() {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  $('#grain').style.backgroundImage = `url(${grainDataURL()})`;
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

  /* word-level masks let every display heading arrive at a reading pace */
  for (const el of $$('.split')) {
    const text = el.textContent.trim().replace(/\s+/g, ' ');
    el.setAttribute('aria-label', text);
    el.innerHTML = text.split(' ')
      .map((w, i) => `<span class="w" aria-hidden="true"><span class="wi" style="--i:${i}">${esc(w)}</span></span>`)
      .join(' ');
  }

  /* the opening arrives in order once the page is up */
  $$('#start .reveal, #start .split').forEach((el, i) => el.style.setProperty('--d', `${0.25 + i * 0.12}s`));

  const io = new IntersectionObserver((es) => {
    for (const e of es) {
      if (!e.isIntersecting) continue;
      e.target.classList.add('in');
      io.unobserve(e.target);
    }
  }, { rootMargin: '0px 0px -6% 0px', threshold: 0.04 });
  for (const el of $$('.reveal, .split')) io.observe(el);

  /* ------------------------------------------------------------ chapters */
  const vword = $('#vword'), vMain = $('.vword-main', vword), vGloss = $('.vword-gloss', vword);
  let active = null, swapT = 0;
  const top = (el) => el.getBoundingClientRect().top + scrollY;
  const shown = (s) => $$(s).filter((el) => el.offsetParent !== null);

  /* scroll → progress along the camera's path, one straight run between stops */
  let breaks = [[0, 0], [1, 0]];
  function measure() {
    const vh = innerHeight;
    const B = shown('[data-stop]').map((el) => [Math.max(0, top(el) - vh * 0.14), parseFloat(el.dataset.stop)]);
    for (let i = 1; i < B.length; i++) if (B[i][0] <= B[i - 1][0]) B[i][0] = B[i - 1][0] + 1;
    breaks = B.length > 1 ? B : [[0, B[0]?.[1] ?? 0], [1, B[0]?.[1] ?? 0]];
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

  function onScroll() {
    const vh = innerHeight;
    let sec = null;
    for (const el of shown('[data-word]')) if (top(el) - vh * 0.5 <= scrollY) sec = el;
    if (sec && sec !== active) {
      active = sec;
      clearTimeout(swapT);
      vword.classList.add('swap');
      swapT = setTimeout(() => {
        vMain.textContent = sec.dataset.word;
        vGloss.textContent = sec.dataset.gloss;
        vword.classList.remove('swap');
      }, REDUCE ? 0 : 380);
    }
  }
  addEventListener('scroll', onScroll, { passive: true });

  measure();
  onScroll();
  addEventListener('resize', measure);
  document.fonts?.ready?.then(measure);
  new ResizeObserver(() => { measure(); onScroll(); }).observe(document.body);

  /* the page moving down by itself: slow, and the visitor can always take over */
  let glide = 0;
  const stopGlide = () => { glide = 0; };
  addEventListener('wheel', stopGlide, { passive: true });
  addEventListener('touchstart', stopGlide, { passive: true });
  function glideTo(el, { ms = 1900, offset = 0.06 } = {}) {
    return new Promise((done) => {
      const y0 = scrollY, y1 = Math.max(0, top(el) - innerHeight * offset);
      if (REDUCE) { window.scrollTo({ top: y1, behavior: 'instant' }); done(); return; }
      const id = ++glide + 1, t0 = performance.now();
      glide = id;
      const step = (now) => {
        if (glide !== id) { done(); return; }
        const t = Math.min(1, (now - t0) / ms), e = t * t * t * (t * (t * 6 - 15) + 10);
        window.scrollTo({ top: y0 + (y1 - y0) * e, behavior: 'instant' });
        if (t < 1) requestAnimationFrame(step); else done();
      };
      requestAnimationFrame(step);
    });
  }

  return {
    measure,
    progress,
    glideTo,
    update(state) {
      document.documentElement.classList.toggle('deep', state.p > 0.2);
    },
  };
}
