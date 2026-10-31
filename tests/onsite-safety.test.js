import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PlatformStore } from '../server/platform/store.js';
import { currentContent, previousContent } from '../server/platform/emergency.js';
import { readHealth, healthState, MediaMonitor } from '../server/platform/health.js';
import http from 'node:http';
import { presentationWord } from '../public/js/render/presentation-locale.js';

async function setup(t) {
  let now = 10000;
  const directory = await mkdtemp(path.join(tmpdir(), 'resolver-onsite-'));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const store = new PlatformStore({ directory, now: () => now });
  await store.restore();
  const w = await store.createWorkspace({ name: 'Finals' });
  await store.activate(w.id);
  return { store, setTime: value => { now = value; }, directory };
}
async function preview(s, title) {
  await s.change(() => { s.state.broadcast.preview = { ...s.state.broadcast.preview, title }; s.state.broadcast.revision++; });
}
async function screen(s) { const d = await s.register(); await s.pair({ code: d.code }); return s.state.displays.find(v => v.id === d.id); }
async function cmd(s, d, action, other = {}) { return s.command({ ids: [d.id], revisions: { [d.id]: d.revision }, action, ...other }); }
const program = text => ({ items: [{ type: 'message', text, duration: 10 }, { type: 'clock', duration: 10 }], loop: true });

test('live standby preserves preview and previous scene; rollback consumes one history entry', async t => {
  const { store: s } = await setup(t);
  await preview(s, 'A'); await s.takeBroadcast({ revision: s.state.broadcast.revision });
  await preview(s, 'B'); await s.takeBroadcast({ revision: s.state.broadcast.revision });
  await preview(s, 'Draft');
  await s.standbyBroadcast({ revision: s.state.broadcast.revision, enabled: true });
  const revision = s.state.broadcast.revision;
  await s.standbyBroadcast({ revision, enabled: true });
  assert.equal(s.state.broadcast.revision, revision);
  assert.equal(s.state.broadcast.program.title, 'B');
  assert.equal(s.state.broadcast.previousProgram.scene.title, 'A');
  assert.equal(s.publicState().broadcast.mode, 'standby');
  assert.deepEqual(s.publicState().media, []);
  await s.rollbackBroadcast({ revision });
  assert.equal(s.state.broadcast.program.title, 'A');
  assert.equal(s.state.broadcast.preview.title, 'Draft');
  assert.equal(s.state.broadcast.mode, 'program');
  assert.equal(s.state.broadcast.previousProgram, null);
  await assert.rejects(s.rollbackBroadcast({ revision: s.state.broadcast.revision }), { status: 409 });
});
test('concurrent live control requests accept one version and leave preview untouched', async t => {
  const { store: s } = await setup(t);
  const revision = s.state.broadcast.revision;
  const results = await Promise.allSettled([s.standbyBroadcast({ revision, enabled: true }), s.takeBroadcast({ revision })]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.status, 409);
});
test('standby and rollback histories survive service restart; contest replacement invalidates history', async t => {
  const { store: s, directory } = await setup(t);
  await preview(s, 'A'); await s.takeBroadcast({ revision: s.state.broadcast.revision });
  await preview(s, 'B'); await s.takeBroadcast({ revision: s.state.broadcast.revision });
  await s.standbyBroadcast({ revision: s.state.broadcast.revision, enabled: true });
  const restored = new PlatformStore({ directory }); await restored.restore();
  assert.equal(restored.state.broadcast.mode, 'standby');
  await restored.rollbackBroadcast({ revision: restored.state.broadcast.revision });
  assert.equal(restored.state.broadcast.program.title, 'A');
  const w = await restored.createWorkspace({ name: 'Another' });
  await restored.activate(w.id);
  assert.equal(restored.state.broadcast.previousProgram, null);
  await assert.rejects(restored.rollbackBroadcast({ revision: restored.state.broadcast.revision }), { status: 409 });
});
test('screen standby resumes its original real-time timeline and leaves black and output geometry intact', async t => {
  const { store: s, setTime } = await setup(t); const d = await screen(s);
  await cmd(s, d, 'apply', { program: program('A') });
  const started = d.startedAt;
  setTime(12000); await cmd(s, d, 'hide');
  await cmd(s, d, 'configure', { outputProfile: { resolution: '2160p', aspect: '32:9' } });
  await cmd(s, d, 'standby'); const revision = d.revision;
  await cmd(s, d, 'standby'); assert.equal(d.revision, revision);
  setTime(42000); await cmd(s, d, 'restore');
  assert.equal(d.startedAt, started);
  assert.equal(d.mode, 'program');
  assert.equal(d.hidden, true);
  assert.equal(d.outputProfile.aspect, '32:9');
  assert.equal(d.direct, true);
});
test('rapid scheduled programs remember the last program actually on air, never an unseen target', async t => {
  const { store: s, setTime } = await setup(t); const d = await screen(s);
  await cmd(s, d, 'apply', { program: program('A') }); setTime(11000);
  await cmd(s, d, 'apply', { program: program('B') }); setTime(11200);
  assert.equal(currentContent(d, 11200).program.items[0].text, 'A');
  await cmd(s, d, 'apply', { program: program('C') });
  setTime(12200);
  assert.equal(previousContent(d, 12200).program.items[0].text, 'A');
  await cmd(s, d, 'rollback');
  assert.equal(d.program.items[0].text, 'A');
  assert.equal(d.startedAt, 10750);
  assert.equal(previousContent(d, 12200), null);
  await assert.rejects(cmd(s, d, 'rollback'), { status: 409 });
});
test('paused program stays paused across standby and real-time rollback', async t => {
  const { store: s, setTime } = await setup(t); const d = await screen(s);
  await cmd(s, d, 'apply', { program: program('A') }); setTime(14000); await cmd(s, d, 'pause');
  const offset = d.offset;
  await cmd(s, d, 'standby'); setTime(40000); await cmd(s, d, 'restore');
  assert.equal(d.paused, true); assert.equal(d.offset, offset);
  setTime(42000); await cmd(s, d, 'apply', { program: program('B') });
  setTime(44000); await cmd(s, d, 'rollback');
  assert.equal(d.paused, true); assert.equal(d.offset, offset);
});
test('new contests use Chinese, legacy contests use English, and locale changes do not reset a running program', async t => {
  const { store: s } = await setup(t); const d = await screen(s);
  assert.equal(s.publicState().presentationLocale, 'zh-CN');
  const w = s.workspace(); delete w.presentationLocale;
  assert.equal(s.workspaceAdmin(w).presentationLocale, 'en');
  await cmd(s, d, 'apply', { program: program('A') }); const start = d.startedAt;
  await s.updateWorkspace(w.id, { configRevision: 0, presentationLocale: 'en' });
  assert.equal(s.publicState().presentationLocale, 'en'); assert.equal(d.startedAt, start);
  await assert.rejects(s.updateWorkspace(w.id, { configRevision: 1, presentationLocale: 'other' }), { status: 400 });
  assert.equal(presentationWord('zh-CN', 'penalty'), '罚时');
  assert.equal(presentationWord('zh-CN', 'solveTime'), '用时');
});
test('health reports are bounded, redact arbitrary data, and never mistake an unchanged static picture for a freeze', () => {
  const raw = { visible: true, uptimeMs: 30000, renderAgeMs: 20, thumbnailAgeMs: 100, media: [], password: 'private', url: 'rtsp://private' };
  const health = readHealth(raw);
  assert.equal(health.password, undefined); assert.equal(health.url, undefined);
  assert.equal(healthState({ seenAt: 10000, health }, 15001).renderer, 'healthy');
  assert.equal(healthState({ seenAt: 10000, health }, 25000).renderer, 'offline');
  assert.equal(healthState({ seenAt: 10000 }, 10000).renderer, 'unknown');
  assert.equal(healthState({ seenAt: 10000, health: { ...health, renderAgeMs: 6000 } }, 10000).renderer, 'stalled');
  assert.equal(healthState({ seenAt: 10000, health: { ...health, visible: false, renderAgeMs: 6000 } }, 10000).renderer, 'background');
  assert.equal(healthState({ seenAt: 10000, health: { ...health, thumbnailAgeMs: 21000 } }, 10000).thumbnail, 'stale');
  assert.throws(() => readHealth({ media: Array(13).fill({}) }), { status: 400 });
  assert.equal(healthState({ seenAt: 10000, health: { ...health, uptimeMs: 1000, renderAgeMs: null } }, 10000).renderer, 'loading');
  assert.equal(healthState({ seenAt: 10000, health: { ...health, uptimeMs: 16000, renderAgeMs: null } }, 10000).renderer, 'stalled');
});
test('media diagnostics only expose bounded task status and distinguish service failure', async t => {
  let fail = false;
  const server = http.createServer((req, res) => {
    assert.equal(req.headers['x-media-key'], 'test-monitor-key');
    res.writeHead(fail ? 503 : 200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ jobs: [{ id: 'a'.repeat(32), status: 'reconnecting', transcoding: true, videoCodec: 'h264', source: 'rtsp://private', args: ['secret'], password: 'secret' }] }));
  });
  server.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  const old = { url: process.env.MEDIA_WORKER_URL, key: process.env.MEDIA_INTERNAL_KEY };
  process.env.MEDIA_WORKER_URL = `http://127.0.0.1:${server.address().port}`; process.env.MEDIA_INTERNAL_KEY = 'test-monitor-key';
  let sampled;
  const first = new Promise(r => sampled = r), store = { emit: () => sampled() };
  const monitor = new MediaMonitor(store);
  t.after(() => { monitor.close(); server.closeAllConnections(); server.close(); for (const [key, value] of Object.entries({ MEDIA_WORKER_URL: old.url, MEDIA_INTERNAL_KEY: old.key })) if (value === undefined) delete process.env[key]; else process.env[key] = value; });
  await first;
  assert.equal(store.mediaHealth.status, 'connected'); assert.equal(store.mediaHealth.jobs[0].status, 'reconnecting'); assert.equal(store.mediaHealth.jobs[0].transcoding, true);
  assert.doesNotMatch(JSON.stringify(store.mediaHealth), /private|secret|args|password/);
  fail = true; await monitor.sample(); assert.equal(store.mediaHealth.status, 'unavailable'); assert.deepEqual(store.mediaHealth.jobs, []);
});
