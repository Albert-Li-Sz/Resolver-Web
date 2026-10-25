/**
 * Deterministic demo data for the ICPC Resolver reimplementation.
 *
 * The output of createDemo() is ready to feed straight into buildGame():
 * a parsed contest object (with `submissions`), resolver options, and a name.
 *
 * Scenario: 2024 ICPC World Finals-like contest, 18 teams from 9 universities
 * (two teams per organization), 13 problems, one hour scoreboard freeze.
 * Twenty submissions arrive after the freeze, and problem M is solved for the
 * first time after the freeze - the resolver demonstrates both "yes" and "no"
 * resolutions plus a first-to-solve highlight.
 *
 * Everything is generated from a fixed seed: no Math.random(), no clock, no
 * network. `createDemo().contest` is byte-for-byte identical on every run.
 */

import { computeCells, DEFAULT_OPTIONS } from './engine.js';

const DURATION_MS = 5 * 60 * 60 * 1000; // 5 hours
const FREEZE_MS = 60 * 60 * 1000; // final hour is frozen
const FREEZE_START_MS = DURATION_MS - FREEZE_MS; // 4:00:00

const PROBLEMS = [
  { label: 'A', name: 'Ad Astra', rgb: '#F4C542' },
  { label: 'B', name: 'Bits and Pieces', rgb: '#4A90D9' },
  { label: 'C', name: 'Cryptic Clues', rgb: '#8E6BBE' },
  { label: 'D', name: 'Delta Debugging', rgb: '#38A169' },
  { label: 'E', name: 'Endless Elevator', rgb: '#DD6B20' },
  { label: 'F', name: 'Folded Flags', rgb: '#C53030' },
  { label: 'G', name: 'Graph Gossip', rgb: '#319795' },
  { label: 'H', name: 'Hidden Harmonies', rgb: '#2D3748' },
  { label: 'I', name: 'Inkblot Images', rgb: '#D69E2E' },
  { label: 'J', name: 'Jumping Jacks', rgb: '#718096' },
  { label: 'K', name: 'Kite Strings', rgb: '#3182CE' },
  { label: 'L', name: 'Labyrinth Locks', rgb: '#2F855A' },
  { label: 'M', name: 'Midnight Meteors', rgb: '#805AD5' },
];

const ORGANIZATIONS = [
  {
    id: 'org-mit',
    name: 'Massachusetts Institute of Technology',
    formalName: 'Massachusetts Institute of Technology',
    country: 'USA',
    initials: 'MIT',
    color: '#A31F34',
  },
  {
    id: 'org-pku',
    name: 'Peking University',
    formalName: 'Peking University',
    country: 'CHN',
    initials: 'PKU',
    color: '#8C1D18',
  },
  {
    id: 'org-msu',
    name: 'Moscow State University',
    formalName: 'Lomonosov Moscow State University',
    country: 'RUS',
    initials: 'MSU',
    color: '#1F4E9C',
  },
  {
    id: 'org-utokyo',
    name: 'University of Tokyo',
    formalName: 'The University of Tokyo',
    country: 'JPN',
    initials: 'UT',
    color: '#003F8E',
  },
  {
    id: 'org-uw',
    name: 'University of Warsaw',
    formalName: 'University of Warsaw',
    country: 'POL',
    initials: 'UW',
    color: '#0B3D91',
  },
  {
    id: 'org-kaist',
    name: 'KAIST',
    formalName: 'Korea Advanced Institute of Science and Technology',
    country: 'KOR',
    initials: 'KAIST',
    color: '#004C97',
  },
  {
    id: 'org-eth',
    name: 'ETH Zürich',
    formalName: 'ETH Zürich',
    country: 'SUI',
    initials: 'ETH',
    color: '#1F407A',
  },
  {
    id: 'org-oxford',
    name: 'University of Oxford',
    formalName: 'University of Oxford',
    country: 'GBR',
    initials: 'OXF',
    color: '#002147',
  },
  {
    id: 'org-iitd',
    name: 'IIT Delhi',
    formalName: 'Indian Institute of Technology Delhi',
    country: 'IND',
    initials: 'IITD',
    color: '#7A1F1F',
  },
];

const TEAMS = [
  { org: 0, displayName: 'MIT Blue', initials: 'MITB', strength: 0.98, accent: '#F2C94C' },
  { org: 1, displayName: 'Peking University Red', initials: 'PKUR', strength: 0.96, accent: '#FFD166' },
  { org: 2, displayName: 'Moscow State University', initials: 'MSU', strength: 0.94, accent: '#E0C068' },
  { org: 3, displayName: 'University of Tokyo', initials: 'UT', strength: 0.91, accent: '#F4A261' },
  { org: 4, displayName: 'University of Warsaw', initials: 'UW', strength: 0.89, accent: '#E9C46A' },
  { org: 5, displayName: 'KAIST', initials: 'KAIST', strength: 0.87, accent: '#D4AF37' },
  { org: 6, displayName: 'ETH Zürich', initials: 'ETH', strength: 0.85, accent: '#C9B037' },
  { org: 7, displayName: 'University of Oxford', initials: 'OXF', strength: 0.82, accent: '#B8A04A' },
  { org: 8, displayName: 'IIT Delhi', initials: 'IITD', strength: 0.79, accent: '#E8B923' },
  { org: 0, displayName: 'MIT Red', initials: 'MITR', strength: 0.73, accent: '#FF8C69' },
  { org: 1, displayName: 'Peking University Gold', initials: 'PKUG', strength: 0.71, accent: '#FFB703' },
  { org: 2, displayName: 'MSU Bears', initials: 'MSUB', strength: 0.69, accent: '#F77F00' },
  { org: 3, displayName: 'UTokyo Kitsune', initials: 'UTK', strength: 0.67, accent: '#FCBF49' },
  { org: 4, displayName: 'Warsaw Wolves', initials: 'UWW', strength: 0.65, accent: '#E5A100' },
  { org: 5, displayName: 'KAIST Tigers', initials: 'KAIT', strength: 0.63, accent: '#D9A400' },
  { org: 6, displayName: 'ETH Parrots', initials: 'ETHP', strength: 0.61, accent: '#C99700' },
  { org: 7, displayName: 'Oxford Turtles', initials: 'OXFT', strength: 0.59, accent: '#B8860B' },
  { org: 8, displayName: 'IIT Delhi Falcons', initials: 'IITF', strength: 0.57, accent: '#A67C00' },
];

// Post-freeze plan. Only these submissions are hidden behind the freeze, so
// pendingCount (frozen) is exactly 20. `solves` picks hardest unsolved problems,
// `fails` adds judged "no" outcomes.
const POST_FREEZE_PLAN = [
  { team: 0, solves: 3, fails: 1, firstToSolve: true }, // MIT Blue, includes problem M
  { team: 1, solves: 2, fails: 1 },
  { team: 2, solves: 2, fails: 1 },
  { team: 3, solves: 1, fails: 1 },
  { team: 4, solves: 2, fails: 0 },
  { team: 5, solves: 1, fails: 0 },
  { team: 6, solves: 1, fails: 0 },
  { team: 7, solves: 1, fails: 0 },
  { team: 8, solves: 1, fails: 0 },
  { team: 9, solves: 0, fails: 1 },
  { team: 12, solves: 0, fails: 1 },
];

const FIRST_TO_SOLVE_PROBLEM = 12; // problem M is reserved for a post-freeze FTS

// ---------------------------------------------------------------------------
// Deterministic helpers
// ---------------------------------------------------------------------------

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function escapeXml(text) {
  return String(text).replace(/[<>&'"]/g, (ch) => {
    switch (ch) {
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '&':
        return '&amp;';
      case "'":
        return '&apos;';
      default:
        return '&quot;';
    }
  });
}

/**
 * 160x160 inline-SVG shield/emblem with initials.
 * Teams get their organization colour with a per-team accent.
 */
function shieldDataUri(initials, color, accent) {
  const text = escapeXml(initials);
  const fontSize = text.length >= 5 ? 27 : text.length === 4 ? 32 : 40;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">` +
    `<path d="M80 6 148 30v52c0 36-30 62-68 72-38-10-68-36-68-72V30Z" fill="${color}" stroke="${accent}" stroke-width="6"/>` +
    `<path d="M80 24 132 43v39c0 27-22 47-52 56-30-9-52-29-52-56V43Z" fill="#ffffff" opacity="0.13"/>` +
    `<path d="M80 118 40 102v-20l40 16 40-16v20Z" fill="${accent}" opacity="0.85"/>` +
    `<text x="80" y="${text.length >= 5 ? 88 : 92}" text-anchor="middle" ` +
    `font-family="Helvetica,Arial,sans-serif" font-size="${fontSize}" font-weight="bold" fill="#ffffff">${text}</text>` +
    `</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function buildContest() {
  const rng = mulberry32(20241019);

  const organizations = ORGANIZATIONS.map((org) => ({
    id: org.id,
    name: org.name,
    formalName: org.formalName,
    country: org.country,
    logo: shieldDataUri(org.initials, org.color, '#FFFFFF'),
  }));

  const teams = TEAMS.map((team, index) => {
    const org = ORGANIZATIONS[team.org];
    return {
      id: `team-${String(index + 1).padStart(2, '0')}`,
      name: org.name,
      displayName: team.displayName,
      organizationId: org.id,
      organizationName: org.name,
      formalName: org.formalName,
      country: org.country,
      logo: shieldDataUri(team.initials, org.color, team.accent),
      photo: null,
    };
  });

  const problems = PROBLEMS.map((problem, index) => ({
    id: `problem-${problem.label.toLowerCase()}`,
    label: problem.label,
    name: problem.name,
    rgb: problem.rgb,
    ordinal: index,
  }));

  const submissions = [];
  let nextSubmissionId = 1;
  const pushSubmission = (teamIndex, problemIndex, contestTime, status, penalty) => {
    submissions.push({
      id: `submission-${String(nextSubmissionId++).padStart(4, '0')}`,
      teamId: teams[teamIndex].id,
      problemId: problems[problemIndex].id,
      contestTime: Math.max(1000, Math.min(DURATION_MS - 1000, Math.round(contestTime))),
      status,
      penalty: Boolean(penalty),
    });
  };

  // Pre-freeze results ------------------------------------------------------
  const solvedBefore = TEAMS.map(() => new Set());
  const failedBefore = TEAMS.map(() => new Set());
  const preFreezeSolvedCount = new Array(TEAMS.length).fill(0);

  for (let teamIndex = 0; teamIndex < TEAMS.length; teamIndex++) {
    const strength = TEAMS[teamIndex].strength;
    const maxPreFreezeSolved = clamp(Math.round(3 + strength * 6), 3, 9);

    for (let problemIndex = 0; problemIndex < PROBLEMS.length; problemIndex++) {
      // Problem M is reserved for a post-freeze first solve.
      if (problemIndex === FIRST_TO_SOLVE_PROBLEM) continue;

      const difficulty = 0.06 + problemIndex * 0.072;
      const chance = clamp(0.03, 0.95, 0.3 + (strength - 0.5) * 0.9 - (difficulty - 0.4) * 0.55);
      const canSolve = preFreezeSolvedCount[teamIndex] < maxPreFreezeSolved;
      const solved = canSolve && rng() < chance;

      if (solved) {
        const fails = Math.floor(rng() * 3); // 0..2 wrong answers before the accepted one
        const earliest = 12 + (1 - strength) * 150; // stronger teams start earlier
        const span = Math.max(30, 226 - earliest);
        const solveMs = Math.min(
          FREEZE_START_MS - 60_000,
          Math.round((earliest + rng() * span) * 60_000),
        );

        for (let f = fails; f >= 1; f--) {
          const time = Math.max(60_000, solveMs - f * (8 + rng() * 18) * 60_000);
          pushSubmission(teamIndex, problemIndex, time, 'failed', true);
        }
        pushSubmission(teamIndex, problemIndex, solveMs, 'solved', false);
        solvedBefore[teamIndex].add(problemIndex);
        preFreezeSolvedCount[teamIndex] += 1;
      } else if (rng() < 0.5) {
        // Unsolved before freeze: sometimes there are already failed attempts.
        const attempts = 1 + Math.floor(rng() * 2);
        let time = (15 + rng() * 205) * 60_000;
        for (let a = 0; a < attempts; a++) {
          const t = Math.min(FREEZE_START_MS - 120_000, time);
          pushSubmission(teamIndex, problemIndex, t, 'failed', true);
          failedBefore[teamIndex].add(problemIndex);
          time += (6 + rng() * 18) * 60_000;
        }
      }
    }
  }

  // Post-freeze submissions (exactly 20) -----------------------------------
  const postUsed = TEAMS.map(() => new Set());
  const postEvents = [];

  const availableProblems = (teamIndex, excludeFirstToSolve) => {
    const out = [];
    for (let p = 0; p < PROBLEMS.length; p++) {
      if (solvedBefore[teamIndex].has(p)) continue;
      if (postUsed[teamIndex].has(p)) continue;
      if (excludeFirstToSolve && p === FIRST_TO_SOLVE_PROBLEM) continue;
      out.push(p);
    }
    return out;
  };

  for (const plan of POST_FREEZE_PLAN) {
    const teamIndex = plan.team;
    const solvedPicks = [];

    if (plan.firstToSolve) {
      solvedPicks.push(FIRST_TO_SOLVE_PROBLEM);
      postUsed[teamIndex].add(FIRST_TO_SOLVE_PROBLEM);
    }

    for (let i = solvedPicks.length; i < plan.solves; i++) {
      const candidates = availableProblems(teamIndex, teamIndex !== 0).sort((a, b) => b - a);
      if (!candidates.length) break;
      const p = candidates[0];
      solvedPicks.push(p);
      postUsed[teamIndex].add(p);
    }

    for (const problemIndex of solvedPicks) {
      postEvents.push({ teamIndex, problemIndex, status: 'solved', penalty: false });
    }

    let failed = 0;
    while (failed < plan.fails) {
      const candidates = availableProblems(teamIndex, teamIndex !== 0).sort((a, b) => {
        const aFailed = failedBefore[teamIndex].has(a) ? 1 : 0;
        const bFailed = failedBefore[teamIndex].has(b) ? 1 : 0;
        return bFailed - aFailed || b - a;
      });
      if (!candidates.length) break;
      const problemIndex = candidates[0];
      postUsed[teamIndex].add(problemIndex);
      postEvents.push({ teamIndex, problemIndex, status: 'failed', penalty: true });
      failed += 1;
    }
  }

  postEvents.forEach((event, index) => {
    event.contestTime = FREEZE_START_MS + 45_000 + index * 135_000 + (index % 4) * 7_000;
  });
  // The reserved first-to-solve is the last hidden submission of the contest.
  for (const event of postEvents) {
    if (event.teamIndex === 0 && event.problemIndex === FIRST_TO_SOLVE_PROBLEM) {
      event.contestTime = FREEZE_START_MS + 52 * 60_000;
    }
  }

  postEvents.sort((a, b) => a.contestTime - b.contestTime);
  for (const event of postEvents) {
    pushSubmission(event.teamIndex, event.problemIndex, event.contestTime, event.status, event.penalty);
  }

  const contest = {
    name: 'ICPC World Finals 2024',
    formalName: 'ICPC World Finals 2024 — Astana, Kazakhstan',
    startTime: '2024-09-15T09:00:00+05:00',
    durationMs: DURATION_MS,
    freezeDurationMs: FREEZE_MS,
    penaltyMinutes: 20,
    logo: null,
    problems: problems.map(({ ordinal, ...problem }) => problem),
    organizations,
    teams,
    awards: [],
    submissions,
  };

  // Medals + FTS award are derived from the *final* (all judgements) ranking.
  const finalView = computeCells(contest, { frozen: false });
  const top3 = finalView.order.slice(0, 3);
  const ftsTeam =
    finalView.order.find((teamId) => {
      const cell = finalView.results[teamId]?.[FIRST_TO_SOLVE_PROBLEM];
      return cell && cell.status === 'solved' && cell.firstToSolve;
    }) || top3[0];

  contest.awards = [
    {
      id: 'gold-medal',
      citation: 'Gold Medal',
      teamIds: [top3[0]],
      displayMode: 'detail',
      awardType: 'medal',
    },
    {
      id: 'silver-medal',
      citation: 'Silver Medal',
      teamIds: [top3[1]],
      displayMode: 'detail',
      awardType: 'medal',
    },
    {
      id: 'bronze-medal',
      citation: 'Bronze Medal',
      teamIds: [top3[2]],
      displayMode: 'detail',
      awardType: 'medal',
    },
    {
      id: `first-to-solve-${PROBLEMS[FIRST_TO_SOLVE_PROBLEM].label.toLowerCase()}`,
      citation: `First to Solve Problem ${PROBLEMS[FIRST_TO_SOLVE_PROBLEM].label}`,
      teamIds: [ftsTeam],
      displayMode: 'pause',
      awardType: 'first-to-solve',
    },
  ];

  return contest;
}

/**
 * Create the deterministic demo contest.
 * @returns {{contest: object, options: object, name: string}}
 */
export function createDemo() {
  const contest = buildContest();
  return {
    contest,
    options: {
      ...DEFAULT_OPTIONS,
      showAwards: true,
    },
    name: 'ICPC World Finals 2024 (Demo)',
  };
}
