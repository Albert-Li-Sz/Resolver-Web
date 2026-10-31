import { test, expect } from '@playwright/test';
test('real 1080p video: WHEP failure falls back to HLS; loss, recovery, standby audio and WebRTC', async ({ page, request, context }) => {
  test.setTimeout(150000);
  const api = async (route: string, body?: unknown, method = 'POST') => {
    const response = await request.fetch(`/api${route}`, { method, headers: { 'X-Resolver-Admin': 'browser-regression-admin' }, data: body });
    expect(response.ok(), await response.text()).toBe(true); return response.json();
  };
  const state = () => api('/platform', undefined, 'GET');
  const readerIds = new Set<string>();
  page.on('request', r => { if (r.method() === 'POST' && /\/api\/media\/read\//.test(r.url())) { const body = r.postDataJSON(); if (body?.readerId) readerIds.add(body.readerId); } });
  const w = await api('/workspaces', { name: '真实媒体回归', contest: { name: 'Media', teams: [{ id: 't', name: 'Team' }], problems: [], submissions: [] } });
  await api(`/workspaces/${w.id}/activate`, {});
  const source = await api('/media/sources', { name: '1080p controlled camera', kind: 'publish', teamId: 't', role: 'camera', workspaceId: w.id });
  const links = await api(`/media/sources/${source.id}/publish`, undefined, 'GET');
  const publish = () => request.post('http://fixture:8092/start', { data: { url: links.rtsp } });
  expect((await publish()).ok()).toBe(true);
  const initial = await state();
  const saved = await api('/broadcast/preview', { revision: initial.broadcast.revision, scene: { ...initial.broadcast.preview, layout: 'single', teamIds: ['t'], mediaIds: [source.id], audioMediaId: source.id, volume: 0.5 } }, 'PUT');
  await api('/broadcast/take', { revision: saved.revision });
  await page.route('**/whep', route => route.abort('connectionrefused'));
  await page.goto(`/live/program/#${initial.broadcast.token}`);
  const video = page.locator('video').first();
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth && v.readyState >= 2 ? v.videoWidth : 0), { timeout: 45000 }).toBe(1920);
  await expect.poll(async () => (await state()).outputs.some((o: any) => o.health.media.some((m: any) => m.protocol === 'hls' && m.width === 1920 && m.fps > 5)), { timeout: 15000 }).toBe(true);
  await page.getByRole('button', { name: '启用声音', exact: true }).click();
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.muted)).toBe(false);
  let s = await state(); await api('/broadcast/standby', { revision: s.broadcast.revision, enabled: true });
  await expect(page.locator('video')).toHaveCount(0);
  s = await state(); await api('/broadcast/standby', { revision: s.broadcast.revision, enabled: false });
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState >= 2 && !v.muted), { timeout: 30000 }).toBe(true);
  expect((await request.post('http://fixture:8092/stop')).ok()).toBe(true);
  await expect.poll(async () => (await state()).outputs.some((o: any) => o.health.media.some((m: any) => m.reconnects > 0 && m.status === 'reconnecting')), { timeout: 30000 }).toBe(true);
  expect((await publish()).ok()).toBe(true);
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState >= 2 && v.videoWidth === 1920 && !v.paused), { timeout: 45000 }).toBe(true);
  // The already running shared gateway permits a fresh browser to negotiate WHEP directly.
  const webrtc = await context.newPage();
  await webrtc.goto(`/live/program/?clean=1#${initial.broadcast.token}`);
  await expect.poll(async () => (await state()).outputs.some((o: any) => o.health.media.some((m: any) => m.protocol === 'webrtc' && m.status === 'playing' && m.width === 1920)), { timeout: 30000 }).toBe(true);
  await webrtc.close();
  s = await state();
  const beforeRename = new Set(readerIds), beforeTime = await video.evaluate((v: HTMLVideoElement) => v.currentTime);
  const renamed = await api(`/media/sources/${source.id}`, { sourceRevision: 0, expectedBroadcastRevision: s.broadcast.revision, name: 'Renamed camera' }, 'PUT');
  expect(renamed.streamRevision).toBe(0);
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(beforeTime + 0.4);
  expect([...readerIds]).toEqual([...beforeRename]);
  const previousReaders = new Set(readerIds);
  const reopened = page.waitForRequest(r => {
    if (r.method() !== 'POST' || !r.url().includes(`/api/media/read/${source.id}`)) return false;
    const body = r.postDataJSON(); return !body.release && body.readerId && !previousReaders.has(body.readerId);
  });
  const changed = await api(`/media/sources/${source.id}`, { sourceRevision: renamed.revision, expectedBroadcastRevision: s.broadcast.revision, transcode: true }, 'PUT');
  expect(changed.streamRevision).toBe(1); await reopened;
  await expect.poll(async () => (await state()).mediaHealth.jobs.some((j: any) => j.id === source.id && j.transcoding), { timeout: 15000 }).toBe(true);
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState >= 2 && v.videoWidth === 1920 && !v.paused), { timeout: 45000 }).toBe(true);
  await api(`/media/sources/${source.id}`, { sourceRevision: changed.revision, expectedBroadcastRevision: s.broadcast.revision }, 'DELETE');
  await expect(page.locator('video')).toHaveCount(0);
  await expect.poll(async () => (await state()).mediaHealth.jobs.some((j: any) => j.id === source.id), { timeout: 15000 }).toBe(false);
  await expect(page.getByText('等待媒体来源', { exact: true })).toBeVisible();
});
test('gateway admits preview and program sources with independent audio without starting unrelated sources', async ({ request }) => {
  const sources: any[] = [], headers = { 'X-Resolver-Admin': 'browser-regression-admin' }, internal = { 'X-Media-Key': 'isolated-browser-test-internal' };
  try {
    for (let i = 0; i < 10; i++) {
      const created = await request.post('/api/media/sources', { headers, data: { name: `Reserved ${i + 1}`, kind: 'publish', role: i >= 8 ? 'audio' : 'camera' } });
      expect(created.ok()).toBe(true); const source = await created.json(); sources.push(source);
      const ensured = await request.post('http://media-worker:20007/ensure', { headers: internal, data: { source } });
      expect(ensured.ok()).toBe(true);
    }
    const jobs = await request.get('http://media-worker:20007/health', { headers: internal }).then(r => r.json());
    expect(jobs.jobs).toHaveLength(10);
  } finally {
    for (const source of sources) await request.delete(`/api/media/sources/${source.id}`, { headers, data: { sourceRevision: 0 } });
  }
});
