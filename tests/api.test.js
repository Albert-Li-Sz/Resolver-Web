import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createDemo } from '../server/lib/demo.js';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import http from 'node:http';
import { DEFAULT_SCHOOL_LOGO } from '../public/js/logos.js';

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

test('imported school logos reach both presenter and spectator games, with a served ICPC fallback', async (t) => {
  const base = await serve(t);
  const events = [
    { type: 'organization', data: { id: 'nx', name: '南京晓庄学院' } },
    { type: 'organization', data: { id: 'pku', name: 'Peking University' } },
    { type: 'organization', data: { id: 'unknown', name: '未知大学' } },
    ...['nx', 'pku', 'unknown'].map((id) => ({ type: 'team', data: { id, organization_id: id } })),
    { type: 'problem', data: { id: 'p' } },
  ];
  const parsed = await fetch(`${base}/api/parse`, { method: 'POST', headers: { 'Content-Type': 'application/x-ndjson' },
    body: events.map(JSON.stringify).join('\n') });
  assert.equal(parsed.status, 200);
  const { contest } = await parsed.json();
  assert.match(decodeURIComponent(contest.teams[0].logo), /南京晓庄学院\.webp/);
  assert.match(decodeURIComponent(contest.teams[1].logo), /北京大学\.webp/);
  assert.equal(contest.teams[2].logo, DEFAULT_SCHOOL_LOGO);
  const created = await (await fetch(`${base}/api/game`, json({ contest }))).json();
  const presenter = await (await fetch(`${base}/api/game/${created.id}`, { headers: { 'X-Resolver-Control': created.controlToken } })).json();
  const spectator = await (await fetch(`${base}/api/watch/${created.id}`)).json();
  assert.deepEqual(presenter.contest.teams.map((team) => team.logo), contest.teams.map((team) => team.logo));
  assert.deepEqual(spectator.game.contest.teams, presenter.contest.teams);
  const image = await fetch(base + DEFAULT_SCHOOL_LOGO);
  assert.equal(image.status, 200);
  assert.match(image.headers.get('content-type'), /image\/png/);
  assert.deepEqual(Buffer.from(await image.arrayBuffer()).subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
});

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

test('podium and selected-problem awards agree between the preview API, saved options, games and viewer steps', async (t) => {
  const base = await serve(t);
  const contest = { name: 'Combined awards', durationMs: 600_000, freezeDurationMs: 300_000,
    teams: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], problems: [{ id: 'p', label: 'X' }],
    submissions: [{ teamId: 'a', problemId: 'p', contestTime: 301_000, status: 'solved' }] };
  const options = { medalMode: 'custom', goldCount: 1, silverCount: 1, bronzeCount: 1, medalSameScore: false,
    podiumEnabled: true, championCitation: '总冠军', firstSolveMode: 'selected', firstSolveProblemIds: ['p'], showAwards: true };
  const preview = await (await fetch(`${base}/api/awards`, json({ contest, options }))).json();
  assert.equal(preview.awards.length, 7);
  assert.ok(preview.awards.some((award) => award.citation === '总冠军' && award.teamIds[0] === 'a'));
  assert.ok(preview.awards.some((award) => award.citation === 'X 题最快解题奖' && award.teamIds[0] === 'a'));
  const created = await (await fetch(`${base}/api/game`, json({ contest, options }))).json();
  assert.deepEqual(created.game.contest.awards, preview.awards);
  const saved = await (await fetch(`${base}/api/configs`, json({ name: 'Award options', config: options, contest }))).json();
  const restored = await (await fetch(`${base}/api/configs/${saved.id}`)).json();
  assert.deepEqual(restored.config.firstSolveProblemIds, ['p']);
  assert.equal(restored.config.podiumEnabled, true);
  const before = await (await fetch(`${base}/api/watch/${created.id}`)).json();
  assert.deepEqual(before.game.contest.awards, []);
  assert.ok(!before.game.steps.some((step) => step.type === 'award'));
  const index = created.game.steps.findIndex((step) => step.type === 'presentation' && step.screen === 'teamAward' &&
    step.awards.some((award) => award.id === 'first-to-solve-p'));
  const moved = await fetch(`${base}/api/game/${created.id}/playback`, { method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Resolver-Control': created.controlToken }, body: JSON.stringify({ index, revision: 0 }) });
  assert.equal(moved.status, 200);
  const after = await (await fetch(`${base}/api/watch/${created.id}`)).json();
  assert.ok(after.game.steps.some((step) => step.type === 'presentation' && step.awards?.some((award) => award.citation === 'X 题最快解题奖')));
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

test('/view is a public stable entrance and rehearsals cannot replace a published contest', async (t) => {
  const base = await serve(t);
  const before = await (await fetch(base + '/api/watch/current')).json();
  const payload = { contest: { name: 'Live entrance', teams: [{ id: 'a' }], problems: [{ id: 'p' }] } };
  const preview = await (await fetch(base + '/api/game', json(payload))).json();
  assert.deepEqual(await (await fetch(base + '/api/watch/current')).json(), before);
  const live = await (await fetch(base + '/api/game', json({ ...payload, publish: true }))).json();
  assert.equal((await (await fetch(base + '/api/watch/current')).json()).id, live.id);
  await fetch(base + '/api/game', json(payload));
  assert.notEqual(live.id, preview.id);
  process.env.RESOLVER_ADMIN_KEY = 'public-view-test';
  t.after(() => { delete process.env.RESOLVER_ADMIN_KEY; });
  for (const route of ['/view', '/view/', `/view?id=${live.id}`, '/watch.html']) {
    const response = await fetch(base + route);
    assert.equal(response.status, 200, route);
    assert.match(await response.text(), /js\/watch\.js/);
  }
  const current = await fetch(base + '/api/watch/current');
  assert.equal(current.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await current.json(), { id: live.id, name: 'Live entrance' });
  assert.equal((await fetch(base + '/api/configs')).status, 401);
  assert.equal((await fetch(base + `/api/game/${live.id}`)).status, 403);
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
