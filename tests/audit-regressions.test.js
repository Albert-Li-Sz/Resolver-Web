import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGame, computeCells, parseContestTime, parseDuration, parseEventFeed } from '../server/lib/engine.js';
import { ResolverView } from '../public/js/render/resolver-view.js';
import { SessionStore } from '../server/lib/sessions.js';

const contest = (extra = {}) => ({ durationMs: 300_000, freezeDurationMs: 60_000,
  teams: [{ id: 'a' }, { id: 'b' }], problems: [{ id: 'p' }], submissions: [], ...extra });
const feed = (time, start = '2026-10-23T00:00:00+00') => JSON.stringify([
  { type: 'contest', data: { id: 'c', start_time: start, duration: '5:00:00' } },
  { type: 'team', data: { id: 'a' } }, { type: 'problem', data: { id: 'p' } },
  { type: 'submission', data: { id: 's', team_id: 'a', problem_id: 'p', ...time } },
]);

test('invalid submission clocks remain unknown and block games even without a freeze', () => {
  for (const value of ['', 'garbage', '1::3', '0:60:00', Infinity, null]) {
    assert.equal(parseContestTime(value), null, String(value));
    const c = parseEventFeed(feed({ contest_time: value }));
    assert.equal(c.missingSubmissionTimes, 1);
    assert.equal(c.submissions[0].contestTime, null);
    assert.throws(() => buildGame(c, {}), /缺少时间|无效时间/);
  }
  const c = parseEventFeed(feed({ time: '2026-10-23T00:01:00Z' }, null));
  assert.equal(c.missingSubmissionTimes, 1);
  assert.throws(() => buildGame(c, {}), /缺少时间|无效时间/);
  assert.equal(parseDuration(Infinity), 0);
});

test('wall clocks support CCS timezone spellings and reject invalid calendar dates', () => {
  for (const zone of ['Z', '+00', '+0000', '+00:00']) {
    const c = parseEventFeed(feed({ time: '2026-10-23T00:01:01.250Z' }, `2026-10-23T00:00:00${zone}`));
    assert.equal(c.submissions[0].contestTime, 61_250);
  }
  assert.equal(parseEventFeed(feed({ time: '2026-02-30T00:00:00Z' })).missingSubmissionTimes, 1);
});

test('hidden groups hide their teams and observers neither receive nor block first-to-solve', () => {
  const c = parseEventFeed(JSON.stringify([
    ...JSON.parse(feed({ contest_time: 1000 })),
    { type: 'group', data: { id: 'staff', hidden: true } },
    { type: 'team', data: { id: 'staff-team', group_ids: ['staff'] } },
  ]));
  assert.deepEqual(c.teams.map((t) => t.id), ['a']);
  for (const status of ['solved', 'pending']) {
    const result = computeCells(contest({ teams: [{ id: 'a', unrank: true }, { id: 'b' }], submissions: [
      { teamId: 'a', problemId: 'p', contestTime: 1000, status },
      { teamId: 'b', problemId: 'p', contestTime: 2000, status: 'solved' },
    ] }));
    assert.equal(result.results.a[0].firstToSolve, false);
    assert.equal(result.results.b[0].firstToSolve, true);
  }
});

test('post-freeze non-penalty verdicts do not create pending work', () => {
  const c = contest({ submissions: [{ teamId: 'a', problemId: 'p', contestTime: 250_000, status: 'failed', penalty: 'false' }] });
  assert.equal(computeCells(c, { frozen: true }).pendingCount, 0);
  assert.equal(buildGame(c, {}).steps.some((s) => s.type === 'resolve'), false);
});

test('special object keys are valid team IDs throughout engine and JSON replay', () => {
  for (const id of ['__proto__', 'constructor', 'toString']) {
    const game = buildGame(contest({ teams: [{ id }], submissions: [{ teamId: id, problemId: 'p', contestTime: 250_000, status: 'solved' }] }), {});
    assert.equal(Object.hasOwn(JSON.parse(JSON.stringify(game)).initialState.results, id), true);
    assert.equal(game.steps.find((s) => s.type === 'resolve').teamId, id);
  }
});

function canvas() {
  const context = new Proxy({ measureText: (s) => ({ width: String(s).length * 10 }) }, { get: (target, key) => target[key] ?? (() => {}) });
  return { getContext: () => context, style: {}, dataset: {} };
}
globalThis.Image = class {};

test('each award presentation uses the current team and its citation before the award action', () => {
  const game = buildGame(contest({ awards: [
    { id: 'gold-medal', teamIds: ['a'], citation: 'Gold' },
    { id: 'silver-medal', teamIds: ['b'], citation: 'Silver' },
  ] }), { showAwards: true });
  const view = new ResolverView(canvas(), game);
  let selected;
  let presentations = 0;
  for (const step of game.steps) {
    if (step.type === 'selectTeam') selected = step.teamIds[0];
    view.applyStep(step, { instant: true });
    if (step.type === 'presentation' && step.screen === 'teamAward') {
      presentations++;
      assert.equal(view._awardTeamId, selected);
      assert.ok(view._awardsForTeam(selected).length);
    }
  }
  assert.equal(presentations, 2);
});

test('list awards are presented only after all their recipients have been resolved', () => {
  const game = buildGame(contest({ submissions: [{ teamId: 'a', problemId: 'p', contestTime: 250_000, status: 'solved' }],
    awards: [{ id: 'top', citation: 'Finalists', displayMode: 'list', teamIds: ['a', 'b'] }] }), { showAwards: true });
  const index = game.steps.findIndex((s) => s.type === 'presentation' && s.screen === 'teamList');
  assert.ok(index > game.steps.findLastIndex((s) => s.type === 'resolve'));
  const view = new ResolverView(canvas(), game);
  for (const step of game.steps.slice(0, index + 1)) view.applyStep(step, { instant: true });
  assert.equal(view._teamListState.citation, 'Finalists');
  assert.deepEqual(new Set(view._teamListState.teams.map((t) => t.id)), new Set(['a', 'b']));
});

test('long award lists keep their scroll target after presentation initialization', () => {
  const teams = Array.from({ length: 16 }, (_, i) => ({ id: `t${i}` }));
  const game = buildGame(contest({ teams, awards: [{ id: 'list', citation: 'Finalists', displayMode: 'list', teamIds: teams.map((t) => t.id) }] }), { showAwards: true });
  const view = new ResolverView(canvas(), game);
  for (const step of game.steps) {
    view.applyStep(step, { instant: true });
    if (step.type === 'presentation' && step.screen === 'teamList') {
      assert.equal(view._teamListScroll.getTarget(), (16 - 11) * 1.2);
      return;
    }
  }
  assert.fail('list presentation was not generated');
});

test('capacity pressure rejects new games instead of evicting a recently used presenter', () => {
  const store = new SessionStore({ maxGames: 2 });
  const game = buildGame(contest(), {});
  const entry = store.create(game);
  store.get(entry.id);
  store.create(game);
  assert.throws(() => store.create(game), { status: 503 });
  assert.ok(store.get(entry.id));
});
