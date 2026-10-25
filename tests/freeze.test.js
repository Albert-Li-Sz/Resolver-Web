import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGame, buildSteps, computeCells, parseEventFeed } from '../server/lib/engine.js';
import { hydroFeed } from './fixtures/hydro.js';

const unlockedFeed = ({ keepHistory = false, stateHistory = false } = {}) => {
  const events = hydroFeed().split('\n').map(JSON.parse);
  if (!keepHistory) events[0].data.scoreboard_freeze_duration = null;
  if (stateHistory) events.push({ type: 'state', data: { frozen: '2026-10-22T05:00:00+08:00' } });
  events.push({ type: 'contest', op: 'update', data: { scoreboard_freeze_duration: '00:00:00' } });
  events.push({ type: 'state', data: { frozen: null, thawed: '2026-10-22T06:05:00+08:00' } });
  return events.map(JSON.stringify).join('\n');
};

test('unlocked feed restores the prior freeze duration even after metadata is cleared', () => {
  for (const params of [{ keepHistory: true }, { stateHistory: true }]) {
    const contest = parseEventFeed(unlockedFeed(params));
    assert.equal(contest.freezeDurationMs, 3600000);
    assert.equal(contest.freezeSource, 'history');
    const game = buildGame(contest, {});
    assert.equal(game.meta.pendingCount, 3, 'CE/FE/IGN do not become hidden work');
    assert.ok(game.steps.some((step) => step.type === 'resolve'));
  }
});

test('manual freeze restores already judged submissions without changing final results', () => {
  const contest = parseEventFeed(unlockedFeed());
  assert.equal(contest.freezeDurationMs, 0);
  const options = { freezeMode: 'custom', freezeMinutes: 60 };
  const game = buildGame(contest, options);
  assert.equal(game.initialState.frozen, true);
  assert.equal(game.contest.freezeDurationMs, 3600000);
  assert.equal(game.meta.pendingCount, 3);
  assert.equal(contest.freezeDurationMs, 0, 'input must not be mutated');
  assert.deepEqual(buildSteps(contest, options), game.steps);
  const final = computeCells(contest, { frozen: false });
  const order = game.initialState.order.slice();
  for (const step of game.steps.filter((step) => step.type === 'resolve')) {
    order.splice(step.move.from, 1); order.splice(step.move.to, 0, step.teamId);
  }
  assert.deepEqual(order, final.order);
  assert.throws(() => buildGame(contest, { freezeMode: 'custom', freezeMinutes: 301 }), /比赛时长/);
});

test('missing submission timestamps cannot silently become a valid frozen reconstruction', () => {
  const events = hydroFeed().split('\n').map(JSON.parse);
  const submission = events.find((event) => event.type === 'submissions');
  delete submission.data.contest_time;
  const contest = parseEventFeed(events.map(JSON.stringify).join('\n'));
  assert.equal(contest.missingSubmissionTimes, 1);
  assert.throws(() => buildGame(contest, {}), /缺少时间/);
  assert.throws(() => buildGame(contest, { freezeMode: 'custom', freezeMinutes: 60 }), /缺少时间/);
});
