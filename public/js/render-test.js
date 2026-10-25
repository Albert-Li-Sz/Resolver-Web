import { ResolverView } from './render/resolver-view.js';

// ------------------------------------------------------------- mock data
const problems = 'ABCDEFGHIJKLM'.split('').map((label, i) => ({
  id: `p${label.toLowerCase()}`,
  label,
  name: [
    'Ad Astra', 'Bits and Pieces', 'Cryptic Clues', 'Delta Debugging',
    'Endless Elevator', 'Folded Flags', 'Graph Gossip', 'Hidden Harmonies',
    'Inkblot Images', 'Jumping Jacks', 'Kite Strings', 'Labyrinth Locks',
    'Midnight Meteors',
  ][i],
  rgb: ['#f4c542', '#4a90d9', '#8e6bbe', '#38a169', '#dd6b20', '#c53030',
    '#319795', '#2d3748', '#d69e2e', '#718096', '#3182ce', '#2f855a', '#805ad5'][i],
}));

const svg = (body, w = 76, h = 76) =>
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`,
  );

const logos = {
  spb: svg(`
    <g fill="#7fb2ff">
      <circle cx="18" cy="18" r="3"/><circle cx="40" cy="10" r="2.4"/><circle cx="58" cy="18" r="2.8"/>
      <circle cx="30" cy="33" r="2"/><circle cx="50" cy="30" r="2.4"/><circle cx="16" cy="48" r="2.2"/>
      <circle cx="38" cy="48" r="2.6"/><circle cx="60" cy="44" r="2"/><circle cx="28" cy="62" r="2.4"/>
      <circle cx="52" cy="62" r="2.2"/>
      <path d="M18 18 L40 10 L58 18 L50 30 L30 33 Z M16 48 L38 48 L52 62 L28 62 Z"
        fill="none" stroke="#7fb2ff" stroke-width="1.2" opacity=".7"/>
    </g>`),
  msu: svg(`
    <circle cx="38" cy="38" r="30" fill="#f2f2f2" stroke="#9b9b9b" stroke-width="2"/>
    <path d="M26 62 V28 h6 v34z M38 62 V22 h6 v40z M50 62 V30 h6 v32z" fill="#b8b8b8"/>
    <path d="M20 28 Q38 16 56 28" fill="none" stroke="#9a9a9a" stroke-width="3"/>
    <text x="38" y="68" font-family="Georgia" font-size="8" fill="#666" text-anchor="middle">МГУ</text>`),
  thu: svg(`
    <circle cx="38" cy="38" r="30" fill="#6d3a86" stroke="#eee" stroke-width="2"/>
    <circle cx="38" cy="38" r="22" fill="#f4eef8"/>
    <path d="M26 46 h24 M28 42 h20 M30 38 h16 M32 34 h12" stroke="#6d3a86" stroke-width="2"/>
    <text x="38" y="28" font-family="Georgia" font-size="9" fill="#6d3a86" text-anchor="middle">清華</text>`),
  berkeley: svg(`
    <rect width="76" height="76" fill="#153462"/>
    <rect x="0" y="0" width="76" height="18" fill="#f2c500"/>
    <text x="38" y="13" font-family="Georgia" font-size="10" font-weight="bold" fill="#153462" text-anchor="middle">Berkeley</text>
    <path d="M22 58 q10 -16 18 -8 q8 -12 14 2 q-6 12 -16 16 q-10 -2 -16 -10z" fill="#f2c500"/>
    <circle cx="38" cy="44" r="3" fill="#153462"/>`),
  zagreb: svg(`
    <circle cx="38" cy="38" r="30" fill="#f6f6f6" stroke="#999" stroke-width="1.5"/>
    <circle cx="38" cy="38" r="21" fill="none" stroke="#2b4f9e" stroke-width="1.5"/>
    <text x="38" y="40" font-family="Georgia" font-size="8.5" fill="#2b4f9e" text-anchor="middle">UNIV.</text>
    <text x="38" y="50" font-family="Georgia" font-size="6.5" fill="#2b4f9e" text-anchor="middle">ZAGRABIENSIS</text>`),
  charles: svg(`
    <circle cx="38" cy="38" r="30" fill="#f4f4f4" stroke="#999" stroke-width="1.5"/>
    <path d="M38 18 l4 10 11 1 -8 8 2 11 -9 -6 -9 6 2 -11 -8 -8 11 -1z" fill="#242424"/>
    <circle cx="38" cy="38" r="5" fill="#f4f4f4"/>`),
  sjtu: svg(`
    <circle cx="38" cy="38" r="30" fill="#f4f6fa" stroke="#7c8798" stroke-width="1.5"/>
    <path d="M18 48 Q38 18 58 48" fill="none" stroke="#2b4f9e" stroke-width="5"/>
    <path d="M22 44 H54" stroke="#2b4f9e" stroke-width="4"/>
    <text x="38" y="64" font-family="Georgia" font-size="7" fill="#2b4f9e" text-anchor="middle">1896</text>`),
  mit: svg(`
    <rect width="76" height="76" fill="#1d1d1f"/>
    <rect x="12" y="22" width="5" height="34" fill="#a31f34"/><rect x="21" y="22" width="5" height="34" fill="#a31f34"/>
    <rect x="30" y="22" width="5" height="34" fill="#a31f34"/><rect x="39" y="22" width="5" height="34" fill="#a31f34"/>
    <rect x="48" y="22" width="5" height="34" fill="#8a8b8c"/><rect x="57" y="22" width="5" height="34" fill="#8a8b8c"/>
    <rect x="12" y="34" width="50" height="5" fill="#a31f34"/>`),
  tokyo: svg(`
    <circle cx="38" cy="38" r="30" fill="#1f5a9b"/>
    <circle cx="38" cy="30" r="15" fill="#f2c500"/>
    <path d="M38 45 q-10 0 -14 12 q14 6 28 0 q-4 -12 -14 -12z" fill="#f2c500"/>
    <circle cx="32" cy="27" r="2.2" fill="#1f5a9b"/><circle cx="44" cy="27" r="2.2" fill="#1f5a9b"/>`),
  pku: svg(`
    <circle cx="38" cy="38" r="30" fill="#9c1d24"/>
    <circle cx="38" cy="38" r="23" fill="#f4e9e9"/>
    <text x="38" y="34" font-family="Georgia" font-size="10" fill="#9c1d24" text-anchor="middle">北京</text>
    <text x="38" y="47" font-family="Georgia" font-size="10" fill="#9c1d24" text-anchor="middle">大学</text>`),
  korea: svg(`
    <path d="M14 12 h48 v32 q0 18 -24 24 q-24 -6 -24 -24z" fill="#f7f7f7" stroke="#a32638" stroke-width="3"/>
    <circle cx="38" cy="36" r="13" fill="#a32638"/>
    <path d="M32 30 h12 v12 h-12z" fill="#f7f7f7" opacity=".35"/>
    <text x="38" y="61" font-family="Georgia" font-size="7" fill="#a32638" text-anchor="middle">KOREA</text>`),
  warsaw: svg(`
    <rect width="76" height="76" fill="#1b1b1b"/>
    <path d="M38 10 l6 12 14 2 -10 10 3 14 -13 -7 -13 7 3 -14 -10 -10 14 -2z" fill="#f4f4f4"/>
    <path d="M30 32 h16 M32 38 h12 M34 44 h8" stroke="#1b1b1b" stroke-width="2"/>
    <text x="38" y="66" font-family="Georgia" font-size="6" fill="#d8d8d8" text-anchor="middle">UW</text>`),
  itmo: svg(`
    <circle cx="38" cy="38" r="30" fill="#eef2f8" stroke="#3b5f9e" stroke-width="2"/>
    <path d="M22 52 V30 l16 -10 16 10 v22z" fill="none" stroke="#3b5f9e" stroke-width="2"/>
    <text x="38" y="45" font-family="Georgia" font-size="9" fill="#3b5f9e" text-anchor="middle">ITMO</text>`),
  snu: svg(`
    <circle cx="38" cy="38" r="30" fill="#0f5c8c"/>
    <path d="M22 50 Q38 20 54 50" fill="none" stroke="#e8eef5" stroke-width="3"/>
    <circle cx="38" cy="34" r="6" fill="#e8eef5"/>
    <text x="38" y="62" font-family="Georgia" font-size="7" fill="#e8eef5" text-anchor="middle">SNU</text>`),
  eth: svg(`
    <rect width="76" height="76" fill="#f4f4f4" stroke="#999"/>
    <rect x="14" y="14" width="48" height="48" fill="#1f4d8f"/>
    <path d="M38 22 v32 M22 38 h32" stroke="#fff" stroke-width="5"/>
    <text x="38" y="70" font-family="Georgia" font-size="6" fill="#333" text-anchor="middle">ETH</text>`),
  oxford: svg(`
    <path d="M14 12 h48 v32 q0 18 -24 24 q-24 -6 -24 -24z" fill="#123a6b"/>
    <path d="M30 26 h16 v8 q0 12 -8 16 q-8 -4 -8 -16z" fill="#f4f4f4"/>
    <text x="38" y="60" font-family="Georgia" font-size="7" fill="#f4f4f4" text-anchor="middle">OXON</text>`),
};

const makeTeam = (id, name, orgId, logoKey, country) => ({
  id,
  name,
  displayName: name,
  organizationId: orgId,
  organizationName: name,
  formalName: name,
  country,
  logo: logos[logoKey],
  photo: null,
});

const teamSpecs = [
  ['t1', 'St. Petersburg National Research University of IT, Mechanics and Optics', 'org-spb', 'spb', 'RUS'],
  ['t2', 'Moscow State University', 'org-msu', 'msu', 'RUS'],
  ['t3', 'Tsinghua University', 'org-thu', 'thu', 'CHN'],
  ['t4', 'University of California at Berkeley', 'org-berkeley', 'berkeley', 'USA'],
  ['t5', 'University of Zagreb', 'org-zagreb', 'zagreb', 'HRV'],
  ['t6', 'Charles University in Prague', 'org-charles', 'charles', 'CZE'],
  ['t7', 'Shanghai Jiao Tong University', 'org-sjtu', 'sjtu', 'CHN'],
  ['t8', 'Massachusetts Institute of Technology', 'org-mit', 'mit', 'USA'],
  ['t9', 'The University of Tokyo', 'org-tokyo', 'tokyo', 'JPN'],
  ['t10', 'Peking University', 'org-pku', 'pku', 'CHN'],
  ['t11', 'Korea University', 'org-korea', 'korea', 'KOR'],
  ['t12', 'University of Warsaw', 'org-warsaw', 'warsaw', 'POL'],
  ['t13', 'ITMO University', 'org-itmo', 'itmo', 'RUS'],
  ['t14', 'Seoul National University', 'org-snu', 'snu', 'KOR'],
  ['t15', 'ETH Z\u00fcrich', 'org-eth', 'eth', 'SUI'],
  ['t16', 'University of Oxford', 'org-oxford', 'oxford', 'GBR'],
];
const teams = teamSpecs.map(([id, name, organizationId, key, country]) =>
  makeTeam(id, name, organizationId, key, country),
);
const organizations = teamSpecs.map(([, name, organizationId, key, country]) => ({
  id: organizationId,
  name,
  formalName: name,
  country,
  logo: logos[key],
}));

const S = (attempts, time, firstToSolve = false) => ({
  status: 'solved', attempts, time, pending: 0, firstToSolve,
});
const P = (attempts, time) => ({ status: 'pending', attempts, time, pending: 1, firstToSolve: false });
const F = (attempts, time) => ({ status: 'failed', attempts, time, pending: 0, firstToSolve: false });
const E = () => ({ status: 'unattempted', attempts: 0, time: null, pending: 0, firstToSolve: false });

const results = {
  t1: [S(1, 8), P(1, 266), S(2, 60), S(1, 36), S(1, 192), S(1, 66), P(1, 249), S(1, 134), S(1, 78), S(1, 71), P(1, 285), S(1, 152), S(2, 164)],
  t2: [S(1, 21), S(1, 175, true), S(1, 39), S(1, 57), S(1, 208), S(1, 71), P(1, 299), S(1, 118, true), S(2, 78), S(1, 107), E(), S(1, 136), P(1, 263)],
  t3: [S(1, 6), F(2, 282), S(2, 29, true), S(1, 93), S(1, 277), S(2, 78), P(2, 297), S(1, 168), S(1, 58), S(2, 134), E(), S(1, 107), S(2, 224)],
  t4: [S(1, 10), E(), S(2, 70), S(1, 68), S(1, 171), S(2, 78), E(), S(1, 191), S(1, 106), S(1, 140), E(), S(1, 153), S(3, 280)],
  t5: [S(1, 8), S(2, 299), S(1, 55), S(1, 84), S(1, 115, true), S(2, 33), E(), E(), S(1, 233), S(1, 164), E(), S(1, 137), S(4, 273)],
  t6: [S(1, 13), E(), S(1, 168), S(1, 73), S(1, 160), S(1, 106), E(), S(1, 292), S(1, 209), S(1, 52), E(), S(1, 250), S(2, 224)],
  t7: [S(1, 9), S(3, 272), S(1, 85), S(1, 107), F(1, 297), S(1, 49), E(), S(1, 244), S(1, 153), S(1, 167), E(), S(1, 116), S(5, 294)],
  t8: [S(1, 16), E(), S(1, 55), S(1, 117), S(1, 187), S(2, 111), E(), S(2, 223), S(2, 53, true), S(2, 252), E(), S(1, 159), S(5, 296)],
  t9: [S(1, 18), P(4, 288), S(1, 58), S(1, 33), S(2, 177), S(1, 70), E(), S(1, 156), S(1, 110), S(1, 47, true), P(1, 248), S(1, 84), P(4, 289)],
  t10: [S(1, 5, true), E(), S(1, 41), S(1, 51), S(1, 237), S(2, 81), E(), S(1, 168), S(1, 130), S(1, 92), E(), S(1, 114), P(3, 271)],
  t11: [S(1, 19), E(), S(1, 57), S(1, 90), F(4, 289), S(1, 98), E(), S(1, 257), S(2, 145), S(1, 66), E(), S(1, 196), S(3, 232)],
  t12: [S(1, 15), E(), S(2, 78), S(1, 115), S(2, 286), S(1, 135), E(), E(), S(1, 170), S(1, 211), E(), S(1, 39, true), S(1, 144, true)],
  t13: [S(1, 24), E(), S(1, 88), S(1, 122), S(1, 205), S(1, 60), E(), S(1, 188), S(1, 99), S(1, 143), E(), S(1, 172), S(2, 241)],
  t14: [S(1, 31), E(), S(1, 77), S(1, 131), S(1, 221), S(2, 95), E(), S(1, 266), S(1, 119), S(1, 64), E(), S(1, 210), S(1, 188)],
  t15: [S(1, 44), E(), S(1, 102), S(1, 149), S(1, 238), S(1, 81), E(), S(2, 244), S(1, 127), S(1, 91), E(), S(1, 181), S(1, 203)],
  t16: [S(1, 52), E(), S(1, 118), S(1, 166), S(1, 251), S(1, 96), E(), S(1, 273), S(1, 138), S(1, 102), E(), S(1, 246), S(1, 219)],
};

const awards = [
  { id: 'gold-1', citation: 'Gold Medal', teamIds: ['t1'], displayMode: 'detail', awardType: 'medal' },
  { id: 'gold-2', citation: 'Gold Medal', teamIds: ['t2'], displayMode: 'detail', awardType: 'medal' },
  { id: 'silver-1', citation: 'Silver Medal', teamIds: ['t3'], displayMode: 'detail', awardType: 'medal' },
  { id: 'bronze-1', citation: 'Bronze Medal', teamIds: ['t4'], displayMode: 'detail', awardType: 'medal' },
  { id: 'champion', citation: 'World Champions', teamIds: ['t1'], displayMode: 'detail', awardType: 'winner' },
  { id: 'medalists', citation: 'Gold Medalists', teamIds: ['t1', 't2'], displayMode: 'list', awardType: 'medal' },
  { id: 'fts-a', citation: 'First to solve problem A', teamIds: ['t10'], displayMode: 'detail', awardType: 'first-to-solve' },
];

const contest = {
  name: 'ICPC World Finals 2018',
  formalName: 'ICPC World Finals 2018',
  startTime: '2018-04-19T09:00:00+01:00',
  durationMs: 5 * 60 * 60 * 1000,
  freezeDurationMs: 60 * 60 * 1000,
  penaltyMinutes: 20,
  logo: null,
  problems,
  organizations,
  teams,
  awards,
};

const order = teams.map((t) => t.id);
const initialState = {
  frozen: true,
  contestTimeMs: 4 * 60 * 60 * 1000,
  order,
  results,
};

const options = {
  rowsPerScreen: 12,
  speedFactor: 1,
  rowOffset: 0,
  singleStepStartRow: null,
  autoplay: true,
  pauseMs: 1100,
  showLegend: false,
  showAwards: true,
  title: null,
  startScreen: 'splash',
};

const steps = [
  { type: 'presentation', screen: 'splash' },
  { type: 'pause' },
  { type: 'presentation', screen: 'scoreboard' },
  { type: 'selectTeam', teamIds: [], selectType: 'NORMAL' },
  { type: 'scroll', row: 0 },
  { type: 'pause' },
  { type: 'selectTeam', teamIds: ['t10'], selectType: 'NORMAL' },
  { type: 'selectSubmission', teamId: 't10', problemIndex: 12 },
  { type: 'pause' },
  {
    type: 'resolve', teamId: 't10', problemIndex: 12, status: 'solved',
    attempts: 4, time: 271, firstToSolve: false, order,
  },
  { type: 'selectTeam', teamIds: [], selectType: 'NORMAL' },
  { type: 'scroll', row: 4 },
  { type: 'selectTeam', teamIds: ['t1'], selectType: 'HIGHLIGHT' },
  { type: 'pause' },
  {
    type: 'award', teamId: 't1', awards: [
      { id: 'champion', citation: 'World Champions', teamIds: ['t1'], displayMode: 'detail', awardType: 'winner' },
      { id: 'gold-1', citation: 'Gold Medal', teamIds: ['t1'], displayMode: 'detail', awardType: 'medal' },
    ],
  },
  { type: 'presentation', screen: 'teamAward' },
  { type: 'pause' },
  { type: 'presentation', screen: 'teamList' },
  { type: 'pause' },
  { type: 'presentation', screen: 'splash' },
];

const game = {
  contest,
  options,
  initialState,
  steps,
  meta: {
    pendingCount: Object.values(results).flat().filter((c) => c.status === 'pending').length,
    totalSubmissions: 0,
    stepCount: steps.length,
    teamCount: teams.length,
    problemCount: problems.length,
  },
};

// --------------------------------------------------------------- controls
const params = new URLSearchParams(location.search);
const present = params.get('present') === '1';
const freezeParam = params.get('freeze');
const frameParam = params.get('frame');
if (present) document.body.classList.add('present');

const canvas = document.getElementById('screen');
const statusEl = document.getElementById('status');
const loadingEl = document.getElementById('loading');
const view = new ResolverView(canvas, game);
window.__view = view;
window.__game = game;

let mode = 'demo';
let demoIndex = -1;
let demoAt = 0;
let stepList = steps;
let fixedNow = freezeParam === '1' ? 600 : null;
let blinking = false;

function setStatus() {
  const s = view.debugState();
  statusEl.textContent =
    `screen  ${s.screen}\n` +
    `order   ${s.order.slice(0, 3).join(', ')}…\n` +
    `scroll  ${s.scrollRow}  select ${s.selectType}\n` +
    `row     ${Math.round(s.layout.rowHeight * 100) / 100}px  cube ${s.layout.cubeW}x${s.layout.cubeH}`;
}

function settle() {
  // Apply the current step sequence instantaneously (no animation) so a
  // screenshot shows a stable frame.
  view.reset(game.initialState);
  view.applyStep({ type: 'presentation', screen: 'scoreboard' }, { instant: true });
  view.applyStep({ type: 'selectTeam', teamIds: [], selectType: 'NORMAL' }, { instant: true });
  view.applyStep({ type: 'scroll', row: 0 }, { instant: true });
}

function referenceFrame() {
  mode = 'reference';
  blinking = true;
  view.reset(game.initialState);
  view.applyStep({ type: 'presentation', screen: 'scoreboard' }, { instant: true });
  view.applyStep({ type: 'selectTeam', teamIds: [], selectType: 'NORMAL' }, { instant: true });
  view.applyStep({ type: 'scroll', row: 0 }, { instant: true });
  view.applyStep({ type: 'selectTeam', teamIds: ['t10'], selectType: 'NORMAL' }, { instant: true });
  view.applyStep({ type: 'selectSubmission', teamId: 't10', problemIndex: 12 }, { instant: true });
  setActive('btn-reference');
  setStatus();
}

function startDemo() {
  mode = 'demo';
  blinking = false;
  view.reset(game.initialState);
  demoIndex = -1;
  demoAt = performance.now();
  setActive('btn-demo');
}

function showScreen(screen) {
  mode = 'static';
  blinking = false;
  view._setScreen(screen, true);
  if (screen === 'teamAward') {
    view._awardTeamId = 't1';
    view._lastAward = {
      teamId: 't1',
      awards: awards.filter((a) => a.teamIds.includes('t1')),
    };
  }
  if (screen === 'teamList') {
    view._teamListAward = awards.find((a) => a.teamIds.length > 1);
    view._teamListState = view._buildTeamListState();
  }
  setActive(null);
  setStatus();
}

function setActive(id) {
  document.querySelectorAll('#toolbar button').forEach((b) => {
    b.classList.toggle('is-active', b.id === id);
  });
}

document.getElementById('btn-reference').addEventListener('click', referenceFrame);
document.getElementById('btn-demo').addEventListener('click', startDemo);
document.getElementById('btn-scroll').addEventListener('click', () => {
  mode = 'static';
  blinking = false;
  view.applyStep({ type: 'scroll', row: 4 }, { instant: false });
  setStatus();
});
document.getElementById('btn-highlight').addEventListener('click', () => {
  mode = 'static';
  blinking = false;
  view.applyStep({ type: 'presentation', screen: 'scoreboard' }, { instant: true });
  view.applyStep({ type: 'scroll', row: 0 }, { instant: true });
  view.applyStep({ type: 'selectTeam', teamIds: ['t10'], selectType: 'HIGHLIGHT' }, { instant: true });
  setStatus();
});
document.getElementById('btn-blink').addEventListener('click', () => {
  mode = 'static';
  blinking = false;
  view._setScreen('scoreboard', true);
  view.applyStep({ type: 'selectTeam', teamIds: ['t10'], selectType: 'NORMAL' }, { instant: true });
  view.applyStep({ type: 'selectSubmission', teamId: 't10', problemIndex: 12 }, { instant: true });
  fixedNow = 600;
  setStatus();
});
for (const btn of document.querySelectorAll('[data-screen]')) {
  btn.addEventListener('click', () => showScreen(btn.dataset.screen));
}

// ---------------------------------------------------------------- runtime
let last = performance.now();
function frame(now) {
  const dt = Math.min(64, Math.max(0, now - last));
  last = now;
  const clock = fixedNow ?? now;
  view.update(fixedNow !== null ? 0 : dt);
  view.render(clock);

  if (mode === 'demo') {
    if (now - demoAt > 1100) {
      demoAt = now;
      demoIndex += 1;
      if (demoIndex >= stepList.length) {
        demoIndex = -1;
        view.reset(game.initialState);
      } else {
        const step = stepList[demoIndex];
        if (step.type !== 'pause') view.applyStep(step, { instant: false });
      }
      setStatus();
    }
  }
  if (mode === 'reference' && fixedNow === null) {
    // keep blink deterministic for screenshots: freeze at 600ms
    fixedNow = 600;
  }
  requestAnimationFrame(frame);
}

(async () => {
  await view.ready();
  window.__rendererReady = true;
  const requested = frameParam || (present ? 'reference' : 'reference');
  if (requested === 'splash') showScreen('splash');
  else if (requested === 'scoreboard') {
    mode = 'static';
    view._setScreen('scoreboard', true);
    view.applyStep({ type: 'scroll', row: 0 }, { instant: true });
  } else if (requested === 'award') {
    showScreen('teamAward');
  } else if (requested === 'list') {
    showScreen('teamList');
  } else if (requested === 'demo') {
    startDemo();
  } else {
    referenceFrame();
  }
  loadingEl.classList.add('is-hidden');
  setStatus();
  requestAnimationFrame(frame);
})();

// A deterministic hook for Playwright etc.
window.__applyReferenceFrame = referenceFrame;
window.__freeze = (ms = 600) => {
  fixedNow = ms;
  return ms;
};
