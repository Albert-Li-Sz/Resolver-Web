import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createMediaLibrary } from '../server/lib/media-library.js';
import { applyMediaLibrary, preserveContestMedia } from '../public/js/media-library.js';
import { buildGame } from '../server/lib/engine.js';

const asset = (letter) => `/media/${letter.repeat(64)}.png`;
const contest = { contestId: 'cup', name: 'Cup', teams: [{ id: 't1', name: 'Alpha', organizationId: 'o1' }, { id: 't2', name: 'Beta', organizationId: 'o1' }], organizations: [{ id: 'o1', name: 'University' }], problems: [{ id: 'A' }] };
const record = (id, kind, matchBy, key, letter = 'a') => ({ id, kind, matchBy, key, url: asset(letter) });

test('pre-contest media applies by exact ID/name; explicit team logos reach games', () => {
  const prepared = [record('org', 'organization-logo', 'name', 'University'), record('team', 'team-logo', 'id', 't1', 'b'), record('photo', 'team-photo', 'name', 'Alpha', 'c')];
  const result = applyMediaLibrary(contest, prepared);
  assert.equal(result.matched, 3); assert.deepEqual(result.unmatched, []);
  const game = buildGame(result.contest, {});
  assert.equal(game.contest.organizations[0].logo, asset('a'));
  assert.equal(game.contest.teams[0].logo, asset('b'));
  assert.equal(game.contest.teams[0].logoOverride, true);
  assert.equal(game.contest.teams[0].photo, asset('c'));
  assert.equal(contest.teams[0].logo, undefined);
});

test('ambiguous names are reported; ID takes precedence; missing matches are retained', () => {
  const input = { ...contest, teams: [{ id: 't1', name: 'Same' }, { id: 't2', name: 'Same' }] };
  const result = applyMediaLibrary(input, [record('ambiguous', 'team-logo', 'name', 'Same'), record('id', 'team-logo', 'id', 't1', 'b'), record('missing', 'organization-logo', 'name', 'Missing')]);
  assert.equal(result.matched, 1);
  assert.equal(result.contest.teams[0].logo, asset('b'));
  assert.equal(result.contest.teams[1].logo, undefined);
  assert.deepEqual(result.unmatched.map((r) => r.id), ['ambiguous', 'missing']);
  const exact = applyMediaLibrary(contest, [record('name', 'team-logo', 'name', 'Alpha'), record('id', 'team-logo', 'id', 't1', 'b')]);
  assert.equal(exact.contest.teams[0].logo, asset('b'));
  assert.match(exact.unmatched[0].reason, /ID/);
});

test('reimport keeps manual media only for the same contest, including cleared photos', () => {
  const previous = structuredClone(contest);
  previous.teams[0] = { ...previous.teams[0], logo: asset('a'), logoOverride: true, logoSource: 'manual', photo: null, photoOverride: true, photoSource: 'manual' };
  const incoming = structuredClone(contest); incoming.teams[0].photo = 'https://example.test/new.jpg';
  const kept = preserveContestMedia(previous, incoming);
  assert.equal(kept.preserved, 2); assert.equal(kept.contest.teams[0].logo, asset('a')); assert.equal(kept.contest.teams[0].photo, null);
  assert.equal(preserveContestMedia(previous, { ...incoming, contestId: 'different' }).preserved, 0);
});

test('media library persists concurrent upserts and survives a failed operation', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'resolver-library-'));
  try {
    const store = createMediaLibrary(dir);
    await Promise.all(Array.from({ length: 12 }, (_, i) => store.save(record('', 'team-logo', 'id', `t${i}`))));
    assert.equal((await store.list()).length, 12);
    const updated = await store.save(record('', 'team-logo', 'id', 't0', 'b'));
    assert.equal((await store.list()).length, 12);
    assert.equal((await store.list()).find((r) => r.key === 't0').url, asset('b'));
    await store.remove(updated.id); assert.equal((await store.list()).length, 11);
    assert.throws(() => store.save({ kind: '__proto__', matchBy: 'id', key: 'x', url: asset('a') }), { status: 400 });
    await writeFile(path.join(dir, 'media-library.json'), '{bad');
    await assert.rejects(store.save(record('', 'team-logo', 'id', 'new')));
    await writeFile(path.join(dir, 'media-library.json'), '{"items":[]}');
    await store.save(record('', 'team-logo', 'id', 'new')); assert.equal((await store.list()).length, 1);
  } finally { await rm(dir, { force: true, recursive: true }); }
});
