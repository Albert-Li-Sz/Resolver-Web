import { mediaLibrary } from './lib/media-library.js';
import { ASSET_DIR, saveImage } from './lib/assets.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { fetchFeedText } from './lib/remote-feed.js';
import { SessionStore } from './lib/sessions.js';
import { deleteConfig, getConfig, listConfigs, saveConfig } from './lib/store.js';
import { equalSecret, managementAccess } from './lib/access.js';
import { engineJob } from './lib/engine-job.js';
import { LIMITS } from './lib/limits.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '127.0.0.1';

const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https: http:; font-src 'self'; connect-src 'self' data:; frame-src 'self'; frame-ancestors 'self'; object-src 'none'; base-uri 'none'; form-action 'self'",
  });
  if (req.path.toLowerCase().startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use(managementAccess);
app.use('/api/parse', express.text({ type: ['text/plain', 'application/x-ndjson'], limit: LIMITS.feedBytes }));
app.use(express.json({ limit: LIMITS.jsonBytes }));

const sessions = new SessionStore();

function ok(res, payload) {
  res.json(payload);
}

function fail(res, status, message) {
  res.status(status).json({ error: message });
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'icpc-resolver-web', version: '1.1.0', time: Date.now() });
});


app.post('/api/parse', async (req, res, next) => {
  try {
    const text = typeof req.body === 'string' ? req.body : req.body?.text;
    if (typeof text !== 'string' || !text.trim()) {
      return fail(res, 400, '请提供事件流 JSON 文本');
    }
    if (Buffer.byteLength(text) > LIMITS.feedBytes) {
      return fail(res, 413, '事件流文件过大（上限 38MB）');
    }
    const contest = await engineJob('parse', text);
    if (!contest || !Array.isArray(contest.teams) || contest.teams.length === 0) {
      return fail(res, 400, '未能从文件中解析出队伍数据，请确认使用的是 CCS Contest API 事件流');
    }
    const pendingCount = (contest.submissions || []).filter((s) => s.status === 'pending').length;
    ok(res, {
      contest,
      stats: {
        teams: contest.teams.length,
        problems: (contest.problems || []).length,
        submissions: (contest.submissions || []).length,
        pending: pendingCount,
      },
    });
  } catch (err) {
    next(err);
  }
});

app.post('/api/fetch', async (req, res, next) => {
  try {
    const { url } = req.body || {};
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
      return fail(res, 400, '请提供 http(s) 事件流地址');
    }
    const text = await fetchFeedText(url);
    const contest = await engineJob('parse', text);
    if (!contest || !Array.isArray(contest.teams) || contest.teams.length === 0) {
      return fail(res, 400, '远程地址不是可解析的 Contest API 事件流');
    }
    ok(res, { contest, stats: { teams: contest.teams.length, problems: (contest.problems || []).length } });
  } catch (err) {
    if (err && err.name === 'AbortError') return fail(res, 504, '远程请求超时');
    next(err);
  }
});

app.get('/api/media-library', async (req, res, next) => {
  try { res.setHeader('Cache-Control', 'no-store'); ok(res, { items: await mediaLibrary.list() }); }
  catch (err) { next(err); }
});
app.post('/api/media-library', async (req, res, next) => {
  try { ok(res, await mediaLibrary.save(req.body)); } catch (err) { next(err); }
});
app.delete('/api/media-library/:id', async (req, res, next) => {
  try { if (!await mediaLibrary.remove(req.params.id)) return fail(res, 404, '素材规则不存在'); ok(res, { ok: true }); }
  catch (err) { next(err); }
});

app.post('/api/assets', express.raw({ type: ['image/png', 'image/jpeg', 'image/webp'], limit: '4mb' }), async (req, res, next) => {
  try { ok(res, await saveImage(req.body, req.get('Content-Type'))); }
  catch (err) { next(err); }
});
app.use('/media', express.static(ASSET_DIR, {
  maxAge: '365d', immutable: true, dotfiles: 'deny', index: false,
  setHeaders(res) { res.setHeader('X-Content-Type-Options', 'nosniff'); },
}));

app.post('/api/awards', async (req, res, next) => {
  try {
    const { contest, options } = req.body || {};
    if (!contest || !Array.isArray(contest.teams)) return fail(res, 400, '请先载入比赛');
    ok(res, await engineJob('awards', contest, options));
  } catch (err) { next(err); }
});

app.post('/api/game', async (req, res, next) => {
  try {
    const { contest, options } = req.body || {};
    if (!contest || !Array.isArray(contest.teams) || !Array.isArray(contest.problems)) {
      return fail(res, 400, '缺少可用的比赛数据');
    }
    const game = await engineJob('game', contest, options || {});
    if (!game || !Array.isArray(game.steps)) return fail(res, 500, '滚榜步骤生成失败');
    const entry = sessions.create(game);
    res.setHeader('Cache-Control', 'no-store');
    ok(res, { id: entry.id, game: entry.game, controlToken: entry.controlToken });
  } catch (err) {
    next(err);
  }
});

function findSession(req, res, control = false) {
  res.setHeader('Cache-Control', 'no-store');
  const entry = sessions.get(req.params.id, { touch: false });
  if (!entry) {
    fail(res, 404, '滚榜会话不存在或已过期');
    return null;
  }
  if (control && !equalSecret(req.get('X-Resolver-Control'), entry.controlToken)) {
    fail(res, 403, '需要主持端链接才能控制滚榜，请使用观众链接观看');
    return null;
  }
  entry.touchedAt = sessions.now();
  return entry;
}

app.get('/api/game/:id', (req, res) => {
  const entry = findSession(req, res, true);
  if (entry) res.json({ ...entry.game, playback: sessions.playback(entry) });
});

app.get('/api/game/:id/playback', (req, res) => {
  const entry = findSession(req, res, true);
  if (entry) res.json({ playback: sessions.playback(entry) });
});

app.put('/api/game/:id/playback', (req, res) => {
  const entry = findSession(req, res, true);
  if (!entry) return;
  const result = sessions.move(entry, req.body?.index, req.body?.revision);
  res.status(result.status || 200).json(result);
});

app.get('/api/watch/:id', (req, res) => {
  const entry = findSession(req, res);
  if (entry) res.json(sessions.snapshot(entry));
});

app.get('/api/watch/:id/events', (req, res) => {
  const entry = findSession(req, res);
  if (!entry) return;
  if (!sessions.canSubscribe(entry)) return fail(res, 503, '观众连接数已达上限，请稍后重试');
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no',
    Connection: 'keep-alive',
  });
  res.flushHeaders();
  sessions.subscribe(entry, res);
});

app.get('/api/configs', async (req, res, next) => {
  try {
    ok(res, await listConfigs());
  } catch (err) {
    next(err);
  }
});

app.get('/api/configs/:id', async (req, res, next) => {
  try {
    const record = await getConfig(req.params.id);
    if (!record) return fail(res, 404, '配置不存在');
    ok(res, record);
  } catch (err) {
    next(err);
  }
});

app.post('/api/configs', async (req, res, next) => {
  try {
    const { id, name, config, contest } = req.body || {};
    if (!config || typeof config !== 'object') return fail(res, 400, '配置内容无效');
    const record = await saveConfig({ id, name, config, contest });
    ok(res, { id: record.id, name: record.name, updatedAt: record.updatedAt });
  } catch (err) {
    next(err);
  }
});

app.delete('/api/configs/:id', async (req, res, next) => {
  try {
    const removed = await deleteConfig(req.params.id);
    if (!removed) return fail(res, 404, '配置不存在');
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Static app.
app.use(
  express.static(path.join(ROOT, 'public'), {
    extensions: ['html'],
    maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
    setHeaders(res, filePath) {
      if (filePath.includes('/assets/font/') || filePath.includes('/assets/img/')) {
        res.setHeader('Cache-Control', 'public, max-age=86400');
      }
    },
  }),
);

app.use((req, res, next) => {
  if (req.path.toLowerCase().startsWith('/api/') || req.path.toLowerCase().startsWith('/media/') || path.extname(req.path) || req.method !== 'GET') return next();
  res.sendFile(path.join(ROOT, 'public', 'index.html'));
});

app.use((req, res) => {
  if (req.path.toLowerCase().startsWith('/api/')) return fail(res, 404, '接口不存在');
  res.status(404).send('Not found');
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[server]', { type: err?.type || err?.name, status: err?.status || 500, code: err?.code });
  if (res.headersSent) return;
  const status = err && Number.isInteger(err.status) ? err.status : 500;
  const message = err?.type === 'entity.too.large' ? '请求内容过大，请缩小数据规模或使用原始事件流文件上传' :
    err?.type === 'entity.parse.failed' ? '请求 JSON 格式无效' : err?.expose ? err.message : '服务器处理失败';
  fail(res, status, message);
});

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  app.listen(PORT, HOST, () => {
    console.log(`\n  ICPC Resolver Web\n  → http://${HOST}:${PORT}\n`);
  });
}

export { app };
