import { test, expect } from '@playwright/test';
test.use({ launchOptions: { args: ['--disable-gpu', '--disable-lcd-text', '--disable-font-subpixel-positioning'] } });
for (const h of [1080, 1440, 2160]) for (const [layout, count] of [['single', 1], ['dual', 2], ['quad', 4]] as const) {
  test(`@visual Live ${h} ${layout} fixed video frame`, async ({ page }) => {
    expect(`${process.platform}/${process.arch}`).toBe('linux/arm64');
    const data = await page.request.get('http://127.0.0.1:4240/test/fixture.json').then(r => r.json());
    data.clock.ended = new Date(1726371000000).toISOString();
    const media = data.contest.teams.slice(0, count).map((team: any, i: number) => ({ id: String(i + 1).padStart(32, '0'), name: `Camera ${i + 1}`, role: 'camera', teamId: team.id, workspaceId: 'visual', kind: 'publish' }));
    const scene = { layout, teamIds: media.map((m: any) => m.teamId), mediaIds: media.map((m: any) => m.id), audioMediaId: '', title: 'ICPC Finals', ticker: '', image: '', volume: 0, positions: {}, widgets: { team: true, title: true, clock: true } };
    const state = { revision: 1, serverTime: 1726371004000, contextId: 'visual', workspaceId: 'visual', presentationLocale: 'en', data, media, broadcast: { revision: 1, mode: 'program', program: scene, outputProfiles: { program: { resolution: `${h}p`, aspect: '16:9' } } } };
    // Deterministic visual fixtures use the existing polling path; real SSE and gateway are tested separately.
    await page.addInitScript(() => Object.defineProperty(window, 'SharedWorker', { value: undefined }));
    await page.clock.setFixedTime(new Date(1726371004000));
    await page.route('**/api/broadcast/output', route => route.fulfill({ json: state }));
    await page.route('**/api/broadcast/heartbeat', route => route.fulfill({ json: { serverTime: 1726371004000 } }));
    await page.route('**/api/media/read/*', route => route.fulfill({ json: { whep: 'http://127.0.0.1:4240/test/whep', hls: 'http://127.0.0.1:4240/test/media/fixed.m3u8', user: 'visual', password: 'fixture', expiresAt: 1726371064000 } }));
    await page.route('**/whep', route => route.abort('connectionrefused'));
    await page.setViewportSize({ width: h * 16 / 9, height: h });
    await page.goto('/live/program/?clean=1#visual');
    await expect(page.locator('video')).toHaveCount(count);
    await expect.poll(() => page.locator('video').evaluateAll(vs => vs.every((v: HTMLVideoElement) => v.readyState >= 2 && v.videoWidth === 1920)), { timeout: 15000 }).toBe(true);
    await expect(page.getByText('视频暂不可用', { exact: true })).toHaveCount(0);
    await page.evaluate(() => document.fonts.ready);
    await test.info().attach('clock-metrics', { body: JSON.stringify(await page.getByText('OVER', { exact: true }).evaluate(e => {
      const s = getComputedStyle(e), r = e.getBoundingClientRect();
      return { font: s.font, transform: s.transform, width: r.width, x: r.x, y: r.y, pixelRatio: devicePixelRatio };
    })), contentType: 'application/json' });
    await expect(page).toHaveScreenshot(`live-${h}-${layout}.png`);
  });
}
