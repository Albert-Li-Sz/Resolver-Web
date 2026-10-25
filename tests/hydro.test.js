import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEventFeed, computeCells, buildGame } from '../server/lib/engine.js';

import { hydroFeed } from './fixtures/hydro.js';

test('Hydro CDP preserves second precision, observers and non-penalty verdicts', () => {
  const contest = parseEventFeed(hydroFeed());
  assert.equal(contest.scoringMode, 'hydro');
  assert.equal(contest.teams.find((team) => team.id === 'S01').unrank, true);
  assert.equal(contest.teams[0].logo, 'https://hydro.example.test/avatar/01.png');
  const frozen = computeCells(contest, { frozen: true });
  assert.deepEqual(frozen.order, ['S01', '01', '02', '03']);
  assert.deepEqual(frozen.standings.map((row) => row.rank), [0, 1, 2, 3]);
  assert.equal(frozen.results['01'][0].timeSeconds, 61);
  const final = computeCells(contest, { frozen: false });
  assert.equal(final.standings[0].teamId, '02');
  assert.equal(final.standings[0].timeSeconds, 16274);
  assert.equal(final.standings.find((row) => row.teamId === '01').timeSeconds, 16866);
  const game = buildGame(contest, {});
  assert.equal(game.steps.find((step) => step.type === 'resolve' && step.teamId === '01').timeSeconds, 15605);
  assert.equal(game.contest.scoringMode, 'hydro');
});

test('Hydro ties use solved and exact total time, without last-solve tie-breaking', () => {
  const contest = {
    scoringMode: 'hydro', teams: [{ id: 'a' }, { id: 'b' }], problems: [{ id: 'p' }, { id: 'q' }],
    submissions: [
      { teamId: 'a', problemId: 'p', contestTime: 600000, status: 'solved' },
      { teamId: 'a', problemId: 'q', contestTime: 3000000, status: 'solved' },
      { teamId: 'b', problemId: 'p', contestTime: 1200000, status: 'solved' },
      { teamId: 'b', problemId: 'q', contestTime: 2400000, status: 'solved' },
    ],
  };
  const result = computeCells(contest);
  assert.deepEqual(result.standings.map((row) => row.rank), [1, 1]);
  assert.deepEqual(result.standings.map((row) => row.timeSeconds), [3600, 3600]);
});

test('automatic Hydro detection rejects OI exports and keeps pending judgements', () => {
  assert.throws(() => parseEventFeed(hydroFeed({ scoreboardType: 'score' })), /OI\/IOI/);
  const feed = hydroFeed().split('\n').filter((line) => JSON.parse(line).data.id !== 'j-s9').join('\n');
  const contest = parseEventFeed(feed);
  assert.equal(contest.submissions.find((submission) => submission.id === 's9').status, 'pending');
  assert.equal(contest.teams[0].photo, null);
});

test('Hydro uses the strict ICPC freeze boundary and ignores submissions after a visible AC', () => {
  const contest = { scoringMode: 'hydro', durationMs: 300000, freezeDurationMs: 60000,
    teams: [{ id: 'a' }], problems: [{ id: 'p' }], submissions: [
      { teamId: 'a', problemId: 'p', contestTime: 240000, status: 'solved' },
      { teamId: 'a', problemId: 'p', contestTime: 250000, status: 'failed', penalty: true },
    ],
  };
  const result = computeCells(contest, { frozen: true });
  assert.equal(result.results.a[0].status, 'pending');
  assert.equal(result.results.a[0].attempts, 2);
  assert.equal(result.results.a[0].timeSeconds, 250, 'pending cell reports its latest attempt');
  contest.submissions[0].contestTime = 239000;
  assert.equal(computeCells(contest, { frozen: true }).results.a[0].attempts, 1);
});
