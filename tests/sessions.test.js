import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionStore } from '../server/lib/sessions.js';
import { buildGame } from '../server/lib/engine.js';
import { createDemo } from '../server/lib/demo.js';
import { EventEmitter } from 'node:events';

const demo = createDemo();
const game = buildGame(demo.contest, { ...demo.options, showAwards: true });

test('spectator snapshots contain only revealed steps and no future award recipients', () => {
  const store = new SessionStore();
  const entry = store.create(game);
  const before = store.snapshot(entry);
  assert.deepEqual(before.game.contest.awards, []);
  assert.equal(before.game.steps.length, entry.index + 1);
  assert.equal(before.game.steps.some((step) => step.type === 'resolve'), false);
  assert.equal('controlToken' in before, false);
  const index = entry.game.steps.findIndex((step) => step.type === 'resolve');
  const moved = store.move(entry, index, 0);
  assert.equal(moved.playback.index, index);
  assert.equal(store.snapshot(entry).game.steps.filter((step) => step.type === 'resolve').length, 1);
  store.move(entry, entry.actions[0], 1);
  assert.equal(store.snapshot(entry).game.steps.some((step) => step.type === 'resolve'), false);
});

test('SSE connection budgets, cached snapshots and initial backpressure are enforced', () => {
  const store = new SessionStore({ maxClients: 2, maxClientsPerGame: 1 });
  const a = store.create(game), b = store.create(game);
  assert.ok(store.canSubscribe(a));
  a.clients.add({});
  assert.equal(store.canSubscribe(a), false);
  assert.ok(store.canSubscribe(b));
  b.clients.add({});
  const c = store.create(game);
  assert.equal(store.canSubscribe(c), false);
  const before = store.snapshotMessage(c);
  assert.equal(before, store.snapshotMessage(c));
  store.move(c, c.actions[1], 0);
  assert.notEqual(before, store.snapshotMessage(c));
  const client = new EventEmitter();
  client.writableLength = 0;
  client.write = () => { client.writableLength = 2 * 1024 * 1024; return false; };
  client.destroy = () => { client.destroyed = true; client.emit('close'); };
  store.send(client, before);
  assert.ok(client.destroyed, 'even the first snapshot observes the buffer budget');
  assert.equal(client.listenerCount('drain'), 0);
  const unicode = new EventEmitter();
  unicode.writableLength = 0;
  const chunks = [];
  unicode.write = (chunk) => { chunks.push(Buffer.from(chunk)); return true; };
  const message = 'a'.repeat(16_383) + '🏆';
  store.send(unicode, message);
  assert.equal(Buffer.concat(chunks).toString(), message, 'SSE chunks never split surrogate pairs');
});

test('playback validates indices and rejects stale competing presenter writes', () => {
  const store = new SessionStore();
  const entry = store.create(game);
  for (const index of [-1, 1.5, NaN, '5', 999999]) {
    assert.equal(store.move(entry, index, 0).status, 400);
  }
  assert.equal(store.move(entry, entry.actions[1], 0).playback.revision, 1);
  assert.equal(store.move(entry, entry.actions[2], 0).status, 409);
  assert.equal(entry.index, entry.actions[1]);
});

test('live SSE uses incremental steps for next and full snapshots for rewind', () => {
  const store = new SessionStore();
  const entry = store.create(game);
  const messages = [];
  entry.clients.add({ write: (message) => messages.push(message), writableLength: 0 });
  store.move(entry, entry.actions[1], 0);
  assert.match(messages[0], /^event: advance/);
  store.move(entry, entry.actions[0], 1);
  assert.match(messages[1], /^event: snapshot/);
});

test('jump and rewind build one shared spectator snapshot per revision', () => {
  const store = new SessionStore();
  const entry = store.create(game);
  let snapshots = 0;
  const snapshot = store.snapshot.bind(store);
  store.snapshot = (...args) => { snapshots++; return snapshot(...args); };
  store.move(entry, entry.actions[3], 0);
  assert.equal(snapshots, 1);
  store.snapshotMessage(entry);
  assert.equal(snapshots, 1, 'reconnecting clients reuse the serialized snapshot');
  store.move(entry, entry.actions[0], 1);
  assert.equal(snapshots, 2);
});

test('expiry is checked on reads; reads keep live sessions alive and capacity stays bounded', () => {
  let now = 0;
  const store = new SessionStore({ ttl: 100, maxGames: 2, now: () => now });
  const a = store.create(game);
  now = 50;
  assert.ok(store.get(a.id));
  now = 110;
  assert.ok(store.get(a.id), 'last access, rather than creation, determines expiry');
  now = 211;
  assert.equal(store.get(a.id), undefined);
  store.create(game); store.create(game);
  assert.throws(() => store.create(game), { status: 503 });
  now += 100;
  store.create(game);
  store.create(game);
  assert.equal(store.games.size, 2);
});
