/* =====================================================================
   Everything a visitor reads or guesses lives in this one file.

   To replace a sample:
     photo    put your picture in img/rounds/, change src, w and h, change
              or remove credit, and set sample to false.
     answer   change lat and lon. "within" is how close a pin must be to
              count as right, in metres.
     clues    x and y are where the marker sits on the photo, from 0 to 1.
     round 2  the lines on the photo are the "drawing" points below. The
              overhead graph is built from the real roads by
              tools/build_map.py, so a new junction needs one rebuild there.
     chess    fen is the position, move is the move you played, line is what
              happened next, and reasoning is your own thinking.
   Every item marked sample: true shows a small Sample tag on the page, so
   nothing borrowed can go live by accident.
   ===================================================================== */

export const PLAYER = {
  name: 'Doan Van Quyet',
  short: 'QUYET',
  email: 'vanquyet180109@gmail.com',
  linkedin: 'https://www.linkedin.com/in/vanquyetdoan',
};

export const START = {
  title: 'Where am I?',
  lede: 'Four photographs from my Saigon. Find each one on the map, and you will find out who I am along the way.',
  button: 'Play',
};

const commons = (file) => `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(file.replace(/ /g, '_'))}`;
const BY2 = ['CC BY 2.0', 'https://creativecommons.org/licenses/by/2.0/'];
const BY3 = ['CC BY 3.0', 'https://creativecommons.org/licenses/by/3.0/'];

export const ROUNDS = [
  {
    id: 'r1',
    word: 'Nhà', gloss: 'home',
    title: 'Where do I live?',
    prompt: 'I pass this on my way to school. Drop a pin where you think I live.',
    photo: {
      src: 'img/rounds/r1-tran-phu.jpg', w: 1920, h: 1280,
      alt: 'An old shophouse beside a dim sum shop with red signs, on a busy street with parked motorbikes',
      sample: true,
      credit: { by: 'trungydang', license: BY3, url: commons('Khu phố người Hoa -q5-đầu đường Trần Phú -HCMVN - panoramio.jpg') },
    },
    answer: { lat: 10.75303, lon: 106.6697, within: 1500, place: 'Chợ Lớn, District 5', show: 'area' },
    clues: [
      { x: 0.05, y: 0.475, label: 'Chinese characters on a shop sign, right beside the Vietnamese name' },
      { x: 0.243, y: 0.508, label: 'Há cảo on the menu board is the Cantonese har gow, spelled the Vietnamese way' },
      { x: 0.345, y: 0.54, label: 'The small print ends in Q.5, which means Quận 5, District 5' },
      { x: 0.56, y: 0.42, label: 'A narrow old shophouse, squeezed between newer buildings' },
    ],
    reveal: 'This is Chợ Lớn, the old Chinese quarter of Saigon. The menus I pass on my way to school are written in Cantonese, and the food words crossed into Vietnamese long ago. Follow the signs and they bring you to District 5, which is where I live.',
  },
  {
    id: 'r2',
    word: 'Đồ thị', gloss: 'a graph',
    title: 'A city full of equations',
    prompt: 'Every road in this neighbourhood seems to end up here. Where am I standing?',
    photo: {
      src: 'img/rounds/r2-roundabout.jpg', w: 1920, h: 778,
      alt: 'A wide roundabout with a wall of motorbikes waiting at a crossing, in front of shophouses and a statue',
      sample: true,
      credit: { by: 'trungydang', license: BY3, url: commons('Vong xoay Cholon,duong Hai thuong Lang ong,q5, hcmvn - panoramio.jpg') },
    },
    answer: { lat: 10.750395, lon: 106.6592, within: 1000, place: 'The Chợ Lớn roundabout', show: 'point' },
    clues: [
      { x: 0.218, y: 0.72, label: 'A statue standing in the middle of the traffic marks the roundabout' },
      { x: 0.6, y: 0.56, label: 'Old shophouse fronts again, so you have not left Chợ Lớn' },
      { x: 0.8, y: 0.84, label: 'A green Mai Linh taxi, as Saigon as it gets' },
    ],
    reveal: 'This is the roundabout at the end of Hải Thượng Lãn Ông, where six roads meet. Most people see a traffic jam here. Watch what I see.',
    moment: 'graph',
    /* drawn over the photograph itself, as fractions of its width and height */
    drawing: {
      points: [[0.13, 0.93], [0.216, 0.79], [0.3, 0.8], [0.34, 0.9], [0.44, 0.81], [0.47, 0.89], [0.6, 0.875], [0.42, 0.97]],
      lines: [[0, 1], [1, 2], [2, 4], [4, 6], [0, 3], [3, 5], [5, 6], [2, 3], [4, 5], [3, 7], [5, 7]],
    },
    captions: [
      'Every place where roads meet becomes a point. Mathematicians call it a vertex.',
      'Every stretch of road between two points becomes a line with a number on it, its length in metres.',
      'Now a trip across the neighbourhood is a question with one best answer. The gold line is the shortest way through, found by spreading outward from the start until the wave touches the finish.',
    ],
  },
  {
    id: 'r3',
    word: 'Cờ', gloss: 'chess',
    title: '64 squares hidden in a city',
    prompt: 'People play chess in places like this. Find this park.',
    photo: {
      src: 'img/rounds/r3-dragon-park.jpg', w: 1920, h: 1280,
      alt: 'A golden dragon fountain rising from a pond in a city park, with shophouses behind the trees',
      sample: true,
      credit: { by: 'Fumihiko Ueno', license: BY3, url: commons('Phường 13, Quận 5, TPHCM, Vietnam - panoramio.jpg') },
    },
    answer: { lat: 10.75086, lon: 106.654, within: 500, place: 'The dragon fountain park, Ward 13, District 5', show: 'point' },
    clues: [
      { x: 0.5, y: 0.3, label: 'A golden dragon rising out of a pond, in the middle of the neighbourhood' },
      { x: 0.82, y: 0.5, label: 'Worn shophouses behind the trees, so you are still in the old quarter' },
    ],
    reveal: 'Look closer. There is a game going on here, and it is one I can play.',
    moment: 'chess',
    table: {
      src: 'img/rounds/r3-table.jpg', w: 1920, h: 1280,
      alt: 'Men sitting on the pavement around a game of cờ tướng, seen from above',
      sample: true,
      hot: { x: 0.485, y: 0.55 },
      label: 'Click the board',
      credit: { by: 'Vinnie Cartabiano', license: BY2, url: commons('People playing general chess in Vietnam.jpg') },
    },
    chess: {
      sample: true,
      sampleNote: 'Sample game. One of my own goes here.',
      intro: 'I play at 2000+ Elo. It is White to move here. What would you play?',
      fen: '4kb1r/p2n1ppp/4q3/4p1B1/4P3/1Q6/PPP2PPP/2KR4 w k - 1 16',
      move: 'b3b8',
      line: ['d7b8', 'd1d8'],
      source: 'Paul Morphy against the Duke of Brunswick and Count Isouard, Paris, 1858.',
      reasoning: [
        'The knight on d7 is the only thing standing between the rook and the back rank, so the queen goes to b8 and offers herself.',
        'Black has to take with that knight, because nothing else answers the check. The d-file opens at once.',
        'The rook lands on d8 and it is mate, since the bishop on g5 covers both d8 and e7.',
      ],
    },
  },
  {
    id: 'r4',
    word: 'Luật chơi', gloss: 'the rules of the game',
    title: 'The invisible rules of a street',
    prompt: 'Dozens of shops, all selling the same thing, door after door. Where is this street?',
    photo: {
      src: 'img/rounds/r4-lanterns.jpg', w: 1920, h: 1440,
      alt: 'A street of shops hung with red paper lanterns, with motorbikes passing in front',
      sample: true,
      credit: { by: 'Ken Marshall', license: BY2, url: commons('Hai Thuong Lan Ong Blvd, Cholon, HCMC (1).jpg') },
    },
    answer: { lat: 10.750935, lon: 106.656353, within: 300, place: 'Hải Thượng Lãn Ông, Chợ Lớn', show: 'point' },
    clues: [
      { x: 0.7, y: 0.5, label: 'Red lanterns, shop after shop, all competing for the same buyers' },
      { x: 0.69, y: 0.2, label: 'The sign above sells wedding cards, so this is a street of paper goods' },
      { x: 0.09, y: 0.2, label: 'Lanterns strung up the buildings, the way Chợ Lớn dresses for a festival' },
    ],
    reveal: 'Why would anyone open a lantern shop right next to another lantern shop? I see the answer in every street I walk down, and you can find it yourself.',
    moment: 'street',
    street: {
      intro: 'You and a rival sell the same lanterns on one street. Customers walk to whichever stall is closer. Drag your stall and try to win more than half the street.',
      hint: 'Your rival moved in beside you and took the bigger side of the street.',
      settled: 'Now neither of you can do better by moving. Step away from the middle and your rival takes the extra customers. So two shops selling the same thing end up side by side, and nobody planned it. Economists call this Hotelling\'s law. I see it on every street here.',
    },
  },
];

export const END = {
  title: 'Now you know where to find me.',
  lede: 'Four photographs, one neighbourhood. This is where I come from, and these are the ways I look at it.',
  rounds: [
    'Round one was home, a street that speaks Cantonese on my way to school.',
    'Round two was how I see a junction, as a problem with a best answer.',
    'Round three was chess, which I play at 2000+ Elo.',
    'Round four was how I see a street, as people quietly playing a game with each other.',
  ],
  contact: 'I am applying to universities for Fall 2027. If you would like to talk, I would love to hear from you.',
};

/* names on the pin map, placed by latitude and longitude */
export const LABELS = [
  ['District 1', 10.776, 106.7], ['District 3', 10.784, 106.682], ['District 4', 10.757, 106.704],
  ['District 5', 10.755, 106.668], ['District 6', 10.747, 106.645], ['District 7', 10.733, 106.722],
  ['District 8', 10.737, 106.665], ['District 10', 10.773, 106.667], ['District 11', 10.764, 106.647],
  ['Phú Nhuận', 10.8, 106.678], ['Bình Thạnh', 10.806, 106.697], ['Tân Bình', 10.803, 106.652],
  ['Thủ Thiêm', 10.777, 106.722], ['Thảo Điền', 10.804, 106.734], ['Gò Vấp', 10.838, 106.668],
];
