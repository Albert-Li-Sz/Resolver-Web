import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGame, computeCells, resolveStartRowFor } from '../server/lib/engine.js';
import { actionIndicesFor, startIndexFor, nextAutomaticAction, fastForwardDelayFor } from '../public/js/playback-model.js';
import { AutomaticAdvance } from '../public/js/automatic-advance.js';
import { ResolverView } from '../public/js/render/resolver-view.js';
import { SessionStore } from '../server/lib/sessions.js';

const contest = () => ({ name: 'Award boundary', durationMs: 600_000, freezeDurationMs: 300_000,
  teams: Array.from({ length: 24 }, (_, i) => ({ id: `t${i}`, name: `Team ${String(i).padStart(2, '0')}` })),
  problems: [{ id: 'p', label: 'A' }],
  submissions: [{ teamId: 't10', problemId: 'p', contestTime: 301_000, status: 'solved' }],
  awards: [{ id: 'winner', teamIds: ['t10'], citation: 'Champion', awardType: 'winner' }],
});

test('all enabled awards use the lowest frozen recipient position, rather than final ranking or only medals', () => {
  const c = contest();
  const game = buildGame(c, { showAwards: true });
  assert.equal(computeCells(c, { frozen: false }).order[0], 't10');
  assert.equal(game.initialState.order.indexOf('t10'), 10);
  assert.equal(game.meta.resolveStartRow, 10);
  assert.ok(game.steps.some((step) => step.phase === 'fast' && step.speedMultiplier === 4));
  assert.ok(game.steps.filter((step) => step.teamId === 't10' || step.teamIds?.includes('t10')).every((step) => step.phase !== 'fast'));
  c.awards.push({ id: 'first-to-solve-p', teamIds: ['t15'], awardType: 'first-to-solve', displayMode: 'pause' },
    { id: 'top-list', teamIds: ['t17'], awardType: 'top', displayMode: 'list' },
    { id: 'ignored', teamIds: ['t23'], displayMode: 'ignore' });
  assert.equal(buildGame(c, { showAwards: true }).meta.resolveStartRow, 17);
});

test('no active awards preserve manual playback from the bottom, while an explicit cutoff remains supported', () => {
  const c = contest();
  for (const options of [{}, { showAwards: false }, { showAwards: true }]) {
    const input = options.showAwards ? { ...c, awards: c.awards.map((a) => ({ ...a, displayMode: 'ignore' })) } : c;
    const game = buildGame(input, options);
    assert.equal(game.meta.resolveStartRow, 23);
    assert.ok(!game.steps.some((step) => step.phase === 'fast'));
  }
  assert.equal(resolveStartRowFor(c, { singleStepStartRow: 4 }, c.teams.map((team) => team.id)), 4);
});

test('a non-winning team can displace a frozen award recipient downward without fast-revealing it', () => {
  const c = { ...contest(), teams: ['a', 'b', 'c', 'd'].map((id) => ({ id, name: id })),
    submissions: [{ teamId: 'd', problemId: 'p', contestTime: 301_000, status: 'solved' }],
    awards: [{ id: 'special', teamIds: ['b'], citation: 'Special', awardType: 'group' }] };
  const game = buildGame(c, { showAwards: true });
  assert.equal(game.meta.resolveStartRow, 1);
  assert.equal(game.steps.find((step) => step.type === 'resolve' && step.teamId === 'd').phase, 'fast');
  const firstWinner = game.steps.findIndex((step) => step.type === 'selectTeam' && step.teamIds.includes('b'));
  assert.equal(game.steps[firstWinner].phase, 'manual');
  assert.ok(game.steps.slice(firstWinner).every((step) => step.phase !== 'fast'));
  assert.ok(game.steps.some((step) => step.type === 'award' && step.teamId === 'b'));
});

test('first next action is the short bottom scroll, followed by 4x automatic actions and a manual boundary', () => {
  const game = buildGame(contest(), { showAwards: true, startScreen: 'scoreboard' });
  const actions = actionIndicesFor(game.steps);
  assert.equal(actions[0], startIndexFor(game));
  assert.equal(game.steps[actions[1]].role, 'intro-bottom');
  assert.equal(game.steps[actions[1]].durationMs, 650);
  assert.equal(nextAutomaticAction(game, actions, 1).delay, 650);
  let position = 1;
  let automatic;
  while ((automatic = nextAutomaticAction(game, actions, position))) {
    assert.equal(automatic.index, actions[++position]);
  }
  assert.equal(game.steps[actions[position]].phase, 'manual');
  assert.equal(game.steps[actions[position]].type, 'selectTeam');
  assert.deepEqual(game.steps[actions[position]].teamIds, ['t10']);
  assert.ok(!game.steps.slice(0, actions[position]).some((step) => step.type === 'resolve' && step.teamId === 't10'));
  const simple = { options: {}, steps: [{ type: 'selectTeam', phase: 'fast', speedMultiplier: 4 }, { type: 'delay', ms: 1300 }, { type: 'resolve' }] };
  assert.equal(fastForwardDelayFor(simple, 0, 2), 325);
});

function clock() {
  let sequence = 0;
  const tasks = new Map();
  return { tasks, setTimeout(fn, delay) { const id = ++sequence; tasks.set(id, { fn, delay }); return id; },
    clearTimeout(id) { tasks.delete(id); }, async tick() { const [id, task] = tasks.entries().next().value; tasks.delete(id); await task.fn(); } };
}

test('automatic prelude reaches its boundary with one timer and can pause/resume without stale advances', async () => {
  const timers = clock(); let position = 0; const visited = [];
  const controller = new AutomaticAdvance({ timers, next: () => position < 3 ? { index: position + 1, delay: 100 } : null,
    advance: async (index) => { visited.push(index); position = index; return true; } });
  controller.start(); controller.start();
  assert.equal(timers.tasks.size, 1);
  controller.stop(); assert.equal(timers.tasks.size, 0);
  controller.start(); await timers.tick();
  controller.stop(); assert.deepEqual(visited, [1]);
  controller.start(); await timers.tick(); await timers.tick();
  assert.deepEqual(visited, [1, 2, 3]);
  assert.equal(controller.active, false); assert.equal(timers.tasks.size, 0);
});

test('pausing an in-flight advance cancels continuation; resume and network failure are bounded', async () => {
  const timers = clock(); let finish; let position = 0;
  const controller = new AutomaticAdvance({ timers, next: () => position < 2 ? { index: position + 1, delay: 50 } : null,
    advance: (index) => new Promise((resolve) => { finish = () => { position = index; resolve(true); }; }) });
  controller.start(); const pending = timers.tick();
  controller.stop(); finish(); await pending;
  assert.equal(timers.tasks.size, 0);
  controller.start(); const resumed = timers.tick(); controller.stop(); controller.start(); finish(); await resumed;
  assert.equal(position, 2); assert.equal(controller.active, false);
  const failure = new AutomaticAdvance({ timers, next: () => ({ index: 1, delay: 50 }), advance: async () => { throw new Error('network'); } });
  failure.start(); await timers.tick();
  assert.equal(timers.tasks.size, 0); assert.equal(failure.paused, true);
});

globalThis.Image = class {};
const canvas = () => ({ style: {}, dataset: {}, getContext: () => ({ measureText: (s) => ({ width: String(s).length * 10 }) }) });

test('opening scroll is bounded at 650ms even for a 1200-team board; row animations share the 4x rate', () => {
  const c = contest(); c.teams = Array.from({ length: 1200 }, (_, i) => ({ id: String(i) }));
  const game = { contest: c, options: { rowsPerScreen: 12 }, initialState: { order: c.teams.map((t) => t.id), results: {} } };
  const view = new ResolverView(canvas(), game);
  view.applyStep({ type: 'scroll', row: 1188, durationMs: 650 }); view.update(325);
  assert.ok(view._rowScroll.getValue() > 0 && view._rowScroll.getValue() < 1188);
  view.update(325); assert.ok(Math.abs(view._rowScroll.getValue() - 1188) < 1e-6);
  const normal = new ResolverView(canvas(), game), fast = new ResolverView(canvas(), game);
  normal.applyStep({ type: 'scroll', row: 10 }); fast.applyStep({ type: 'scroll', row: 10, speedMultiplier: 4 });
  normal.update(400); fast.update(100);
  assert.equal(fast._rowScroll.getValue(), normal._rowScroll.getValue());
  assert.equal(fast.animationSpeed, 4);
  fast.applyStep({ type: 'selectTeam', teamIds: ['1'], phase: 'manual', speedMultiplier: 1 });
  assert.equal(fast.animationSpeed, 1);
});

test('published audience selection stays recoverable while old and rehearsal sessions expire', () => {
  let now = 0;
  const store = new SessionStore({ ttl: 100, now: () => now });
  const game = buildGame(contest(), {});
  assert.equal(store.current(), null);
  const live = store.create(game); store.publish(live);
  store.create(game); assert.equal(store.current().id, live.id);
  const next = store.create(game); store.publish(next); assert.equal(store.current().id, next.id);
  now = 101; assert.equal(store.current().id, next.id); assert.equal(store.get(live.id), undefined);
  assert.equal(store.games.size, 1);
});
