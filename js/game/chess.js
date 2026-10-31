/* =====================================================================
   Round three's board: a position from one game. No chess engine, only a
   one-try guess at the move that was really played, then the moves
   that followed and the reasoning behind them.
   ===================================================================== */

const GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
const FILES = 'abcdefgh';

function parse(fen) {
  const board = {};
  fen.split(' ')[0].split('/').forEach((row, r) => {
    let f = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) { f += +ch; continue; }
      board[FILES[f] + (8 - r)] = ch;
      f++;
    }
  });
  return board;
}

export function createChess(root, data, { reduce = false } = {}) {
  const board = parse(data.fen);
  const flipped = data.fen.split(' ')[1] === 'b';
  const grid = document.createElement('div');
  grid.className = 'board';
  grid.setAttribute('role', 'grid');
  grid.setAttribute('aria-label', 'Chess position, White to move');
  const cells = {};
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const sq = FILES[flipped ? 7 - f : f] + (flipped ? r + 1 : 8 - r);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `sq ${(r + f) % 2 ? 'dark' : 'light'}`;
      b.dataset.sq = sq;
      cells[sq] = b;
      grid.appendChild(b);
    }
  }
  root.querySelector('.board-slot').appendChild(grid);
  const say = root.querySelector('.chess-say');
  const after = root.querySelector('.chess-after');

  function paint() {
    for (const [sq, b] of Object.entries(cells)) {
      const pc = board[sq];
      b.innerHTML = pc ? `<span class="pc ${pc === pc.toUpperCase() ? 'w' : 'b'}">${GLYPH[pc.toLowerCase()]}︎</span>` : '';
      b.setAttribute('aria-label', `${sq}${pc ? ` ${pc === pc.toUpperCase() ? 'white' : 'black'} ${{ k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' }[pc.toLowerCase()]}` : ''}`);
    }
  }
  paint();

  let from = null, done = false;
  const mark = (sq, cls) => cells[sq]?.classList.add(cls);
  const clear = (cls) => Object.values(cells).forEach((b) => b.classList.remove(cls));
  const play = (uci) => {
    const a = uci.slice(0, 2), b = uci.slice(2, 4);
    board[b] = board[a];
    delete board[a];
    paint();
    clear('last');
    mark(a, 'last'); mark(b, 'last');
  };

  function finish(gotIt) {
    done = true;
    grid.classList.add('over');
    say.textContent = gotIt ? 'That is the move.' : 'A good try, but the move played was this one.';
    const line = [data.move, ...data.line];
    let i = 0;
    const next = () => {
      play(line[i++]);
      if (i < line.length) setTimeout(next, reduce ? 0 : 1000);
      else {
        after.hidden = false;
        after.classList.add('in');
        root.dispatchEvent(new CustomEvent('solved', { bubbles: true }));
      }
    };
    setTimeout(next, reduce ? 0 : 380);
  }

  grid.addEventListener('click', (e) => {
    const b = e.target.closest('.sq');
    if (!b || done) return;
    const sq = b.dataset.sq, pc = board[sq];
    if (from === sq) { from = null; clear('sel'); return; }
    if (!from) {
      if (pc && pc === pc.toUpperCase()) { from = sq; clear('sel'); mark(sq, 'sel'); say.textContent = 'Now choose where it goes.'; }
      return;
    }
    if (pc && pc === pc.toUpperCase()) { from = sq; clear('sel'); mark(sq, 'sel'); return; }
    const guess = from + sq;
    clear('sel');
    from = null;
    finish(guess === data.move);
  });

  return { showAnswer() { if (!done) finish(false); } };
}
