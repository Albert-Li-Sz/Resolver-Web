import { test, expect } from '@playwright/test';
test.beforeEach(() => {
  expect(`${process.platform}/${process.arch}`, 'Use the pinned linux/arm64 Playwright image for pixel baselines').toBe('linux/arm64');
});
const templates = ['scoreboard', 'leaders', 'clock', 'countdown', 'queue', 'first-solves', 'team', 'logo', 'photos', 'message', 'calibration', 'standby'];
const locales = process.env.VISUAL_BASELINE_EN_ONLY ? ['en'] : ['en', 'zh-CN'];
for (const locale of locales) for (const h of [1080, 1440, 2160]) for (const type of templates) {
  test(`@visual ${locale} ${h} ${type}`, async ({ page }) => {
    const w = h * 16 / 9;
    await page.setViewportSize({ width: w, height: h });
    await page.goto(`http://127.0.0.1:4240/test/render.html?type=${type}&locale=${locale}&w=${w}&h=${h}`);
    await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
    if (locale === 'zh-CN') {
      const fonts = await page.evaluate(() => Array.from(document.fonts).map(f => ({ family: f.family.replace(/["']/g, ''), status: f.status })));
      expect(fonts).toContainEqual({ family: 'Contest Noto Sans SC', status: 'loaded' });
    }
    await expect(page.locator('canvas')).toHaveScreenshot(`${locale}-${h}-${type}.png`);
  });
}
for (const locale of locales) for (const type of ['scoreboard', 'standby']) for (const [w, h, label] of [[7680, 2160, 'led'], [1440, 1440, 'square']] as const) {
  test(`@visual ${locale} ${label} ${type}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await page.goto(`http://127.0.0.1:4240/test/render.html?type=${type}&locale=${locale}&w=${w}&h=${h}`);
    await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
    await expect(page.locator('canvas')).toHaveScreenshot(`${locale}-${label}-${type}.png`);
  });
}
for (const locale of locales) for (const h of [1080, 1440, 2160]) {
  test(`@visual ${locale} ${h} active queue`, async ({ page }) => {
    const w = h * 16 / 9; await page.setViewportSize({ width: w, height: h });
    await page.goto(`http://127.0.0.1:4240/test/render.html?type=queue&variant=queue-active&locale=${locale}&w=${w}&h=${h}`);
    await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
    await expect(page.locator('canvas')).toHaveScreenshot(`${locale}-${h}-active-queue.png`);
  });
}
for (const type of ['scoreboard', 'team']) for (const h of [1080, 1440, 2160]) {
  test(`@visual zh-CN ${h} Chinese names ${type}`, async ({ page }) => {
    const w = h * 16 / 9; await page.setViewportSize({ width: w, height: h });
    await page.goto(`http://127.0.0.1:4240/test/render.html?type=${type}&variant=chinese-names&locale=zh-CN&w=${w}&h=${h}`);
    await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
    await expect(page.locator('canvas')).toHaveScreenshot(`zh-CN-${h}-chinese-names-${type}.png`);
  });
}
for (const locale of locales) for (const h of [1080, 1440, 2160]) {
  test(`@visual ${locale} ${h} ended status`, async ({ page }) => {
    const w = h * 16 / 9; await page.setViewportSize({ width: w, height: h });
    await page.goto(`http://127.0.0.1:4240/test/render.html?type=scoreboard&variant=ended&locale=${locale}&w=${w}&h=${h}`);
    await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
    await expect(page.locator('canvas')).toHaveScreenshot(`${locale}-${h}-ended.png`);
  });
}
test('@visual mobile management emergency controls', async ({ page }) => {
  // Deterministic public fixture, no live heartbeats, source credentials or random IDs on screen.
  const fixture = await page.request.get('http://127.0.0.1:4240/test/fixture.json').then(r => r.json());
  const publicState = { revision: 0, serverTime: 1726371004000, contextId: 'visual', presentationLocale: 'zh-CN', data: fixture, broadcast: { mode: 'program' } };
  await page.route('**/api/platform', r => r.fulfill({ json: { revision: 0, serverTime: 1726371004000, activeWorkspaceId: 'fixture', activeWorkspace: { name: '国内赛' }, publicState, workspaces: [], plans: [], media: [], broadcast: { revision: 0 }, displays: [{ id: 'screen', name: '现场主屏', group: '会场', revision: 0, appliedRevision: 0, seenAt: 0, health: { renderer: 'offline', media: [] }, program: { items: [{ type: 'logo', duration: 15 }], loop: true }, startedAt: 0 }] } }));
  await page.route('**/api/platform/events**', r => r.abort());
  await page.clock.setFixedTime(new Date(1726371004000));
  await page.setViewportSize({ width: 375, height: 812 }); await page.goto('/presentation-admin/');
  await expect(page.getByRole('heading', { name: '屏幕与节目', exact: true })).toBeVisible();
  await expect.poll(() => page.locator('.template-card canvas[data-ready="true"]').count()).toBeGreaterThan(0);
  await expect(page).toHaveScreenshot('mobile-management.png', { fullPage: true });
});
