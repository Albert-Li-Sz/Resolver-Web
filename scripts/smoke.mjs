import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

const base = process.argv[2] || 'http://127.0.0.1:9080';
const mode = process.argv[3] || 'check';
const stateFile = process.env.RESOLVER_SMOKE_STATE || '/tmp/resolver-smoke-state.json';
const management = process.env.RESOLVER_ADMIN_KEY ? { 'X-Resolver-Admin': process.env.RESOLVER_ADMIN_KEY } : {};
async function request(route, options = {}, expected = 200) {
  const response = await fetch(new URL(route, base), { ...options, headers: { ...management, ...options.headers }, signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, expected, `${route}: HTTP ${response.status}`);
  return response.json();
}
const post = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

const health = await request('/api/health');
const expectedVersion = process.env.RESOLVER_EXPECTED_VERSION || JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version;
assert.equal(health.version, expectedVersion);
if (mode === 'verify-restart') {
  const saved = JSON.parse(await readFile(stateFile, 'utf8'));
  const preset = await request(`/api/configs/${saved.presetId}`);
  assert.equal(preset.contest.name, saved.contestName);
  assert.equal(preset.contest.teams.length, 18);
  const live = await request('/api/watch/current');
  assert.equal(live.id, saved.gameId);
  const audience = await request(`/api/watch/${saved.gameId}`);
  assert.equal(audience.playback.index, saved.index);
  assert.equal(audience.playback.revision, 1);
  const resumed = await request('/api/live/resume', { method: 'POST' });
  assert.equal(resumed.id, saved.gameId);
  const presenter = await request(`/api/game/${saved.gameId}`, { headers: { 'X-Resolver-Control': resumed.controlToken } });
  assert.equal(presenter.playback.index, saved.index);
  console.log('PASS: preset, live URL, public progress and presenter recovery survive service restart');
} else {
  await request('/api/demo', {}, 404);
  if (process.env.RESOLVER_ADMIN_KEY) {
    const anonymous = await fetch(new URL('/api/configs', base));
    assert.equal(anonymous.status, 401);
  }
  const text = await readFile(new URL('../examples/02-finals-18-teams.ndjson', import.meta.url), 'utf8');
  const parsed = await request('/api/parse', { method: 'POST', headers: { 'Content-Type': 'application/x-ndjson' }, body: text });
  assert.equal(parsed.contest.teams.length, 18);
  const options = { showAwards: true };
  const created = await request('/api/game', post({ contest: parsed.contest, options, publish: true }));
  assert.equal(created.game.steps.filter((s) => s.type === 'resolve').length, 20);
  const viewerResponse = await fetch(new URL(`/api/watch/${created.id}`, base));
  assert.equal(viewerResponse.status, 200);
  assert.equal((await viewerResponse.json()).game.steps.some((s) => s.type === 'resolve'), false);
  const index = created.game.steps.findIndex((s) => s.type === 'resolve');
  await request(`/api/game/${created.id}/playback`, { method: 'PUT', headers: { 'X-Resolver-Control': created.controlToken, 'Content-Type': 'application/json' }, body: JSON.stringify({ index, revision: 0 }) });
  const after = await request(`/api/watch/${created.id}`);
  assert.equal(after.playback.index, index);
  const preset = await request('/api/configs', post({ name: 'Deployment smoke fixture', config: options, contest: parsed.contest }));
  await writeFile(stateFile, JSON.stringify({ presetId: preset.id, gameId: created.id, index, contestName: parsed.contest.name }));
  console.log('PASS: health, removed demo, authentication, NDJSON upload, 20 reveals, presenter, viewer and preset save');
}
