/**
 * Engine tests (node --test tests/engine.test.js).
 *
 * Covers: event-feed parsing, frozen/pending semantics, ICPC LIVE ranking
 * (ties / order), resolve-step order updates, demo data shape, and validation
 * of the complete step sequence and final order.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_OPTIONS,
  DELAY_TIMES,
  buildGame,
  buildSteps,
  computeCells,
  computeStandings,
  delayFor,
  parseContestTime,
  parseDuration,
  parseEventFeed,
  normalizeContest,
} from '../server/lib/engine.js';
import { createDemo } from '../server/lib/demo.js';

test('public results preserve actual penalty counts, including CE and submissions after AC', () => {
  const contest = {
    durationMs: 300 * 60_000, freezeDurationMs: 60 * 60_000,
    teams: [{ id: 't', name: 'Team' }], problems: [{ id: 'a' }],
    submissions: [
      { teamId: 't', problemId: 'a', contestTime: 10 * 60_000, status: 'failed', penalty: false },
      { teamId: 't', problemId: 'a', contestTime: 20 * 60_000, status: 'failed', penalty: true },
      { teamId: 't', problemId: 'a', contestTime: 250 * 60_000, status: 'solved' },
      { teamId: 't', problemId: 'a', contestTime: 260 * 60_000, status: 'failed', penalty: true },
    ],
  };
  const game = buildGame(contest, {});
  const resolve = game.steps.find((step) => step.type === 'resolve');
  assert.equal(game.initialState.results.t[0].penaltyCount, 1);
  assert.equal(resolve.penaltyCount, 1);
  const results = { t: [{ ...resolve }] };
  assert.equal(computeStandings(game.contest, results)[0].time, 270);
});

test('hidden teams and their submissions do not enter the public scoreboard', () => {
  const game = buildGame({
    teams: [{ id: 'visible' }, { id: 'hidden', hidden: true }],
    problems: [{ id: 'a' }],
    submissions: [{ teamId: 'hidden', problemId: 'a', contestTime: 1000, status: 'solved' }],
  }, {});
  assert.deepEqual(game.contest.teams.map((team) => team.id), ['visible']);
  assert.deepEqual(game.initialState.order, ['visible']);
});

// ---------------------------------------------------------------------------
// Fixture: a small contest with a freeze, pending submissions, a tie and both
// "yes" and "no" post-freeze outcomes.
// ---------------------------------------------------------------------------

const ALLOWED_STEP_TYPES = new Set([
  'presentation',
  'pause',
  'delay',
  'selectTeam',
  'selectSubmission',
  'scroll',
  'resolve',
  'award',
  'message',
]);
const SELECT_TYPES = new Set(['NORMAL', 'HIGHLIGHT', 'FTS', 'FTS_HIGHLIGHT', 'TEAM_LIST']);
const SCREENS = new Set(['splash', 'scoreboard', 'teamAward', 'teamList']);

function fixtureEvents() {
  const contest = {
    type: 'contests',
    id: 'evt-contest',
    op: 'create',
    data: {
      id: 'test-cup',
      name: 'Test Cup 2025',
      formal_name: 'Test Cup 2025 — Fixture',
      start_time: '2025-01-01T09:00:00+00',
      duration: '5:00:00.000',
      scoreboard_freeze_duration: '1:00:00.000',
      penalty_time: 20,
    },
  };

  const organizations = [
    {
      type: 'organization',
      id: 'evt-o1',
      op: 'create',
      data: { id: 'o1', name: 'Alpha University', formal_name: 'Alpha University', country: 'AAA', logo: [{ href: 'logos/o1.png', width: 160, height: 160 }] },
    },
    {
      type: 'organizations',
      id: 'evt-o2',
      op: 'create',
      data: { id: 'o2', name: 'Beta Institute', formal_name: 'Beta Institute', country: 'BBB' },
    },
    {
      type: 'organizations',
      id: 'evt-o3',
      op: 'create',
      data: { id: 'o3', name: 'Gamma College', formal_name: 'Gamma College', country: 'CCC' },
    },
  ];

  const teams = [
    {
      type: 'teams',
      id: 'evt-t1',
      op: 'create',
      data: { id: 't1', name: 'Alpha University', display_name: 'Alpha Gold', organization_id: 'o1' },
    },
    {
      type: 'team',
      id: 'evt-t2',
      op: 'create',
      data: { id: 't2', name: 'Alpha University', display_name: 'Alpha Two', organization_id: 'o1' },
    },
    {
      type: 'teams',
      id: 'evt-t3',
      op: 'create',
      data: { id: 't3', name: 'Beta Institute', display_name: 'Beta One', organization_id: 'o2' },
    },
    {
      type: 'teams',
      id: 'evt-t4',
      op: 'create',
      data: { id: 't4', name: 'Gamma College', display_name: 'Gamma', organization_id: 'o3' },
    },
    {
      type: 'teams',
      id: 'evt-t5',
      op: 'create',
      data: { id: 't5', name: 'Gamma College', display_name: 'Deleted Team', organization_id: 'o3' },
    },
  ];

  const updateTeam = {
    type: 'team',
    id: 'evt-t2',
    op: 'update',
    data: { id: 't2', display_name: 'Alpha Blue' },
  };
  const deleteTeam = { type: 'teams', id: 'evt-t5', op: 'delete', data: { id: 't5' } };

  // Deliberately out of order: the engine must sort by `ordinal`.
  const problems = [
    {
      type: 'problem',
      id: 'evt-pc',
      op: 'create',
      data: { id: 'pC', label: 'C', name: 'Cascades', ordinal: 2, rgb: '#00cc00' },
    },
    {
      type: 'problems',
      id: 'evt-pa',
      op: 'create',
      data: { id: 'pA', label: 'A', name: 'Adventures', ordinal: 0, rgb: '#cc0000' },
    },
    {
      type: 'problems',
      id: 'evt-pb',
      op: 'create',
      data: { id: 'pB', label: 'B', name: 'Bridges', ordinal: 1 },
    },
  ];

  const judgementTypes = [
    {
      type: 'judgement-types',
      id: 'evt-jt-ac',
      op: 'create',
      data: { id: 'AC', name: 'correct', solved: true, penalty: false },
    },
    {
      type: 'judgement-type',
      id: 'evt-jt-wa',
      op: 'create',
      data: { id: 'WA', name: 'wrong answer', solved: false, penalty: true },
    },
    {
      type: 'judgement-type',
      id: 'evt-jt-ce',
      op: 'create',
      data: { id: 'CE', name: 'compilation error', solved: false, penalty: false },
    },
  ];

  const submissions = [
    ['s1', 't1', 'pA', '0:10:00.000'],
    ['s2', 't1', 'pB', '0:20:00.000'],
    ['s3', 't1', 'pB', '0:30:00.000'],
    ['s4', 't2', 'pA', '0:15:00.000'],
    ['s5', 't2', 'pA', '0:25:00.000'],
    ['s6', 't3', 'pA', '0:05:00.000'],
    ['s7', 't4', 'pA', '4:10:00.000'],
    ['s8', 't2', 'pB', '4:20:00.000'],
    ['s9', 't1', 'pC', '4:30:00.000'],
  ].map(([id, teamId, problemId, contestTime], i) => ({
    type: i % 2 === 0 ? 'submissions' : 'submission',
    id: `evt-${id}`,
    op: 'create',
    data: { id, team_id: teamId, problem_id: problemId, contest_time: contestTime },
  }));

  const judgements = [
    ['j1', 's1', 'AC'],
    ['j2', 's2', 'WA'],
    ['j3', 's3', 'AC'],
    ['j4', 's4', 'WA'],
    ['j5', 's5', 'AC'],
    ['j6', 's6', 'CE'],
    ['j7', 's7', 'AC'],
    ['j8', 's8', 'WA'],
    ['j9', 's9', 'AC'],
  ].map(([id, submissionId, typeId]) => ({
    type: 'judgements',
    id: `evt-${id}`,
    op: 'create',
    data: { id, submission_id: submissionId, judgement_type_id: typeId },
  }));

  return [contest, ...organizations, ...teams, updateTeam, deleteTeam, ...problems, ...judgementTypes, ...submissions, ...judgements];
}

function fixtureJsonl() {
  return fixtureEvents()
    .map((event) => JSON.stringify(event))
    .join('\n');
}

function fixtureArray() {
  return JSON.stringify(fixtureEvents());
}

function fixtureContest() {
  return parseEventFeed(fixtureJsonl());
}

/** Strip the engine's internal ranking fields so results compare like the contract. */
function publicCells(results) {
  const out = {};
  for (const [teamId, cells] of Object.entries(results)) {
    out[teamId] = cells.map(({ status, attempts, time, pending, firstToSolve, _penaltyCount }) => ({
      status,
      attempts,
      time,
      pending,
      firstToSolve,
      penaltyCount: _penaltyCount || 0,
    }));
  }
  return out;
}

function teamName(contest, teamId) {
  return contest.teams.find((team) => team.id === teamId)?.displayName;
}

function orderedNames(contest, order) {
  return order.map((teamId) => teamName(contest, teamId));
}

/** Apply only the `resolve` steps to a copy of the initial client state. */
function simulateResolves(game) {
  const results = structuredClone(game.initialState.results);
  let order = game.initialState.order.slice();
  for (const step of game.steps) {
    if (step.type !== 'resolve') continue;
    const cells = results[step.teamId];
    assert.ok(cells, `resolve step references unknown team ${step.teamId}`);
    const cell = cells[step.problemIndex];
    assert.ok(cell, `resolve step references invalid problem ${step.problemIndex}`);
    cells[step.problemIndex] = {
      ...cell,
      status: step.status,
      attempts: step.attempts,
      penaltyCount: step.penaltyCount,
      time: step.time,
      pending: 0,
      firstToSolve: step.firstToSolve,
    };
    if (step.order) order = step.order.slice();
    else { order.splice(step.move.from, 1); order.splice(step.move.to, 0, step.teamId); }
  }
  return { results, order };
}

// ---------------------------------------------------------------------------
// Feed parsing
// ---------------------------------------------------------------------------

test('parseDuration / parseContestTime', () => {
  assert.equal(parseDuration('5:00:00.000'), 5 * 60 * 60 * 1000);
  assert.equal(parseDuration('1:00:00'), 60 * 60 * 1000);
  assert.equal(parseDuration('0:01:30.500'), 90_500);
  assert.equal(parseDuration('PT1H'), 3_600_000);
  assert.equal(parseDuration(1234), 1234);
  assert.equal(parseContestTime('0:27:00.297'), 27 * 60_000 + 297);
  assert.equal(parseContestTime('4:10:00.000'), 250 * 60_000);
});

test('parseEventFeed parses JSON Lines, plural/singular types, updates and deletes', () => {
  const contest = fixtureContest();

  assert.equal(contest.name, 'Test Cup 2025');
  assert.equal(contest.formalName, 'Test Cup 2025 — Fixture');
  assert.equal(contest.durationMs, 18_000_000);
  assert.equal(contest.freezeDurationMs, 3_600_000);
  assert.equal(contest.penaltyMinutes, 20);
  assert.equal(contest.startTime, '2025-01-01T09:00:00+00');

  // t5 was deleted and the t2 update was applied.
  assert.equal(contest.teams.length, 4);
  assert.ok(!contest.teams.some((team) => team.id === 't5'));
  assert.equal(contest.teams.find((team) => team.id === 't2').displayName, 'Alpha Blue');

  // Relative logos cannot be loaded; unknown schools use the bundled ICPC logo.
  const t1 = contest.teams.find((team) => team.id === 't1');
  assert.equal(t1.organizationName, 'Alpha University');
  assert.equal(t1.formalName, 'Alpha University');
  assert.equal(t1.country, 'AAA');
  assert.equal(t1.logo, '/assets/img/icpc-logo.png');

  // Problems sorted by ordinal, not feed order.
  assert.deepEqual(
    contest.problems.map((problem) => problem.label),
    ['A', 'B', 'C'],
  );
  assert.deepEqual(
    contest.problems.map((problem) => problem.rgb),
    ['#cc0000', null, '#00cc00'],
  );

  // Judgements folded into submissions (status/penalty).
  assert.equal(contest.submissions.length, 9);
  const byId = new Map(contest.submissions.map((submission) => [submission.id, submission]));
  assert.equal(byId.get('s1').status, 'solved');
  assert.equal(byId.get('s2').status, 'failed');
  assert.equal(byId.get('s2').penalty, true);
  assert.equal(byId.get('s6').status, 'failed');
  assert.equal(byId.get('s6').penalty, false);
  assert.equal(byId.get('s7').contestTime, 250 * 60_000);
});

test('parseEventFeed accepts a JSON array and produces the same contest', () => {
  const fromLines = fixtureContest();
  const fromArray = parseEventFeed(fixtureArray());
  assert.deepEqual(fromArray, fromLines);
});

test('penalty_time accepts minutes and CCS duration strings', () => {
  const feed = (penalty) =>
    JSON.stringify([
      {
        type: 'contests',
        id: 'c',
        op: 'create',
        data: { id: 'c', name: 'C', duration: '5:00:00.000', penalty_time: penalty },
      },
      { type: 'teams', id: 't', op: 'create', data: { id: 't', name: 'T', display_name: 'T' } },
      { type: 'problems', id: 'p', op: 'create', data: { id: 'p', label: 'A' } },
    ]);
  assert.equal(parseEventFeed(feed(20)).penaltyMinutes, 20);
  assert.equal(parseEventFeed(feed('25')).penaltyMinutes, 25);
  assert.equal(parseEventFeed(feed('0:30:00')).penaltyMinutes, 30);
  assert.equal(parseEventFeed(feed('PT45M')).penaltyMinutes, 45);
});

test('parseEventFeed rejects invalid input with HTTP 400 metadata', () => {
  const expectBad = (fn, pattern) => {
    assert.throws(fn, (err) => {
      assert.match(err.message, pattern);
      assert.equal(err.status, 400);
      assert.equal(err.expose, true);
      return true;
    });
  };
  expectBad(() => parseEventFeed(''), /empty/i);
  expectBad(() => parseEventFeed('not json at all'), /Invalid event feed/i);
  expectBad(() => parseEventFeed('[{"type":"contests"'), /Invalid event feed/i);
  expectBad(() => parseEventFeed(JSON.stringify([{ type: 'unknown', data: {} }])), /Invalid event feed/i);
  expectBad(() => parseEventFeed({}), /expects a string/i);
});

// ---------------------------------------------------------------------------
// Frozen / pending / final results
// ---------------------------------------------------------------------------

test('frozen cells hide post-freeze judgements, final cells reveal them', () => {
  const contest = fixtureContest();
  const frozen = computeCells(contest, { frozen: true });
  const final = computeCells(contest, { frozen: false });
  const [t1, t2, t3, t4] = ['t1', 't2', 't3', 't4'];

  // t1: solved A and B before the freeze, C pending after it.
  assert.equal(frozen.results[t1][0].status, 'solved');
  assert.equal(frozen.results[t1][0].time, 10);
  assert.equal(frozen.results[t1][0].firstToSolve, true);
  assert.equal(frozen.results[t1][1].status, 'solved');
  assert.equal(frozen.results[t1][1].attempts, 2);
  assert.equal(frozen.results[t1][1].time, 30);
  assert.equal(frozen.results[t1][2].status, 'pending');
  assert.equal(frozen.results[t1][2].attempts, 1);
  assert.equal(frozen.results[t1][2].time, 270);
  assert.equal(frozen.results[t1][2].pending, 1);
  assert.equal(frozen.results[t1][2].firstToSolve, false, 'post-freeze solve is not visible while frozen');

  // t2: A solved, B pending; t3 has a judged non-penalty failure.
  assert.equal(frozen.results[t2][0].status, 'solved');
  assert.equal(frozen.results[t2][0].attempts, 2);
  assert.equal(frozen.results[t2][0].time, 25);
  assert.equal(frozen.results[t2][1].status, 'pending');
  assert.equal(frozen.results[t2][1].pending, 1);
  assert.equal(frozen.results[t3][0].status, 'failed');
  assert.equal(frozen.results[t3][0].time, 5);
  assert.equal(frozen.results[t4][0].status, 'pending');
  assert.equal(frozen.results[t4][0].attempts, 1);
  assert.equal(frozen.results[t4][0].time, 250);

  // Final view: post-freeze judgements applied.
  assert.equal(final.results[t1][2].status, 'solved');
  assert.equal(final.results[t1][2].time, 270);
  assert.equal(final.results[t1][2].firstToSolve, true, 'problem C is first solved after the freeze');
  assert.equal(final.results[t2][1].status, 'failed');
  assert.equal(final.results[t2][1].time, 260);
  assert.equal(final.results[t4][0].status, 'solved');
  assert.equal(final.results[t4][0].time, 250);
  assert.equal(frozen.pendingCount, 3);
  assert.equal(final.pendingCount, 0);

  // Frozen standings: solved desc, then penalty time.
  assert.deepEqual(orderedNames(contest, frozen.order), ['Alpha Gold', 'Alpha Blue', 'Beta One', 'Gamma']);
  // Final order: t4 (solved after freeze) overtakes t3.
  assert.deepEqual(orderedNames(contest, final.order), ['Alpha Gold', 'Alpha Blue', 'Gamma', 'Beta One']);

  // Frozen scoreboard time is freeze start (4:00:00).
  assert.equal(frozen.freezeTimeMs, 4 * 60 * 60 * 1000);
});

test('ranking is solved desc, time asc, lastSolution asc, displayName localeCompare', () => {
  const contest = {
    name: 'Ranking Test',
    durationMs: 5 * 60 * 60 * 1000,
    freezeDurationMs: 0,
    penaltyMinutes: 20,
    problems: [
      { id: 'pA', label: 'A' },
      { id: 'pB', label: 'B' },
    ],
    teams: [
      { id: 'alpha', name: 'Alpha', displayName: 'Alpha' },
      { id: 'bravo', name: 'Bravo', displayName: 'Bravo' },
      { id: 'charlie', name: 'Charlie', displayName: 'Charlie' },
      { id: 'delta', name: 'Delta', displayName: 'Delta' },
      { id: 'echo', name: 'Echo', displayName: 'Echo' },
    ],
    submissions: [
      // alpha and bravo tie on solved/time/lastSolution -> shared rank.
      { teamId: 'alpha', problemId: 'pA', contestTime: 10 * 60_000, status: 'solved' },
      { teamId: 'alpha', problemId: 'pB', contestTime: 20 * 60_000, status: 'solved' },
      { teamId: 'bravo', problemId: 'pA', contestTime: 10 * 60_000, status: 'solved' },
      { teamId: 'bravo', problemId: 'pB', contestTime: 20 * 60_000, status: 'solved' },
      // Same solved count/time as the leaders, but the last solve is later.
      { teamId: 'charlie', problemId: 'pA', contestTime: 5 * 60_000, status: 'solved' },
      { teamId: 'charlie', problemId: 'pB', contestTime: 25 * 60_000, status: 'solved' },
      // One solve + a 20 minute penalty -> time 35.
      { teamId: 'delta', problemId: 'pA', contestTime: 15 * 60_000, status: 'solved' },
      { teamId: 'delta', problemId: 'pA', contestTime: 10 * 60_000, status: 'failed', penalty: true },
      // echo has no submissions.
    ],
  };

  const view = computeCells(contest, { frozen: false });
  assert.deepEqual(view.order, ['alpha', 'bravo', 'charlie', 'delta', 'echo']);

  const standings = computeStandings(contest, view.results);
  const byId = new Map(standings.map((record) => [record.teamId, record]));
  assert.equal(byId.get('alpha').solved, 2);
  assert.equal(byId.get('alpha').time, 30);
  assert.equal(byId.get('alpha').lastSolutionTime, 20);
  assert.equal(byId.get('delta').time, 35, 'solved time + 20 minute penalty');
  assert.equal(byId.get('delta').lastSolutionTime, 15);
  // Ties: alpha/bravo share rank 1, charlie is rank 3.
  assert.equal(byId.get('alpha').rank, 1);
  assert.equal(byId.get('bravo').rank, 1);
  assert.equal(byId.get('charlie').rank, 3);
  assert.equal(byId.get('delta').rank, 4);
  assert.equal(byId.get('echo').rank, 5);
});

test('first-to-solve is blocked by an earlier unjudged submission', () => {
  const contest = {
    name: 'FTS Blocking',
    durationMs: 5 * 60 * 60 * 1000,
    freezeDurationMs: 0,
    penaltyMinutes: 20,
    problems: [
      { id: 'pA', label: 'A' },
      { id: 'pB', label: 'B' },
    ],
    teams: [
      { id: 't1', name: 'One', displayName: 'One' },
      { id: 't2', name: 'Two', displayName: 'Two' },
    ],
    submissions: [
      // Problem A: an earlier unjudged submission blocks the later solve.
      { teamId: 't1', problemId: 'pA', contestTime: 5 * 60_000, status: 'pending' },
      { teamId: 't2', problemId: 'pA', contestTime: 10 * 60_000, status: 'solved' },
      // Problem B: the earlier submission is a judged failure, which does not block.
      { teamId: 't1', problemId: 'pB', contestTime: 15 * 60_000, status: 'failed', penalty: true },
      { teamId: 't2', problemId: 'pB', contestTime: 20 * 60_000, status: 'solved' },
    ],
  };

  const view = computeCells(contest, { frozen: false });
  assert.equal(view.results.t2[0].status, 'solved');
  assert.equal(view.results.t2[0].firstToSolve, false, 'blocked by t1 pending submission');
  assert.equal(view.results.t2[1].firstToSolve, true, 'judged failures do not block FTS');
});

// ---------------------------------------------------------------------------
// Game / steps
// ---------------------------------------------------------------------------

test('buildGame emits a valid step sequence and resolve steps update order', () => {
  const contest = fixtureContest();
  const game = buildGame(contest, {}, { id: 'fixture-game' });

  assert.equal(game.id, 'fixture-game');
  assert.equal(game.initialState.frozen, true);
  assert.equal(game.initialState.contestTimeMs, 4 * 60 * 60 * 1000);
  assert.deepEqual(orderedNames(contest, game.initialState.order), ['Alpha Gold', 'Alpha Blue', 'Beta One', 'Gamma']);
  assert.equal(game.meta.teamCount, 4);
  assert.equal(game.meta.problemCount, 3);
  assert.equal(game.meta.pendingCount, 3);
  assert.equal(game.meta.totalSubmissions, 9);
  assert.equal(game.meta.stepCount, game.steps.length);

  // Intro sequence required by the contract.
  assert.deepEqual(game.steps[0], { type: 'presentation', screen: 'splash' });
  assert.equal(game.steps[1].type, 'pause');
  assert.deepEqual(game.steps[2], { type: 'selectTeam', teamIds: [], selectType: 'NORMAL', role: 'setup' });
  assert.deepEqual(game.steps[3], { type: 'scroll', row: 0, role: 'setup' });
  assert.deepEqual(game.steps[4], { type: 'presentation', screen: 'scoreboard' });
  assert.equal(game.steps[5].type, 'pause');

  const resolves = game.steps.filter((step) => step.type === 'resolve');
  assert.equal(resolves.length, 3);
  assert.deepEqual(
    resolves.map((step) => ({ team: teamName(contest, step.teamId), problem: step.problemIndex, status: step.status })),
    [
      { team: 'Gamma', problem: 0, status: 'solved' },
      { team: 'Alpha Blue', problem: 1, status: 'failed' },
      { team: 'Alpha Gold', problem: 2, status: 'solved' },
    ],
  );

  // First resolve moves Gamma from last row to third.
  const firstOrder = game.initialState.order.slice();
  firstOrder.splice(resolves[0].move.from, 1); firstOrder.splice(resolves[0].move.to, 0, resolves[0].teamId);
  assert.deepEqual(orderedNames(contest, firstOrder), ['Alpha Gold', 'Alpha Blue', 'Gamma', 'Beta One']);
  assert.equal(resolves[0].firstToSolve, false, 'problem A was already first solved before the freeze');
  // Last resolve is the post-freeze first solve of problem C.
  assert.equal(resolves[2].firstToSolve, true);
  assert.equal(resolves[2].time, 270);
  assert.equal(resolves[2].attempts, 1);

  // The final resolve order equals the final standings order.
  const final = computeCells(contest, { frozen: false });
  assert.deepEqual(simulateResolves(game).order, final.order);

  // Simulating the resolve steps reproduces the final public results.
  const simulated = simulateResolves(game);
  const expectedCells = publicCells(final.results);
  for (const team of contest.teams) {
    assert.deepEqual(simulated.results[team.id], expectedCells[team.id]);
  }
  assert.deepEqual(simulated.order, final.order);
  assert.deepEqual(
    computeStandings(game.contest, simulated.results).map((record) => record.teamId),
    final.order,
  );
});

test('all game steps are valid and JSON-serialisable', () => {
  const contest = fixtureContest();
  const game = buildGame(contest, {}, {});
  const teamIds = new Set(game.contest.teams.map((team) => team.id));
  const problemCount = game.contest.problems.length;

  for (const step of game.steps) {
    assert.ok(ALLOWED_STEP_TYPES.has(step.type), `unknown step type ${step.type}`);
    switch (step.type) {
      case 'presentation':
        assert.ok(SCREENS.has(step.screen), `unknown presentation screen ${step.screen}`);
        break;
      case 'pause':
        assert.ok(step.label === undefined || typeof step.label === 'string');
        break;
      case 'delay':
        assert.equal(typeof step.ms, 'number');
        assert.ok(step.ms > 0);
        if (step.kind) assert.equal(step.ms, delayFor(step.kind));
        break;
      case 'selectTeam':
        assert.ok(Array.isArray(step.teamIds));
        assert.ok(SELECT_TYPES.has(step.selectType));
        for (const teamId of step.teamIds) assert.ok(teamIds.has(teamId));
        break;
      case 'selectSubmission':
        assert.ok(teamIds.has(step.teamId));
        assert.ok(Number.isInteger(step.problemIndex));
        assert.ok(step.problemIndex >= 0 && step.problemIndex < problemCount);
        break;
      case 'scroll':
        assert.ok(Number.isInteger(step.row));
        assert.ok(step.row >= 0);
        break;
      case 'resolve':
        assert.ok(teamIds.has(step.teamId));
        assert.ok(step.problemIndex >= 0 && step.problemIndex < problemCount);
        assert.ok(step.status === 'solved' || step.status === 'failed');
        assert.ok(Number.isInteger(step.attempts) && step.attempts >= 1);
        assert.ok(Number.isInteger(step.time) && step.time >= 0);
        assert.equal(typeof step.firstToSolve, 'boolean');
        assert.ok(Number.isInteger(step.move.from) && step.move.from >= 0 && step.move.from < teamIds.size);
        assert.ok(Number.isInteger(step.move.to) && step.move.to >= 0 && step.move.to < teamIds.size);
        break;
      case 'award':
        assert.ok(teamIds.has(step.teamId));
        assert.ok(Array.isArray(step.awards) && step.awards.length > 0);
        break;
      case 'message':
        assert.equal(typeof step.text, 'string');
        break;
      default:
        assert.fail(`unhandled step type ${step.type}`);
    }
  }

  assert.equal(game.steps.at(-1).type, 'pause');
  const serialised = JSON.stringify(game);
  assert.ok(serialised.length > 0);
  assert.ok(serialised.length < 2 * 1024 * 1024, 'game JSON should stay well under 2MB');
  assert.deepEqual(JSON.parse(serialised), game);
});

test('scroll steps move one row at a time and never hide the top row', () => {
  const contest = fixtureContest();
  const game = buildGame(contest, { rowsPerScreen: 2, rowOffset: 0, startScreen: 'scoreboard' }, {});
  const scrolls = game.steps.filter((step) => step.type === 'scroll').map((step) => step.row);

  // Intro: first frame of the board (top row 0), then scroll down to the
  // bottom. 4 teams, 2 rows per screen -> the bottom view starts at row 2.
  assert.deepEqual(scrolls.slice(0, 2), [0, 2]);
  for (const row of scrolls) assert.ok(Number.isInteger(row) && row >= 0);
  assert.equal(game.steps[0].type, 'presentation');
  assert.equal(game.steps[0].screen, 'scoreboard');

  // The resolver emits one scroll step per rank row (intro has 2), walking
  // from the last row up to the first without ever jumping.
  const walk = scrolls.slice(2);
  assert.equal(walk.length, 4, 'every rank row is scrolled to');
  assert.equal(walk[0], 2);
  assert.equal(walk.at(-1), 0);
  for (let i = 1; i < walk.length; i++) {
    const delta = walk[i - 1] - walk[i];
    assert.ok(delta >= 0 && delta <= 1, `scroll jumped from ${walk[i - 1]} to ${walk[i]}`);
  }
});

test('resolve walk visits every team from the bottom up, even without pending work', () => {
  const contest = fixtureContest();
  const game = buildGame(contest, { showAwards: false, rowsPerScreen: 2 }, {});

  // β One (t3) has no pending submissions at all; it must still be selected
  // while the resolver walks the board (the old code skipped such rows, which
  // made the view jump and left the team invisible).
  const singleTeamSelections = game.steps
    .filter((step) => step.type === 'selectTeam' && step.selectType === 'NORMAL' && step.teamIds.length === 1)
    .map((step) => step.teamIds[0]);
  assert.ok(singleTeamSelections.includes('t3'), 'team without pending work is still selected');

  // First time each team is selected during the walk: initial order reversed.
  const firstSelections = [...new Set(singleTeamSelections.slice(1))];
  assert.deepEqual(orderedNames(contest, firstSelections), ['Gamma', 'Beta One', 'Alpha Blue', 'Alpha Gold']);

  // The walk keeps the last row at the bottom, then moves up one row per step.
  const scrolls = game.steps.filter((step) => step.type === 'scroll').map((step) => step.row);
  assert.equal(scrolls.length, 2 + game.meta.teamCount);
  assert.deepEqual(scrolls.slice(2), [2, 1, 0, 0]);
});

test('singleStepStartRow switches to the Resolver pause timing', () => {
  const contest = fixtureContest();
  const plain = buildGame(contest, { showAwards: false, singleStepStartRow: 0 }, {});
  const stepped = buildGame(contest, { showAwards: false, singleStepStartRow: 100 }, {});

  const countPauses = (game) => game.steps.filter((step) => step.type === 'pause').length;
  assert.ok(countPauses(stepped) > countPauses(plain));
  assert.ok(countPauses(plain) >= 5, 'splash, scoreboard, bottom, first team, done');

  // PauseTiming replaces every scoreboard delay with a pause.
  for (let i = 0; i < stepped.steps.length; i++) {
    if (stepped.steps[i].type !== 'resolve') continue;
    assert.equal(stepped.steps[i + 1].type, 'pause');
  }
  // Single-stepping from the very bottom has no delays at all.
  assert.equal(stepped.steps.some((step) => step.type === 'delay'), false);

  // Below the single-step row the Resolver uses the scoreboard delays again.
  const plainResolveIndex = plain.steps.findIndex((step) => step.type === 'resolve');
  assert.equal(plain.steps[plainResolveIndex + 1].type, 'delay');
});

test('default single-step starts at the medal rows like the Resolver', () => {
  const contest = {
    name: 'Medals',
    durationMs: 5 * 60 * 60 * 1000,
    freezeDurationMs: 0,
    penaltyMinutes: 20,
    problems: [{ id: 'pA', label: 'A' }],
    teams: Array.from({ length: 20 }, (_, i) => ({ id: `t${i}`, name: `T${i}`, displayName: `Team ${i + 1}` })),
    submissions: Array.from({ length: 20 }, (_, i) => ({
      teamId: `t${i}`,
      problemId: 'pA',
      contestTime: (10 + i) * 60_000,
      status: 'solved',
    })),
    awards: [
      { id: 'gold-medal', citation: 'Gold', teamIds: ['t0'], displayMode: 'detail', awardType: 'medal' },
      { id: 'silver-medal', citation: 'Silver', teamIds: ['t1'], displayMode: 'detail', awardType: 'medal' },
      { id: 'bronze-medal', citation: 'Bronze', teamIds: ['t2'], displayMode: 'detail', awardType: 'medal' },
    ],
  };
  const game = buildGame(contest, { showAwards: true }, {});

  // 20 teams, bronze is final place 3 -> single-stepping starts at row 2.
  const scrollIndexes = game.steps.flatMap((step, index) => (step.type === 'scroll' ? [index] : []));
  for (const index of scrollIndexes.slice(-3)) {
    assert.equal(game.steps[index + 1].type, 'selectTeam');
    assert.equal(game.steps[index + 2].type, 'pause', 'medal rows use pause timing');
  }
  // The row below the medal rows still uses scoreboard timing.
  const belowMedals = scrollIndexes.at(-4);
  assert.equal(game.steps[belowMedals + 1].type, 'selectTeam');
  assert.equal(game.steps[belowMedals + 2].type, 'delay');
});

test('major checkpoint pauses and award pauses', () => {
  const contest = fixtureContest();
  // No awards in this fixture: the Resolver's default single-step row is the
  // last screenful, which is every row of this 4-team contest.
  const plain = buildGame(contest, { showAwards: false }, {});
  const labels = plain.steps.filter((step) => step.type === 'pause').map((step) => step.label);
  assert.deepEqual(labels.slice(0, 4), ['splash', 'initial scoreboard', 'bottom', 'first team']);
  assert.ok(labels.includes('select team'), 'default single-step pauses exist');
  assert.equal(labels[labels.length - 1], 'done');

  assert.equal(DEFAULT_OPTIONS.showAwards, false);
  assert.equal(plain.steps.some((step) => step.type === 'award'), false);

  // Awards only when showAwards is enabled.
  const withAwards = buildGame(
    {
      ...contest,
      awards: [
        { id: 'gold-medal', citation: 'Gold Medal', teamIds: ['t1'], displayMode: 'detail', awardType: 'medal' },
        { id: 'first-to-solve-c', citation: 'First to Solve Problem C', teamIds: ['t1'], displayMode: 'pause', awardType: 'first-to-solve' },
      ],
    },
    { showAwards: true },
    {},
  );
  const awardSteps = withAwards.steps.filter((step) => step.type === 'award');
  assert.equal(awardSteps.length, 1);
  assert.deepEqual(awardSteps[0].awards.map((award) => award.citation), ['Gold Medal', 'First to Solve Problem C']);
  const ftsSelection = withAwards.steps.find(
    (step) => step.type === 'selectTeam' && step.teamIds.includes('t1') && step.selectType === 'FTS_HIGHLIGHT',
  );
  assert.ok(ftsSelection, 'detail + FTS award should use FTS_HIGHLIGHT selection');
});

test('delayFor maps Resolver delay kinds', () => {
  assert.equal(DELAY_TIMES.selectTeam, 1300);
  assert.equal(DELAY_TIMES.selectProblem, 1000);
  assert.equal(DELAY_TIMES.solvedMove, 2250);
  assert.equal(DELAY_TIMES.solvedStay, 1500);
  assert.equal(DELAY_TIMES.failed, 850);
  assert.equal(DELAY_TIMES.deselect, 250);
  assert.equal(DELAY_TIMES.selectSubmission, 450);
  assert.equal(delayFor('selectTeam'), 1300);
  assert.equal(delayFor('SELECT_TEAM'), 1300);
  assert.equal(delayFor('solvedMove'), 2250);
  assert.equal(delayFor('nope'), 0);
});

test('buildSteps returns the same steps as buildGame', () => {
  const contest = fixtureContest();
  const options = { showAwards: true };
  assert.deepEqual(buildSteps(contest, options), buildGame(contest, options, {}).steps);
});

// ---------------------------------------------------------------------------
// Demo data
// ---------------------------------------------------------------------------

test('createDemo shape: teams, problems, logos, freeze and pending submissions', () => {
  const { contest, options, name } = createDemo();

  assert.equal(typeof name, 'string');
  assert.ok(name.length > 0);
  assert.equal(contest.teams.length, 18);
  assert.ok(contest.teams.length >= 16);
  assert.equal(contest.problems.length, 13);
  assert.equal(contest.organizations.length, 9);
  assert.equal(options.showAwards, true);
  assert.equal(contest.freezeDurationMs, 60 * 60 * 1000);
  assert.equal(contest.durationMs, 5 * 60 * 60 * 1000);
  assert.equal(contest.penaltyMinutes, 20);

  // At most two teams per organization.
  const perOrg = new Map();
  for (const team of contest.teams) {
    perOrg.set(team.organizationId, (perOrg.get(team.organizationId) || 0) + 1);
  }
  for (const count of perOrg.values()) assert.ok(count <= 2);

  // Realistic organization/country data and 160x160 inline-SVG logos.
  const countries = new Set(contest.teams.map((team) => team.country));
  assert.ok(countries.size >= 5);
  for (const team of contest.teams) {
    assert.ok(team.displayName);
    assert.ok(team.name);
    assert.match(team.logo, /^data:image\/svg\+xml/);
    const svg = decodeURIComponent(team.logo.split(',')[1]);
    assert.match(svg, /width="160"/);
    assert.match(svg, /height="160"/);
    assert.match(svg, /<text/);
    assert.ok(team.organizationName);
  }
  for (const org of contest.organizations) {
    assert.match(org.logo, /^data:image\/svg\+xml/);
  }

  // 12-25 pending submissions after the freeze.
  const game = buildGame(contest, options, {});
  assert.ok(game.meta.pendingCount >= 12 && game.meta.pendingCount <= 25, `pending=${game.meta.pendingCount}`);
  assert.equal(game.meta.pendingCount, 20);
  assert.equal(game.initialState.frozen, true);
  assert.equal(game.initialState.contestTimeMs, 4 * 60 * 60 * 1000);
  assert.equal(game.meta.teamCount, 18);
  assert.equal(game.meta.problemCount, 13);
  assert.ok(JSON.stringify(game).length < 2 * 1024 * 1024);

  // Top-3 medals with detail display mode, and an FTS award.
  const medals = contest.awards.filter((award) => /-medal$/.test(award.id));
  assert.equal(medals.length, 3);
  assert.deepEqual(medals.map((award) => award.citation), ['Gold Medal', 'Silver Medal', 'Bronze Medal']);
  for (const medal of medals) {
    assert.equal(medal.displayMode, 'detail');
    assert.equal(medal.teamIds.length, 1);
    assert.equal(medal.awardType, 'medal');
  }
  assert.ok(contest.awards.some((award) => award.awardType === 'first-to-solve'));

  // At least one first-to-solve happens after the freeze in the final data.
  const final = computeCells(contest, { frozen: false });
  const freezeStartMs = contest.durationMs - contest.freezeDurationMs;
  let postFreezeFts = 0;
  for (const teamId of final.order) {
    for (const problemIndex of final.results[teamId].keys()) {
      const cell = final.results[teamId][problemIndex];
      if (cell.firstToSolve && cell.time != null && cell.time * 60_000 >= freezeStartMs) postFreezeFts += 1;
    }
  }
  assert.ok(postFreezeFts >= 1, 'expected a first-to-solve after the freeze');

  // Resolving has both yes and no outcomes.
  const resolves = game.steps.filter((step) => step.type === 'resolve');
  assert.ok(resolves.some((step) => step.status === 'solved'));
  assert.ok(resolves.some((step) => step.status === 'failed'));
  assert.ok(resolves.some((step) => step.firstToSolve));
});

test('demo game: final order equals final standings and all steps are valid', () => {
  const { contest, options } = createDemo();
  const game = buildGame(contest, options, { id: 'demo' });
  const final = computeCells(contest, { frozen: false });

  const simulated = simulateResolves(game);
  assert.deepEqual(simulated.order, final.order);
  const expectedCells = publicCells(final.results);
  for (const team of contest.teams) {
    assert.deepEqual(simulated.results[team.id], expectedCells[team.id]);
  }

  const teamIds = new Set(game.contest.teams.map((team) => team.id));
  for (const step of game.steps) {
    assert.ok(ALLOWED_STEP_TYPES.has(step.type));
    if (step.type === 'resolve') {
      assert.ok(teamIds.has(step.teamId));
      assert.ok(step.attempts >= 1);
      assert.ok(step.move.from >= 0 && step.move.from < teamIds.size);
      assert.ok(step.move.to >= 0 && step.move.to < teamIds.size);
    }
    if (step.type === 'selectTeam') {
      for (const teamId of step.teamIds) assert.ok(teamIds.has(teamId));
    }
  }

  // The demo exercises slides, scrolls, every result colour, awards and FTS.
  assert.ok(game.steps.some((step) => step.type === 'presentation' && step.screen === 'splash'));
  assert.ok(game.steps.some((step) => step.type === 'presentation' && step.screen === 'teamAward'));
  assert.ok(game.steps.some((step) => step.type === 'presentation' && step.screen === 'scoreboard'));
  assert.ok(game.steps.some((step) => step.type === 'scroll' && step.row > 0));
  assert.ok(game.steps.some((step) => step.type === 'delay' && step.kind === 'solvedMove'));
  assert.ok(game.steps.some((step) => step.type === 'delay' && step.kind === 'failed'));
  assert.ok(
    game.steps.some(
      (step) => step.type === 'selectTeam' && step.selectType === 'FTS_HIGHLIGHT',
    ),
  );

  // Regression: the board is walked from last place to first, one row at a
  // time. It must never jump from the bottom of the scoreboard to the top (the
  // intro intentionally scrolls to the bottom in one move, which is why the
  // first two scrolls are 0 -> bottom).
  const demoScrolls = game.steps.filter((step) => step.type === 'scroll').map((step) => step.row);
  assert.equal(demoScrolls.length, 2 + game.meta.teamCount, 'one scroll step per rank row');
  for (let i = 3; i < demoScrolls.length; i++) {
    const delta = demoScrolls[i - 1] - demoScrolls[i];
    assert.ok(delta >= 0 && delta <= 1, `scroll jumped from ${demoScrolls[i - 1]} to ${demoScrolls[i]}`);
  }

  // Every team is highlighted at least once while the resolver walks the board.
  const selected = new Set(
    game.steps.flatMap((step) =>
      step.type === 'selectTeam' && step.selectType === 'NORMAL' ? step.teamIds : [],
    ),
  );
  for (const teamId of teamIds) assert.ok(selected.has(teamId), `team ${teamId} is never selected`);
});

test('createDemo is deterministic', () => {
  const first = JSON.stringify(createDemo());
  const second = JSON.stringify(createDemo());
  assert.equal(first, second);
});

test('organization logo overrides survive normalization and reach the game', () => {
  const logo = 'data:image/png;base64,AAAA';
  const contest = normalizeContest({
    id: 'logo-test',
    name: 'Logo test',
    duration: '2:00:00',
    teams: [{ id: 't1', name: 'Team 1', organizationId: 'o1' }],
    organizations: [{ id: 'o1', name: 'Org 1', logo, logoOverride: true }],
    problems: [{ id: 'p1', label: 'A' }],
    submissions: [],
    awards: [],
  });
  assert.equal(contest.organizations[0].logo, logo);
  assert.equal(contest.organizations[0].logoOverride, true);

  const game = buildGame(contest, {}, { id: 'logo-game' });
  assert.equal(game.contest.organizations[0].logo, logo);
  assert.equal(game.contest.organizations[0].logoOverride, true);
});
