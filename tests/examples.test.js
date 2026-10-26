import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseEventFeed, computeCells, buildGame } from '../server/lib/engine.js';
import { DEFAULT_SCHOOL_LOGO, logoSource } from '../public/js/logos.js';

const directory = new URL('../examples/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.json', directory), 'utf8'));

for (const entry of manifest) {
  test(`downloadable example parses and resolves: ${entry.file}`, async () => {
    const text = await readFile(new URL(entry.file, directory), 'utf8');
    assert.equal(createHash('sha256').update(text).digest('hex'), entry.sha256);
    const contest = parseEventFeed(text), game = buildGame(contest, { showAwards: true });
    assert.equal(contest.teams.length, entry.teams);
    assert.equal(contest.problems.length, entry.problems);
    assert.equal(contest.submissions.length, entry.submissions);
    assert.equal(game.steps.filter((step) => step.type === 'resolve').length, entry.reveals);
    assert.ok(entry.reveals > 0);
    assert.ok(contest.submissions.every((s) => Number.isFinite(s.contestTime)));
    assert.ok(contest.teams.every((team) => team.logo === DEFAULT_SCHOOL_LOGO ||
      team.logo.startsWith('data:') || logoSource(team.logo) === 'hydro'));
    assert.equal(computeCells(contest, { frozen: false }).standings.length, entry.teams);
  });
}

test('tie and Hydro examples retain the advertised domain behavior', async () => {
  const load = async (name) => parseEventFeed(await readFile(new URL(name, directory), 'utf8'));
  const tied = computeCells(await load('04-ties-and-medals.ndjson'), { frozen: false }).standings;
  const a = tied.find((row) => row.teamId === 'team-1'), b = tied.find((row) => row.teamId === 'team-2');
  assert.equal(a.solved, b.solved); assert.equal(a.time, b.time); assert.equal(a.rank, b.rank);
  const hydro = await load('05-hydro-starred.ndjson');
  assert.equal(hydro.scoringMode, 'hydro');
  assert.equal(hydro.teams.find((team) => team.id === 'S01').unrank, true);
  assert.equal(computeCells(hydro, { frozen: false }).standings[0].timeSeconds, 16274);
});
