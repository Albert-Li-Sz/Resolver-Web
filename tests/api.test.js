import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createDemo } from '../server/lib/demo.js';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import http from 'node:http';

const directory = await mkdtemp(path.join(tmpdir(), 'resolver-api-'));
process.env.RESOLVER_DATA_DIR = directory;
const { app } = await import('../server/index.js');
after(() => rm(directory, { recursive: true, force: true }));

async function serve(t) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  return `http://127.0.0.1:${server.address().port}`;
}
const json = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('presenter authorization, persisted progress and live read-only spectator endpoints', async (t) => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const demo = createDemo();
  const response = await fetch(`${base}/api/game`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(demo),
  });
  const created = await response.json();
  const { id, controlToken, game } = created;
  assert.ok(controlToken);
  const headers = { 'Content-Type': 'application/json', 'X-Resolver-Control': controlToken };
  assert.equal((await fetch(`${base}/api/game/${id}`)).status, 403);
  const forbidden = await fetch(`${base}/api/game/${id}/playback`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{"index":10,"revision":0}' });
  assert.equal(forbidden.status, 403);
  const before = await (await fetch(`${base}/api/watch/${id}`)).json();
  assert.equal(before.game.steps.some((step) => step.type === 'resolve'), false);
  assert.deepEqual(before.game.contest.awards, []);
  const controller = new AbortController();
  const stream = await fetch(`${base}/api/watch/${id}/events`, { signal: controller.signal });
  assert.match(stream.headers.get('content-type'), /text\/event-stream/);
  const reader = stream.body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  const readEvent = async () => {
    while (!buffered.includes('\n\n')) {
      const { done, value } = await reader.read();
      assert.equal(done, false, 'SSE stream ended before the complete event');
      buffered += decoder.decode(value, { stream: true });
    }
    const end = buffered.indexOf('\n\n') + 2;
    const event = buffered.slice(0, end); buffered = buffered.slice(end);
    return event;
  };
  const initial = await readEvent();
  assert.match(initial, /^event: snapshot/);
  const target = game.steps.findIndex((step) => step.type === 'resolve');
  const moved = await (await fetch(`${base}/api/game/${id}/playback`, { method: 'PUT', headers, body: JSON.stringify({ index: target, revision: 0 }) })).json();
  assert.equal(moved.playback.revision, 1);
  const event = await readEvent();
  assert.match(event, /event: snapshot/);
  assert.ok(event.includes(`"index":${target}`));
  controller.abort();
  const restored = await (await fetch(`${base}/api/game/${id}`, { headers })).json();
  assert.equal(restored.playback.index, target);
  const late = await (await fetch(`${base}/api/watch/${id}`)).json();
  assert.equal(late.playback.index, target);
  assert.equal(late.game.steps.filter((step) => step.type === 'resolve').length, 1);
  const conflict = await fetch(`${base}/api/game/${id}/playback`, { method: 'PUT', headers, body: JSON.stringify({ index: target, revision: 0 }) });
  assert.equal(conflict.status, 409);
  assert.equal((await fetch(`${base}/api/watch/nonexistent`)).status, 404);
});

test('HTTP input validation, raw feed upload, safe errors, cache headers and real 404s', async (t) => {
  const base = await serve(t);
  const reboundStatus = await new Promise((resolve, reject) => {
    http.get(`${base}/api/configs`, { headers: { Host: 'untrusted.example' } }, (res) => { res.resume(); resolve(res.statusCode); }).on('error', reject);
  });
  assert.equal(reboundStatus, 403, 'loopback sockets alone do not authorize DNS-rebound hostnames');
  for (const route of ['/api/health', '/api/configs', '/api/media-library']) {
    const res = await fetch(base + route);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
  }
  for (const route of ['/media/deadbeef.png', '/missing.js', '/api/missing', '/api/demo']) assert.equal((await fetch(base + route)).status, 404, route);
  for (const body of [{ teams: [null], problems: [] }, { teams: [{ id: 'a' }, { id: 'a' }], problems: [] }]) {
    const res = await fetch(`${base}/api/game`, json({ contest: body }));
    assert.equal(res.status, 400);
    assert.equal('details' in await res.json(), false);
  }
  const invalid = await fetch(`${base}/api/parse`, { method: 'POST', headers: { 'Content-Type': 'application/x-ndjson' }, body: 'INTERNAL-SECRET' });
  const error = await invalid.json();
  assert.equal(invalid.status, 400);
  assert.doesNotMatch(JSON.stringify(error), /SECRET|Unexpected|details/);
  const text = [{ type: 'team', data: { id: 't' } }, { type: 'problem', data: { id: 'p' } }].map(JSON.stringify).join('\n');
  const parsed = await fetch(`${base}/api/parse`, { method: 'POST', headers: { 'Content-Type': 'application/x-ndjson' }, body: text });
  assert.equal(parsed.status, 200);
  assert.equal((await parsed.json()).stats.teams, 1);
  const badJSON = await fetch(`${base}/api/game`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{SECRET' });
  assert.equal(badJSON.status, 400);
  assert.doesNotMatch(JSON.stringify(await badJSON.json()), /SECRET|details/);
  await writeFile(path.join(directory, 'media-library.json'), '{STORED-SECRET');
  const damaged = await fetch(`${base}/api/media-library`);
  assert.equal(damaged.status, 500);
  assert.deepEqual(await damaged.json(), { error: '服务器处理失败' });
  await rm(path.join(directory, 'media-library.json'));
});

test('management authentication covers reads/writes while viewers and presenter capabilities remain independent', async (t) => {
  const base = await serve(t);
  process.env.RESOLVER_ADMIN_KEY = 'fixture-admin-key';
  t.after(() => { delete process.env.RESOLVER_ADMIN_KEY; });
  for (const route of ['/', '/api/demo', '/api/configs', '/API/CONFIGS', '/api/media-library']) assert.equal((await fetch(base + route)).status, 401, route);
  for (const route of ['/api/parse', '/api/fetch', '/api/game', '/API/GAME', '/api/awards', '/api/assets', '/api/configs', '/api/media-library']) assert.equal((await fetch(base + route, json({}))).status, 401, route);
  const headers = { 'Content-Type': 'application/json', Authorization: `Basic ${Buffer.from('admin:fixture-admin-key').toString('base64')}` };
  const response = await fetch(`${base}/api/game`, { ...json(createDemo()), headers });
  assert.equal(response.status, 200);
  const { id, controlToken } = await response.json();
  assert.equal((await fetch(`${base}/api/watch/${id}`)).status, 200);
  assert.equal((await fetch(`${base}/api/game/${id}`)).status, 403);
  assert.equal((await fetch(`${base}/api/game/${id}/playback`, { headers: { 'X-Resolver-Control': controlToken } })).status, 200);
  const cross = await fetch(`${base}/api/game`, { ...json(createDemo()), headers: { ...headers, Origin: 'https://malicious.example' } });
  assert.equal(cross.status, 403);
  const proxied = await fetch(`${base}/api/awards`, { ...json(createDemo()), headers: { ...headers, Origin: base.replace('http:', 'https:') } });
  assert.equal(proxied.status, 200, 'HTTPS proxy origins retain management writes when Host is preserved');
});

test('anonymous local game floods cannot displace a current presenter', async (t) => {
  const base = await serve(t);
  const small = { contest: { teams: [{ id: 'a' }], problems: [{ id: 'p' }] } };
  const created = await (await fetch(`${base}/api/game`, json(small))).json();
  let refused = 0;
  for (let i = 0; i < 82; i++) {
    const response = await fetch(`${base}/api/game`, json(small));
    assert.ok([200, 503].includes(response.status));
    if (response.status === 503) refused++;
    await response.arrayBuffer();
  }
  assert.ok(refused > 0);
  assert.equal((await fetch(`${base}/api/game/${created.id}`, { headers: { 'X-Resolver-Control': created.controlToken } })).status, 200);
});
