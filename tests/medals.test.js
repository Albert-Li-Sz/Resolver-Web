import test from 'node:test';
import assert from 'node:assert/strict';
import { configuredAwards, normalizeMedalOptions } from '../public/js/medals.js';
import { buildGame, buildSteps } from '../server/lib/engine.js';

const rows = [
  { teamId: 'star', solved: 10, time: 100, unrank: true },
  { teamId: 'a', solved: 9, time: 100 },
  { teamId: 'b', solved: 9, time: 100 },
  { teamId: 'c', solved: 8, time: 100 },
  { teamId: 'd', solved: 7, time: 100 },
];
const options = { medalMode: 'custom', goldCount: 1, silverCount: 1, bronzeCount: 1 };
const medals = (awards) => Object.fromEntries(awards.map((award) => [award.id, award.teamIds]));

test('tied teams inherit the higher medal across cutoffs and observers use no slots', () => {
  const awards = configuredAwards({ awards: [] }, normalizeMedalOptions(options), rows);
  assert.deepEqual(medals(awards), { 'medal-gold': ['a', 'b'], 'medal-bronze': ['c'] });
  assert.equal(awards.flatMap((a) => a.teamIds).includes('star'), false);
});

test('strict quotas split ties using final scoreboard order; zero quotas disable tiers', () => {
  assert.deepEqual(medals(configuredAwards({}, normalizeMedalOptions({ ...options, medalSameScore: false }), rows)), {
    'medal-gold': ['a'], 'medal-silver': ['b'], 'medal-bronze': ['c'],
  });
  assert.deepEqual(configuredAwards({}, normalizeMedalOptions({ ...options, goldCount: 0, silverCount: 0, bronzeCount: 0 }), rows), []);
});

test('award equality uses exact seconds for Hydro and ignores last-solve tiebreaker', () => {
  const same = rows.slice(1, 3).map((row, i) => ({ ...row, timeSeconds: 6001, lastSolutionTime: 50 + i }));
  assert.deepEqual(medals(configuredAwards({}, normalizeMedalOptions(options), same)), { 'medal-gold': ['a', 'b'] });
  same[1].timeSeconds++;
  assert.deepEqual(medals(configuredAwards({}, normalizeMedalOptions(options), same)), { 'medal-gold': ['a'], 'medal-silver': ['b'] });
});

test('custom medals reach award steps with photo and organization overrides, preserving other awards', () => {
  const contest = { teams: [{ id: 'a', organizationId: 'org', photo: '/media/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webp' }, { id: 'b' }],
    organizations: [{ id: 'org', logo: '/media/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.webp', logoOverride: true }], problems: [{ id: 'p' }],
    awards: [{ id: 'medal-gold-old', awardType: 'medal', teamIds: ['b'], citation: 'Old' }, { id: 'winner', awardType: 'winner', teamIds: ['a'], citation: 'Winner' }],
    submissions: [{ teamId: 'a', problemId: 'p', contestTime: 60000, status: 'solved' }],
  };
  const opts = { ...options, goldCitation: '一等奖', showAwards: true, medalSameScore: false };
  const game = buildGame(contest, opts);
  const gold = game.contest.awards.find((award) => award.id === 'medal-gold');
  assert.equal(gold.citation, '一等奖'); assert.deepEqual(gold.teamIds, ['a']);
  assert.ok(game.contest.awards.some((award) => award.id === 'winner'));
  assert.ok(!game.contest.awards.some((award) => award.id === 'medal-gold-old'));
  assert.ok(game.steps.some((step) => step.type === 'award' && step.teamId === 'a' && step.awards.some((award) => award.id === 'medal-gold')));
  assert.equal(game.contest.teams[0].photo, '/media/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webp');
  assert.equal(game.contest.organizations[0].logoOverride, true);
  assert.deepEqual(buildSteps(contest, opts), game.steps);
  assert.equal(contest.awards[0].id, 'medal-gold-old', 'building awards must not mutate imported data');
});
