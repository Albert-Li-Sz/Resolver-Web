import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LiveSessionStore } from '../server/lib/live-session.js';
import { atomicWrite } from '../server/lib/files.js';
import { buildGame } from '../server/lib/engine.js';
import { createDemo } from '../server/lib/demo.js';
import { createAssetStore } from '../server/lib/assets.js';
import { createRemoteMediaCache } from '../server/lib/remote-media.js';
import { prepareOfflineContest } from '../public/js/offline-media.js';
import { displayGeometry, normalizeDisplay } from '../public/js/display-settings.js';
import { ResolverView } from '../public/js/render/resolver-view.js';
const demo = createDemo();
const game = buildGame(demo.contest, { ...demo.options, showAwards: true });
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2ioAAAAASUVORK5CYII=', 'base64');
async function directory(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'resolver-resilience-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('durable live show restores exact award progress and control capability; previews stay ephemeral', async (t) => {
  const dir = await directory(t);
  const store = new LiveSessionStore({ directory: dir });
  await store.restore();
  const entry = store.create(game); await store.publish(entry);
  const index = entry.game.steps.findIndex((s) => s.screen === 'teamAward');
  assert.ok(index > 0);
  await store.move(entry, index, 0);
  store.create(game);
  const recovered = new LiveSessionStore({ directory: dir }); await recovered.restore();
  const saved = recovered.current();
  assert.equal(saved.id, entry.id); assert.equal(saved.controlToken, entry.controlToken);
  assert.deepEqual(recovered.playback(saved), store.playback(entry));
  assert.deepEqual(recovered.snapshot(saved), JSON.parse(JSON.stringify(store.snapshot(entry))));
  assert.equal(recovered.games.size, 1);
  assert.equal((await recovered.move(saved, saved.actions[0], 0)).status, 409);
  assert.equal((await recovered.move(saved, saved.actions[0], 1)).playback.revision, 2);
});

test('disk failure does not advance or broadcast; competing writes serialize before acknowledgment', async (t) => {
  const dir = await directory(t); let fail = false;
  const store = new LiveSessionStore({ directory: dir, write: async (...args) => { if (fail) throw new Error('disk full'); await atomicWrite(...args); } });
  const entry = store.create(game); await store.publish(entry);
  const messages = []; entry.clients.add({ writableLength: 0, write: (s) => messages.push(s) });
  fail = true;
  await assert.rejects(store.move(entry, entry.actions[1], 0), /disk full/);
  assert.equal(entry.revision, 0); assert.equal(messages.length, 0);
  fail = false;
  const results = await Promise.all([store.move(entry, entry.actions[1], 0), store.move(entry, entry.actions[2], 0)]);
  assert.equal(results[0].playback.revision, 1); assert.equal(results[1].status, 409); assert.equal(messages.length, 1);
  const saved = JSON.parse(await readFile(path.join(dir, 'current.json')));
  assert.equal(saved.revision, 1); assert.equal(saved.index, entry.actions[1]);
});

test('failed replacement keeps previous live show; corrupt checkpoint is preserved', async (t) => {
  const dir = await directory(t); let fail = false;
  const store = new LiveSessionStore({ directory: dir, write: async (file, data) => {
    if (fail && file.endsWith('current.json')) throw new Error('disk full'); await atomicWrite(file, data);
  } });
  const first = store.create(game); await store.publish(first);
  const second = store.create(game); fail = true; await assert.rejects(store.publish(second));
  assert.equal(store.current().id, first.id);
  const restore = new LiveSessionStore({ directory: dir }); await restore.restore();
  assert.equal(restore.current().id, first.id);
  assert.ok(!(await readdir(dir)).includes(`${second.id}.json`));
  await writeFile(path.join(dir, 'current.json'), '{invalid');
  await assert.rejects(new LiveSessionStore({ directory: dir }).restore(), /损坏/);
  assert.equal(await readFile(path.join(dir, 'current.json'), 'utf8'), '{invalid');
});

test('remote images reuse durable cache with no internet and recover missing local files', async (t) => {
  const dir = await directory(t), imageDirectory = path.join(dir, 'images');
  const { saveImage: save } = createAssetStore(imageDirectory);
  let calls = 0;
  const options = { directory: dir, imageDirectory, save, fetchImage: async () => { calls++; return { buffer: pixel, contentType: 'image/png' }; } };
  const cache = createRemoteMediaCache(options);
  const first = await cache(['https://school.test/a.png', 'https://school.test/a.png']);
  assert.equal(calls, 1); assert.equal(first.items.length, 1);
  const offline = createRemoteMediaCache({ ...options, fetchImage: async () => { throw new Error('offline'); } });
  assert.equal((await offline(['https://school.test/a.png'])).items[0].url, first.items[0].url);
  await rm(path.join(imageDirectory, path.basename(first.items[0].url)));
  assert.ok((await offline(['https://school.test/a.png'])).items[0].error);
  assert.ok((await offline([first.items[0].url])).items[0].error);
  await assert.rejects(cache(Array(13).fill('https://school.test/a.png')), { status: 400 });
  await assert.rejects(cache(['file:///etc/passwd']), { status: 400 });
});

test('offline preparation preserves editable sources and survives normalization without remote URLs', async () => {
  const contest = { name: 'Offline', teams: [{ id: 'a', organizationId: 'pku', photo: 'https://photos.test/a.jpg' }, { id: 'b', name: '北京大学' }],
    organizations: [{ id: 'pku', name: '北京大学' }], problems: [{ id: 'p' }] };
  const prepared = await prepareOfflineContest(contest, { request: async (urls) => ({ items: urls.map((source) => ({ source, error: 'offline' })) }) });
  assert.ok(prepared.report.failed >= 2);
  assert.equal(contest.teams[0].photo, 'https://photos.test/a.jpg');
  const normalized = buildGame(prepared.contest).contest;
  assert.equal(normalized.teams[0].logo, '/assets/img/icpc-logo.png');
  assert.equal(normalized.organizations[0].logo, '/assets/img/icpc-logo.png');
  assert.equal(normalized.teams[1].logo, '/assets/img/icpc-logo.png');
  assert.ok(!normalized.teams[0].photo);
  let requests = 0;
  const many = { teams: Array.from({ length: 30 }, (_, id) => ({ id: String(id), photo: `https://photos.test/${id}.jpg` })) };
  let now = 0;
  const bounded = await prepareOfflineContest(many, { timeout: 5, now: () => now, request: async () => { requests++; now = 10; return { items: [] }; } });
  assert.equal(requests, 1); assert.equal(bounded.report.failed, 30);
});

test('32:9 upper-half LED output, safe margins and renderer columns stay aligned', (t) => {
  const previousImage = globalThis.Image;
  globalThis.Image = class {};
  t.after(() => { globalThis.Image = previousImage; });
  const region = displayGeometry({ region: 'top', aspect: 'auto', margin: 5 }, 1920, 1080);
  assert.deepEqual(region, { left: 96, top: 27, width: 1728, height: 486, logicalWidth: 3840, logicalHeight: 1080 });
  const custom = normalizeDisplay({ region: 'custom', x: 90, y: 90, width: 200, height: 200, margin: 99 });
  assert.equal(custom.width, 10); assert.equal(custom.height, 10); assert.equal(custom.margin, 15);
  const canvas = { style: {}, dataset: { logicalWidth: '3840' }, getContext: () => ({ measureText: () => ({ width: 20 }) }) };
  const view = new ResolverView(canvas, game);
  assert.equal(canvas.width, 5120); assert.equal(canvas.height, 1440);
  assert.ok(Math.abs(view.layout.solvedCenter - view.layout.headerSolvedCenter) < 8);
  assert.ok(view.layout.timeCenter > 3700 && view.layout.timeCenter < 3840);
  const before = view.captureState();
  canvas.dataset.logicalWidth = '1440'; view.resize();
  assert.deepEqual(view.captureState(), before, 'calibration never advances the show');
  assert.ok(view.layout.timeCenter < 1440); view.dispose();
});


test('session capacity includes the persisted game ID, so accepted games remain restorable', () => {
  const store = new LiveSessionStore({ maxBytes: Buffer.byteLength(JSON.stringify(game)) });
  assert.throws(() => store.create(game), { status: 503 });
  assert.equal(store.games.size, 0);
});


test('remote catalog MIME mismatches cache the actual safe raster format', async (t) => {
  const dir = await directory(t), imageDirectory = path.join(dir, 'images');
  const { saveImage: save } = createAssetStore(imageDirectory);
  const cache = createRemoteMediaCache({ directory: dir, imageDirectory, save,
    fetchImage: async () => ({ buffer: pixel, contentType: 'image/webp' }) });
  const { items } = await cache(['https://catalog.test/mislabelled.webp']);
  assert.match(items[0].url, /\.png$/);
  assert.deepEqual(await readFile(path.join(imageDirectory, path.basename(items[0].url))), pixel);
  await assert.rejects(save(pixel, 'image/webp'), { status: 400 }, 'raw uploads still require the declared format to match');
});
