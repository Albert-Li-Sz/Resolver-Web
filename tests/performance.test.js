import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGame, computeCells } from '../server/lib/engine.js';
import { scoreStandings } from '../public/js/standings.js';
import { ResolverView } from '../public/js/render/resolver-view.js';

globalThis.Image = class {};
const canvas = () => ({ style: {}, dataset: {}, getContext: () => ({ measureText: (s) => ({ width: String(s).length * 10 }) }) });

export function largeContest(count = 1000) {
  const teams = Array.from({ length: count }, (_, i) => ({ id: `t${i}`, name: `Team ${String(i).padStart(4, '0')}` }));
  const problems = Array.from({ length: 8 }, (_, i) => ({ id: `p${i}` }));
  return { name: 'Scale regression', durationMs: 18_000_000, freezeDurationMs: 3_600_000, teams, problems,
    submissions: teams.flatMap((team, i) => problems.map((problem, p) => ({ id: `s${i}-${p}`, teamId: team.id,
      problemId: problem.id, contestTime: 14_400_000 + (i * 97 + p * 103) % 3_500_000, status: 'solved' }))) };
}

test('1000 teams / 8000 reveals stay compact and rewind without per-reveal full sorting', (t) => {
  const contest = largeContest();
  let start = performance.now();
  const game = buildGame(contest, {});
  const buildMs = performance.now() - start;
  const bytes = Buffer.byteLength(JSON.stringify(game));
  assert.ok(bytes < 12 * 1024 * 1024, `${bytes} bytes`);
  assert.equal(game.steps.filter((s) => s.type === 'resolve').length, 8000);
  assert.ok(game.steps.every((s) => s.type !== 'resolve' || (!s.order && s.move)));
  const view = new ResolverView(canvas(), game);
  let scoreCalls = 0;
  const score = view._recomputeStandings.bind(view);
  view._recomputeStandings = () => { scoreCalls++; score(); };
  start = performance.now();
  view.seek(game.steps, game.steps.length - 1);
  const replayMs = performance.now() - start;
  assert.ok(scoreCalls <= 2, `full ranking calls: ${scoreCalls}`);
  assert.deepEqual(view._order, computeCells(contest, { frozen: false }).order);
  const expected = view.captureState();
  view.seek(game.steps, game.steps.length - 20);
  view.seek(game.steps, game.steps.length - 1);
  assert.deepEqual(view.captureState(), expected, 'checkpoint replay preserves all visible state');
  assert.ok(buildMs < 10_000 && replayMs < 10_000, 'coarse CI guard against multi-second regressions');
  t.diagnostic(`build=${Math.round(buildMs)}ms, replay=${Math.round(replayMs)}ms, JSON=${(bytes / 1024 / 1024).toFixed(2)}MB`);
});

test('incremental rank moves match full shared scoring after every reveal across mixed contests', () => {
  for (let seed = 0; seed < 40; seed++) {
    let value = seed + 1;
    const rand = () => { value = Math.imul(value, 1664525) + 1013904223 | 0; return (value >>> 0) / 2 ** 32; };
    const c = largeContest(10);
    c.scoringMode = seed % 2 ? 'hydro' : 'icpc';
    c.teams[2].unrank = true;
    c.submissions.forEach((s) => { s.contestTime += Math.floor(rand() * 10000); s.status = rand() < 0.5 ? 'failed' : 'solved'; s.penalty = true; });
    const game = buildGame(c, {});
    const results = structuredClone(game.initialState.results);
    const order = game.initialState.order.slice();
    for (const step of game.steps) {
      if (step.type !== 'resolve') continue;
      assert.equal(order[step.move.from], step.teamId);
      results[step.teamId][step.problemIndex] = { ...step, pending: 0 };
      order.splice(step.move.from, 1); order.splice(step.move.to, 0, step.teamId);
      assert.deepEqual(order, scoreStandings(game.contest, results).map((row) => row.teamId), `seed ${seed}`);
    }
  }
});
