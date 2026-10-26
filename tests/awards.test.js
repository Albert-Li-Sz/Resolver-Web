import test from 'node:test';
import assert from 'node:assert/strict';
import { configuredAwards, normalizeMedalOptions } from '../public/js/medals.js';
import { buildGame, buildSteps, computeCells, normalizeOptions } from '../server/lib/engine.js';
import { SessionStore } from '../server/lib/sessions.js';

const submission = (teamId, problemId, contestTime, status = 'solved') => ({ teamId, problemId, contestTime, status });
const fixture = () => ({ name: 'Awards', durationMs: 600_000, freezeDurationMs: 300_000,
  teams: [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }, { id: 'c', name: 'Gamma' },
    { id: 'star', name: 'Observer', unrank: true }, { id: 'hidden', hidden: true }],
  problems: [{ id: 'pa', label: 'A' }, { id: 'pb', label: 'B' }, { id: 'pc', label: 'C' }, { id: 'pd', label: 'D' }],
  submissions: [submission('a', 'pa', 2000), submission('a', 'pb', 4000), submission('a', 'pc', 5000),
    submission('b', 'pa', 1500), submission('b', 'pb', 3000), submission('c', 'pa', 1000),
    submission('star', 'pa', 500), submission('hidden', 'pa', 100), submission('missing', 'pa', 1)],
  awards: [{ id: 'winner', awardType: 'winner', citation: 'Old winner', teamIds: ['c'] },
    { id: 'rank-2', awardType: 'rank', citation: 'Old runner-up', teamIds: ['c'] },
    { id: 'first-to-solve-pd', awardType: 'first-to-solve', citation: 'Old FTS', teamIds: ['c'] },
    { id: 'group-winner-special', awardType: 'group', citation: 'Special', teamIds: ['b'] }],
});
const byId = (awards) => Object.fromEntries(awards.map((award) => [award.id, award]));
const options = { podiumEnabled: true, firstSolveMode: 'all', showAwards: true };

test('podium selects three formal teams in final order and remains independent of medal quotas', () => {
  const game = buildGame(fixture(), { ...options, medalMode: 'custom', goldCount: 1, silverCount: 1, bronzeCount: 1 });
  const awards = byId(game.contest.awards);
  assert.deepEqual(['champion', 'runner-up', 'third-place'].map((place) => awards[`podium-${place}`].teamIds), [['a'], ['b'], ['c']]);
  assert.deepEqual(['gold', 'silver', 'bronze'].map((tier) => awards[`medal-${tier}`].teamIds), [['a'], ['b'], ['c']]);
  assert.equal(awards['podium-champion'].citation, '冠军');
  assert.equal(awards['podium-runner-up'].citation, '亚军');
  assert.equal(awards['podium-third-place'].citation, '季军');
  assert.equal(awards.winner, undefined);
  assert.equal(awards['rank-2'], undefined);
  assert.ok(awards['group-winner-special'], 'unrelated imported awards are retained');
  assert.ok(!game.contest.awards.some((award) => /^podium-/.test(award.id) && award.teamIds.includes('star')));
});

test('podium handles fewer than three entrants and strict final-order ties with custom names', () => {
  const c = fixture(); c.submissions = []; c.teams = [{ id: 'b', name: 'Beta' }, { id: 'a', name: 'Alpha' }]; c.awards = [];
  const awards = byId(buildGame(c, { podiumEnabled: true, championCitation: '总冠军' }).contest.awards);
  assert.deepEqual(awards['podium-champion'].teamIds, ['a']);
  assert.equal(awards['podium-champion'].citation, '总冠军');
  assert.deepEqual(awards['podium-runner-up'].teamIds, ['b']);
  assert.equal(awards['podium-third-place'], undefined);
  assert.deepEqual(configuredAwards({}, { podiumEnabled: true }, []), []);
});

test('first solve uses the earliest AC for each selected actual problem ID, not total standings', () => {
  const all = byId(buildGame(fixture(), options).contest.awards);
  assert.deepEqual(all['first-to-solve-pa'].teamIds, ['c']);
  assert.deepEqual(all['first-to-solve-pb'].teamIds, ['b']);
  assert.deepEqual(all['first-to-solve-pc'].teamIds, ['a']);
  assert.equal(all['first-to-solve-pb'].citation, 'B 题最快解题奖');
  assert.equal(all['first-to-solve-pd'], undefined, 'unsolved problems do not get a generated award');
  const selected = byId(buildGame(fixture(), { firstSolveMode: 'selected', firstSolveProblemIds: ['pb', 'not-a-problem', 'pb'] }).contest.awards);
  assert.deepEqual(selected['first-to-solve-pb'].teamIds, ['b']);
  for (const id of ['pa', 'pc', 'pd']) assert.equal(selected[`first-to-solve-${id}`], undefined);
  assert.ok(selected.winner, 'configuring FTS does not replace the imported podium');
});

test('first solve compares milliseconds, shares exact ties, deduplicates repeat ACs and ignores penalties', () => {
  const c = fixture();
  c.submissions = [submission('a', 'pa', 60_999), submission('b', 'pa', 60_001),
    submission('c', 'pa', 60_001), submission('b', 'pa', 60_001), submission('a', 'pa', 60_000, 'failed')];
  const award = byId(buildGame(c, options).contest.awards)['first-to-solve-pa'];
  assert.deepEqual(new Set(award.teamIds), new Set(['b', 'c']));
  assert.equal(award.teamIds.length, 2);
});

test('starred teams can opt into FTS without taking podium or medal positions', () => {
  const awards = byId(buildGame(fixture(), { ...options, firstSolveIncludeUnrank: true }).contest.awards);
  assert.deepEqual(awards['first-to-solve-pa'].teamIds, ['star']);
  assert.deepEqual(awards['podium-champion'].teamIds, ['a']);
});

test('earlier/equal pending submissions block FTS, while excluded observers and later pending do not', () => {
  for (const time of [999, 1000]) {
    const c = fixture(); c.submissions.push(submission('b', 'pa', time, 'pending'));
    assert.equal(byId(buildGame(c, options).contest.awards)['first-to-solve-pa'], undefined);
  }
  const c = fixture(); c.submissions.push(submission('b', 'pa', 1001, 'pending'), submission('star', 'pa', 1, 'pending'));
  assert.deepEqual(byId(buildGame(c, options).contest.awards)['first-to-solve-pa'].teamIds, ['c']);
  assert.equal(byId(buildGame(c, { ...options, firstSolveIncludeUnrank: true }).contest.awards)['first-to-solve-pa'], undefined);
});

test('only submissions inside the contest and for visible eligible teams/problems affect FTS', () => {
  const c = fixture(); c.submissions = [submission('a', 'pa', -1), submission('b', 'pa', c.durationMs),
    submission('c', 'pa', c.durationMs + 1), submission('missing', 'pa', 1), submission('hidden', 'pa', 1),
    submission('a', 'missing', 2), submission('c', 'pa', 10_000)];
  assert.deepEqual(byId(buildGame(c, options).contest.awards)['first-to-solve-pa'].teamIds, ['c']);
});

test('post-freeze first solves reach full award steps without leaking future award data to viewers', () => {
  const c = fixture(); c.submissions = [submission('b', 'pb', 301_000)];
  const before = JSON.stringify(c);
  const game = buildGame(c, { ...options, firstSolveMode: 'selected', firstSolveProblemIds: ['pb'] });
  assert.equal(JSON.stringify(c), before, 'award configuration must not mutate the imported feed');
  assert.deepEqual(buildSteps(c, { ...options, firstSolveMode: 'selected', firstSolveProblemIds: ['pb'] }), game.steps);
  const awardIndex = game.steps.findIndex((step) => step.type === 'presentation' && step.screen === 'teamAward' &&
    step.awards.some((award) => award.id === 'first-to-solve-pb'));
  assert.ok(awardIndex > game.steps.findIndex((step) => step.type === 'resolve' && step.teamId === 'b'));
  const store = new SessionStore(); const entry = store.create(game);
  assert.deepEqual(store.snapshot(entry).game.contest.awards, []);
  assert.ok(!store.snapshot(entry).game.steps.some((step) => step.type === 'award'));
  store.move(entry, awardIndex, 0);
  assert.ok(store.snapshot(entry).game.steps.some((step) => step.type === 'presentation' && step.awards?.some((award) => award.id === 'first-to-solve-pb')));
});

test('legacy imported award behavior stays unchanged and award options survive both normalizers', () => {
  const c = fixture(); const final = computeCells(c);
  assert.deepEqual(configuredAwards(final.contest, {}, final.standings), final.contest.awards);
  const normalized = normalizeMedalOptions({ ...options, firstSolveMode: 'selected', firstSolveProblemIds: ['pb', 'pb'], championCitation: '  冠军队伍  ', firstSolveIncludeUnrank: true });
  assert.equal(normalized.championCitation, '冠军队伍');
  assert.deepEqual(normalized.firstSolveProblemIds, ['pb']);
  for (const field of ['podiumEnabled', 'firstSolveMode', 'firstSolveProblemIds', 'championCitation', 'firstSolveIncludeUnrank']) {
    assert.deepEqual(normalizeOptions(normalized)[field], normalized[field]);
  }
  assert.equal(normalizeMedalOptions({ firstSolveMode: 'invalid', podiumEnabled: 'false' }).podiumEnabled, false);
  assert.equal(normalizeMedalOptions({ firstSolveMode: 'invalid' }).firstSolveMode, 'imported');
});
