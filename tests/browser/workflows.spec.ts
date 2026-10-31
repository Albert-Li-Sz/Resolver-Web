import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
const key = 'browser-regression-admin';
async function api(request: APIRequestContext, route: string, body?: unknown, method?: string) {
  const r = await request.fetch(`/api${route}`, { method: method || (body === undefined ? 'GET' : 'POST'), headers: { 'X-Resolver-Admin': key }, data: body });
  expect(r.ok(), await r.text()).toBeTruthy(); return r.json();
}
async function workspace(request: APIRequestContext, name = 'Browser Contest') {
  const w = await api(request, '/workspaces', { name, contest: { name, durationMs: 18000000, freezeDurationMs: 3600000, teams: [{ id: 't', name: '测试队伍' }], problems: [{ id: 'p', label: 'A' }], submissions: [{ id: 's', teamId: 't', problemId: 'p', contestTime: 16200000, status: 'solved' }] } });
  await api(request, `/workspaces/${w.id}/activate`, {}); return w;
}
async function platform(request: APIRequestContext) { return api(request, '/platform'); }
async function preview(request: APIRequestContext, title: string) { const s = await platform(request); return api(request, '/broadcast/preview', { revision: s.broadcast.revision, scene: { ...s.broadcast.preview, title, widgets: { ...s.broadcast.preview.widgets, title: true } } }, 'PUT'); }
async function take(request: APIRequestContext) { const s = await platform(request); return api(request, '/broadcast/take', { revision: s.broadcast.revision }); }
async function display(request: APIRequestContext, name = '验收屏幕') { const d = await api(request, '/displays/register', {}); await api(request, '/displays/pair', { code: d.code, name }); return d; }

test('cancel, Escape and close never expose frozen judgements; publish requires explicit checkbox', async ({ page, request }) => {
  const w = await workspace(request, '封榜确认赛事'); await page.goto('/contest/');
  await page.getByRole('button', { name: '公开解榜', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: '确认公开解榜', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  expect((await platform(request)).activeWorkspace.unlocked).toBe(false);
  await page.getByRole('button', { name: '公开解榜', exact: true }).click(); await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await platform(request)).activeWorkspace.unlocked).toBe(false);
  await page.getByRole('button', { name: '公开解榜', exact: true }).click(); await dialog.getByRole('button', { name: '关闭对话框' }).click();
  expect((await platform(request)).activeWorkspace.unlocked).toBe(false);
  await page.getByRole('button', { name: '公开解榜', exact: true }).click();
  await dialog.getByRole('checkbox', { name: '确认公开封榜判题' }).check(); await dialog.getByRole('button', { name: '确认公开解榜', exact: true }).click();
  await expect.poll(async () => (await platform(request)).activeWorkspace.unlocked).toBe(true);
  expect((await api(request, `/workspaces/${w.id}`)).id).toBe(w.id);
});
test('confirmation uses captured control version while feed events remain independent', async ({ page, request }) => {
  const w = await workspace(request, '并发确认赛事'); await page.goto('/contest/');
  await page.getByRole('button', { name: '公开解榜', exact: true }).click();
  await api(request, `/workspaces/${w.id}/events`, { events: [{ token: 'browser-event', type: 'teams', id: 'other', data: { id: 'other', name: '另一队伍' } }] });
  await page.getByRole('checkbox', { name: '确认公开封榜判题' }).check(); await page.getByRole('button', { name: '确认公开解榜', exact: true }).click();
  await expect.poll(async () => (await platform(request)).activeWorkspace.unlocked).toBe(true);
  await page.getByRole('button', { name: '恢复封榜规则', exact: true }).click();
  const current = (await platform(request)).activeWorkspace;
  await api(request, `/workspaces/${w.id}`, { configRevision: current.configRevision, name: '另一个管理员已修改' }, 'PUT');
  await page.getByRole('button', { name: '确认恢复封榜', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('已更新');
  expect((await platform(request)).activeWorkspace.unlocked).toBe(true);
});
test('Live standby and one-level rollback preserve a dirty preview', async ({ page, request }) => {
  await workspace(request, '导播应急赛事'); await preview(request, 'Scene A'); await take(request); await preview(request, 'Scene B'); await take(request);
  await page.goto('/live/'); await page.getByRole('textbox', { name: '字幕', exact: true }).fill('尚未保存的预览');
  await page.getByRole('button', { name: '进入待机', exact: true }).click();
  await expect.poll(async () => (await platform(request)).broadcast.mode).toBe('standby');
  await expect(page.getByRole('textbox', { name: '字幕', exact: true })).toHaveValue('尚未保存的预览');
  await page.getByRole('button', { name: '恢复正式节目', exact: true }).click();
  await expect.poll(async () => (await platform(request)).broadcast.mode).toBe('program');
  await page.getByRole('button', { name: '回切上一正式节目', exact: true }).click();
  await expect.poll(async () => (await platform(request)).broadcast.program.title).toBe('Scene A');
  await expect(page.getByRole('button', { name: '回切上一正式节目', exact: true })).toBeDisabled();
  await expect(page.getByRole('textbox', { name: '字幕', exact: true })).toHaveValue('尚未保存的预览');
  await page.getByRole('button', { name: '保存预览', exact: true }).click();
  await expect.poll(async () => (await platform(request)).broadcast.preview.title).toBe('尚未保存的预览');
});
test('output link rotation can be cancelled without disconnecting viewers', async ({ page, request }) => {
  await workspace(request, '换链确认赛事'); const before = (await platform(request)).broadcast.token;
  await page.goto('/live/'); await page.getByRole('button', { name: '输出设置', exact: true }).click();
  await page.getByRole('button', { name: '重新生成输出链接', exact: true }).click(); await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
  expect((await platform(request)).broadcast.token).toBe(before);
  await page.getByRole('button', { name: '重新生成输出链接', exact: true }).click(); await page.getByRole('button', { name: '确认更换输出链接', exact: true }).click();
  await expect.poll(async () => (await platform(request)).broadcast.token).not.toBe(before);
});
test('screen controls, real renderer telemetry, hidden controls and language share persistent identity', async ({ page, request, context }) => {
  const w = await workspace(request, '大屏语言赛事');
  await page.goto('/presentations/'); await expect(page.locator('.pair-code')).toHaveText(/^\d{8}$/);
  const code = (await page.locator('.pair-code').innerText()).trim();
  await api(request, '/displays/pair', { code, name: '语言与应急屏' });
  const d = (await platform(request)).displays.find((v: any) => v.name === '语言与应急屏');
  await expect(page.locator('canvas')).toBeVisible();
  await page.bringToFront();
  await expect.poll(async () => (await platform(request)).displays.find((v: any) => v.id === d.id).health.renderer, { timeout: 15000 }).toBe('healthy');
  const admin = await context.newPage(); await admin.goto('/presentation-admin/');
  await admin.getByRole('checkbox', { name: '选择 语言与应急屏', exact: true }).check();
  await admin.getByRole('button', { name: '实时榜单', exact: true }).click(); await admin.getByRole('button', { name: '立即上屏', exact: true }).click();
  await expect(page.locator('canvas')).toHaveAttribute('aria-label', '实时榜单');
  await admin.getByRole('button', { name: '进入待机', exact: true }).click(); await expect(page.locator('canvas')).toHaveAttribute('aria-label', '待机画面');
  await admin.getByRole('button', { name: '恢复节目', exact: true }).click(); await expect(page.locator('canvas')).toHaveAttribute('aria-label', '实时榜单');
  await page.getByRole('button', { name: '隐藏控制栏', exact: true }).click(); await page.getByRole('button', { name: '知道了，隐藏', exact: true }).click();
  await page.mouse.move(250, 200); await page.locator('canvas').click(); await expect(page.locator('.output-controls')).toHaveCount(0);
  await page.reload(); await expect(page.locator('canvas')).toBeVisible(); await expect(page.locator('.output-controls')).toHaveCount(0);
  await page.keyboard.press('h'); await expect(page.locator('.output-controls')).toBeVisible();
  await admin.goto('/contest/?tab=assets'); await admin.getByLabel('大屏模板语言', { exact: true }).selectOption('en');
  await expect.poll(async () => (await api(request, `/workspaces/${w.id}`)).presentationLocale).toBe('en');
  await page.bringToFront();
  // Fault injection stops the real renderer loop, not its heartbeat. No synthetic healthy reports are sent.
  await page.evaluate(() => { window.requestAnimationFrame = () => 0; });
  await expect.poll(async () => (await platform(request)).displays.find((v: any) => v.id === d.id).health.renderer, { timeout: 20000 }).toBe('stalled');
  await page.reload(); await page.bringToFront();
  await expect.poll(async () => (await platform(request)).displays.find((v: any) => v.id === d.id).health.renderer, { timeout: 15000 }).toBe('healthy');
});
test('a recovered heartbeat clears its error without a new program or page reload', async ({ page, request }) => {
  await workspace(request, '心跳恢复赛事');
  let disconnected = true;
  await page.route('**/api/displays/*/heartbeat', route => disconnected ? route.abort('connectionfailed') : route.continue());
  await page.goto('/presentations/');
  await expect(page.locator('.pair-code')).toHaveText(/^\d{8}$/);
  await api(request, '/displays/pair', { code: (await page.locator('.pair-code').innerText()).trim(), name: '心跳恢复屏' });
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveText('状态上报失败，正在重试');
  const before = (await platform(request)).displays.find((d: any) => d.name === '心跳恢复屏');
  disconnected = false;
  await expect(page.getByRole('alert')).toHaveCount(0);
  const after = (await platform(request)).displays.find((d: any) => d.id === before.id);
  expect(after.revision).toBe(before.revision);
  expect(after.program).toEqual(before.program);
});
test('clean outputs never display controls; standby clears overlay', async ({ page, request }) => {
  await workspace(request, '纯净输出赛事'); await preview(request, 'Title'); await take(request); const s = await platform(request);
  await page.goto(`/live/overlay/?clean=1#${s.broadcast.token}`); await expect(page.getByLabel('Live 原版节目画面')).toBeVisible();
  await page.keyboard.press('h'); await expect(page.locator('.output-controls,.controls-hotspot,.notice')).toHaveCount(0);
  await api(request, '/broadcast/standby', { revision: s.broadcast.revision, enabled: true });
  await expect(page.locator('video')).toHaveCount(0); await expect(page.locator('canvas')).toHaveAttribute('aria-label', '待机画面');
  const alpha = await page.locator('canvas').evaluate((c: HTMLCanvasElement) => c.getContext('2d')!.getImageData(0, 0, 1, 1).data[3]); expect(alpha).toBe(0);
});
test('mobile management has no horizontal overflow and menu closes with Escape', async ({ page, request }) => {
  await workspace(request, '手机布局赛事'); await display(request, '手机布局屏'); await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/presentation-admin/'); await expect(page.getByRole('heading', { name: '屏幕与节目', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.getByRole('button', { name: '打开模块导航', exact: true }).click(); await page.keyboard.press('Escape');
  await expect(page.locator('#platform-nav')).not.toBeVisible();
});
test('switching contests and revoking a named screen require an explicit confirmation', async ({ page, request }) => {
  const original = await workspace(request, '当前上屏赛事');
  const next = await api(request, '/workspaces', { name: '准备切换赛事' });
  const d = await display(request, '受保护屏幕');
  await page.goto('/contest/');
  await page.getByRole('combobox', { name: '查看赛事', exact: true }).fill('准备切换赛事');
  await page.getByRole('option', { name: '准备切换赛事', exact: true }).click();
  await page.getByRole('button', { name: '切换当前赛事', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('准备切换赛事');
  await page.keyboard.press('Escape'); expect((await platform(request)).activeWorkspaceId).toBe(original.id);
  await page.getByRole('button', { name: '切换当前赛事', exact: true }).click();
  await page.getByRole('button', { name: '确认切换赛事', exact: true }).click();
  await expect.poll(async () => (await platform(request)).activeWorkspaceId).toBe(next.id);
  await page.goto('/presentation-admin/'); await page.getByRole('checkbox', { name: '选择 受保护屏幕', exact: true }).check();
  await page.getByRole('button', { name: '屏幕设置', exact: true }).click();
  await page.getByRole('button', { name: '解除绑定', exact: true }).click();
  const confirm = page.getByRole('dialog').filter({ hasText: '解除屏幕绑定' });
  await expect(confirm).toContainText('受保护屏幕'); await confirm.getByRole('button', { name: '取消', exact: true }).click();
  expect((await platform(request)).displays.some((x: any) => x.id === d.id)).toBe(true);
  await page.getByRole('button', { name: '解除绑定', exact: true }).click();
  await page.getByRole('button', { name: '确认解除绑定', exact: true }).click();
  await expect.poll(async () => (await platform(request)).displays.some((x: any) => x.id === d.id)).toBe(false);
});
test('first CCS connection to an imported contest can be cancelled without replacing its data', async ({ page, request }) => {
  const w = await workspace(request, '导入后连接赛事'); await page.goto('/contest/');
  await page.getByLabel('API 根地址', { exact: true }).fill('https://example.org/api');
  await page.getByLabel('比赛 ID', { exact: true }).fill('finals');
  await page.getByRole('button', { name: '保存连接', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('替换当前赛事数据源');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  const after = await api(request, `/workspaces/${w.id}`); expect(after.source).toBeNull(); expect(after.contest.teams).toHaveLength(1);
});
test('a media source on air cannot be replaced or removed by dismissing its confirmation', async ({ page, request }) => {
  const w = await workspace(request, '媒体保护赛事');
  const m = await api(request, '/media/sources', { name: '正式摄像头', kind: 'publish', role: 'camera', teamId: 't', workspaceId: w.id });
  const s = await platform(request);
  await api(request, '/broadcast/preview', { revision: s.broadcast.revision, scene: { ...s.broadcast.preview, teamIds: ['t'], mediaIds: [m.id] } }, 'PUT'); await take(request);
  await page.goto('/contest/?tab=media');
  const row = page.getByRole('row').filter({ hasText: '正式摄像头' });
  await row.getByRole('button', { name: '移除', exact: true }).click(); await page.keyboard.press('Escape');
  expect((await platform(request)).media.some((x: any) => x.id === m.id)).toBe(true);
  await row.getByRole('button', { name: '编辑', exact: true }).click();
  await page.getByLabel('用途', { exact: true }).selectOption('desktop');
  await page.getByRole('button', { name: '保存来源', exact: true }).click(); await expect(page.getByRole('dialog')).toContainText('正式摄像头');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  expect((await platform(request)).media.find((x: any) => x.id === m.id).role).toBe('camera');
});
test('a live team name returns to its natural width after changing from long to short', async ({ page, request }) => {
  const w = await workspace(request, '文字缩放赛事'), name = 'LongTeamName'.repeat(20);
  let s = await platform(request);
  const rename = async (value: string) => {
    const current = (await platform(request)).activeWorkspace;
    await api(request, `/workspaces/${w.id}`, { configRevision: current.configRevision || 0, contest: { ...current.contest, teams: current.contest.teams.map((t: any) => ({ ...t, name: value, displayName: value, display_name: value })) } }, 'PUT');
  };
  await rename(name); s = await platform(request);
  await api(request, '/broadcast/preview', { revision: s.broadcast.revision, scene: { ...s.broadcast.preview, layout: 'single', teamIds: ['t'], widgets: { team: true, queue: false, firstSolves: false, scoreboard: false, clock: false, title: false, ticker: false, image: false } } }, 'PUT');
  await take(request); await page.goto(`/live/program/?clean=1#${s.broadcast.token}`);
  const scale = (text: string) => page.getByText(text, { exact: true }).evaluate(el => new DOMMatrixReadOnly(getComputedStyle(el).transform).a);
  await expect.poll(() => scale(name)).toBeLessThan(0.5);
  await rename('AB'); await expect(page.getByText('AB', { exact: true })).toBeVisible();
  await expect.poll(() => scale('AB')).toBe(1);
});
test('loading native Chinese fonts cannot change Resolver labels or team-name glyphs', async ({ page }) => {
  await page.goto('http://127.0.0.1:4240/test/font-isolation.html');
  await expect(page.locator('body')).toHaveAttribute('data-loaded', 'true');
  await expect(page.locator('body')).toHaveAttribute('data-unchanged', 'true');
});
