import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
const base = (process.argv[2] || 'http://127.0.0.1:4173').replace(/\/$/, '');
const archive = process.env.ONSITE_SMOKE_STATE || '/tmp/resolver-onsite-smoke.json';
const headers = { 'Content-Type': 'application/json', 'X-Resolver-Admin': process.env.RESOLVER_ADMIN_KEY || '' };
async function api(route, body, method = body === undefined ? 'GET' : 'POST', status = 200) {
  const response = await fetch(base + '/api' + route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  const result = await response.json();
  assert.equal(response.status, status, JSON.stringify(result)); return result;
}
const state = () => api('/platform');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function command(id, action, rest = {}, status = 200) {
  const d = (await state()).displays.find(d => d.id === id);
  return api('/displays/command', { ids: [id], revisions: { [id]: d.revision }, action, ...rest }, 'POST', status);
}
if (process.argv[3] !== 'verify-restart') {
  const workspace = await api('/workspaces', { name: 'Onsite restart smoke' }, 'POST', 201);
  await api(`/workspaces/${workspace.id}/activate`, {});
  for (const title of ['Scene A', 'Scene B', 'Preview draft']) {
    const s = await state();
    const saved = await api('/broadcast/preview', { revision: s.broadcast.revision, scene: { title } }, 'PUT');
    if (title !== 'Preview draft') await api('/broadcast/take', { revision: saved.revision });
  }
  await api('/broadcast/standby', { revision: (await state()).broadcast.revision, enabled: true });
  const identity = await api('/displays/register', {}, 'POST', 201);
  await api('/displays/pair', { code: identity.code, name: 'Onsite restart screen' });
  const program = text => ({ items: [{ type: 'message', text, duration: 10 }, { type: 'clock', duration: 10 }], loop: true });
  await command(identity.id, 'apply', { program: program('Program A') }); await wait(800);
  const first = (await state()).displays.find(d => d.id === identity.id);
  await command(identity.id, 'apply', { program: program('Program B') }); await wait(800);
  await command(identity.id, 'pause');
  await command(identity.id, 'standby'); await command(identity.id, 'hide');
  await command(identity.id, 'configure', { outputProfile: { resolution: '2160p', aspect: '32:9' } });
  const last = (await state()).displays.find(d => d.id === identity.id);
  await writeFile(archive, JSON.stringify({ workspaceId: workspace.id, id: identity.id, token: identity.token, firstStart: first.startedAt, lastStart: last.startedAt, lastOffset: last.offset }), { mode: 0o600 });
  console.log('Standby, previous scene, paused playlist, binding and output geometry saved');
} else {
  const saved = JSON.parse(await readFile(archive, 'utf8')), s = await state();
  assert.equal(s.activeWorkspaceId, saved.workspaceId);
  assert.equal(s.broadcast.mode, 'standby'); assert.equal(s.broadcast.previousProgram.scene.title, 'Scene A');
  assert.equal(s.broadcast.preview.title, 'Preview draft');
  let d = s.displays.find(d => d.id === saved.id);
  assert.equal(d.mode, 'standby'); assert.equal(d.hidden, true); assert.equal(d.paused, true);
  assert.equal(d.outputProfile.resolution, '2160p'); assert.equal(d.outputProfile.aspect, '32:9');
  const response = await fetch(base + `/api/displays/${saved.id}/state`, { headers: { 'X-Display-Token': saved.token } });
  assert.equal(response.status, 200); assert.equal((await response.json()).paired, true);
  await api('/broadcast/rollback', { revision: s.broadcast.revision });
  assert.equal((await state()).broadcast.program.title, 'Scene A');
  assert.equal((await state()).broadcast.preview.title, 'Preview draft');
  await api('/broadcast/rollback', { revision: (await state()).broadcast.revision }, 'POST', 409);
  await command(saved.id, 'restore');
  d = (await state()).displays.find(d => d.id === saved.id);
  assert.equal(d.startedAt, saved.lastStart); assert.equal(d.offset, saved.lastOffset); assert.equal(d.paused, true);
  await command(saved.id, 'rollback'); await wait(800);
  d = (await state()).displays.find(d => d.id === saved.id);
  assert.equal(d.program.items[0].text, 'Program A'); assert.equal(d.startedAt, saved.firstStart);
  assert.equal(d.paused, false); assert.equal(d.hidden, true); assert.equal(d.previousAvailable, false);
  await command(saved.id, 'rollback', {}, 409);
  console.log('Restart recovery, original timelines, one-level rollback and independent black screen verified');
}
