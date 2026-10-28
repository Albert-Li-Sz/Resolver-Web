import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGame, normalizeContest, parseEventFeed } from '../server/lib/engine.js';
import { SessionStore } from '../server/lib/sessions.js';
import { ResolverView } from '../public/js/render/resolver-view.js';

test('shared detail awards reveal only the presented recipient in snapshots and incremental events', () => {
  const game = buildGame({ name: 'Shared award', durationMs: 600_000, freezeDurationMs: 300_000,
    teams: [{ id: 'a' }, { id: 'b' }], problems: [{ id: 'p' }],
    submissions: [{ id: 's', teamId: 'a', problemId: 'p', contestTime: 400_000, status: 'solved' }],
    awards: [{ id: 'medal-gold', citation: 'Gold', teamIds: ['a', 'b'] },
      { id: 'finalists', citation: 'Finalists', teamIds: ['a', 'b'], displayMode: 'list' }],
  }, { showAwards: true });
  const store = new SessionStore();
  const entry = store.create(game);
  const messages = [];
  entry.clients.add({ writableLength: 0, write: (message) => messages.push(message) });
  const index = game.steps.findIndex((s) => s.type === 'presentation' && s.screen === 'teamAward');
  const pos = entry.actions.indexOf(index);
  store.move(entry, entry.actions[pos - 1], 0);
  store.move(entry, index, 1);
  assert.equal(game.steps[index].teamId, 'b');
  const snapshot = store.snapshot(entry);
  assert.ok(!snapshot.game.steps.some((s) => s.type === 'resolve' && s.teamId === 'a'));
  assert.deepEqual(snapshot.game.steps.at(-1).awards[0].teamIds, ['b']);
  const event = JSON.parse(messages.at(-1).split('data: ')[1]);
  assert.deepEqual(event.steps.at(-1).awards[0].teamIds, ['b']);
  assert.deepEqual(game.steps[index].awards[0].teamIds, ['a', 'b'], 'presenter data stays complete');
  store.move(entry, entry.actions[pos + 1], 2);
  assert.deepEqual(store.snapshot(entry).game.steps.at(-1).awards[0].teamIds, ['b']);
  const listIndex = game.steps.findIndex((s) => s.screen === 'teamList');
  store.move(entry, listIndex, 3);
  assert.deepEqual(store.snapshot(entry).game.steps.at(-1).awards[0].teamIds, ['a', 'b']);
  store.move(entry, entry.actions[0], 4);
  assert.ok(!store.snapshot(entry).game.steps.some((s) => s.awards?.length));
});

test('legacy event IDs survive creates, partial updates and deletes when data has no ID', () => {
  const parsed = parseEventFeed(JSON.stringify([
    { type: 'organization', id: 'org', data: { name: 'Test University' } },
    { type: 'team', id: 'a', data: { name: 'Alpha', organization_id: 'org' } },
    { type: 'team', id: 'b', data: { name: 'Beta' } },
    { type: 'team', id: 'a', op: 'update', data: { display_name: 'Updated Alpha' } },
    { type: 'team', id: 'removed', data: { name: 'Removed' } },
    { type: 'team', id: 'removed', op: 'delete' },
    { type: 'problem', id: 'p', data: { label: 'X' } },
    { type: 'judgement-type', id: 'AC', data: { solved: true, penalty: false } },
    { type: 'submission', id: 's', data: { team_id: 'a', problem_id: 'p', contest_time: 1000 } },
    { type: 'judgement', id: 'j', data: { submission_id: 's', judgement_type_id: 'AC' } },
  ]));
  assert.deepEqual(parsed.teams.map((team) => team.id), ['a', 'b']);
  assert.equal(parsed.teams[0].displayName, 'Updated Alpha');
  assert.equal(parsed.organizations[0].id, 'org');
  assert.equal(parsed.problems[0].id, 'p');
  assert.equal(parsed.submissions[0].status, 'solved');
  assert.equal(buildGame(parsed).initialState.results.a[0].status, 'solved');
});

test('generated record IDs never collide with explicit IDs and normalization is stable', () => {
  const contest = normalizeContest({ teams: [{}, { id: 'team-0' }], problems: [{}, { id: 'problem-0' }],
    organizations: [{}, { id: 'org-0' }],
    submissions: [{ teamId: 'team-0', problemId: 'problem-0', contestTime: 1000, status: 'solved' },
      { id: 'submission-0', teamId: 'team-0', problemId: 'problem-0', contestTime: 2000, status: 'solved' }],
    awards: [{ teamIds: ['team-0'] }, { id: 'award-0', teamIds: ['team-0'] }],
  });
  for (const field of ['teams', 'problems', 'organizations', 'submissions', 'awards']) {
    assert.equal(new Set(contest[field].map((record) => record.id)).size, contest[field].length, field);
  }
  assert.deepEqual(normalizeContest(contest), contest);
  const game = buildGame(contest);
  assert.equal(Object.keys(game.initialState.results).length, 2);
  assert.equal(game.initialState.results['team-0'].filter((cell) => cell.status === 'solved').length, 1);
});

test('view disposal releases resize listeners and images; team photos load on demand', (t) => {
  const listeners = new Set();
  const images = [];
  const oldWindow = globalThis.window;
  const oldImage = globalThis.Image;
  globalThis.window = { addEventListener: (event, handler) => listeners.add(handler),
    removeEventListener: (event, handler) => listeners.delete(handler) };
  globalThis.Image = class { constructor() { images.push(this); } };
  t.after(() => { globalThis.window = oldWindow; globalThis.Image = oldImage; });
  const game = buildGame({ teams: [{ id: 'a', photo: 'https://example.test/a.jpg' }], problems: [{ id: 'p' }] });
  const canvas = { style: {}, dataset: {}, getContext: () => ({ measureText: () => ({ width: 10 }) }) };
  const view = new ResolverView(canvas, game);
  assert.equal(listeners.size, 1);
  assert.ok(!images.some((image) => image.src === game.contest.teams[0].photo), 'opening a board does not download every team photo');
  view._image(game.contest.teams[0].photo);
  assert.ok(images.some((image) => image.src === game.contest.teams[0].photo));
  view.dispose();
  view.dispose();
  assert.equal(listeners.size, 0);
  assert.equal(view._images.size, 0);
  assert.ok(images.every((image) => image.onload == null && image.onerror == null));
});
