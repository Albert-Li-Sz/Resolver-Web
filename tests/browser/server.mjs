import http from 'node:http';
import path from 'node:path';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { parseEventFeed } from '../../server/lib/engine.js';
import { publicContest } from '../../server/platform/model.js';

const root = path.resolve('public');
const directory = await mkdtemp(path.join(tmpdir(), 'resolver-browser-'));
const app = process.env.BROWSER_EXTERNAL_APP ? null : spawn(process.execPath, ['server/index.js'], {
  env: { ...process.env, HOST: '127.0.0.1', PORT: '4244', RESOLVER_DATA_DIR: directory, RESOLVER_ADMIN_KEY: 'browser-regression-admin' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
app?.stderr.on('data', chunk => process.stderr.write(chunk));
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  app?.kill('SIGTERM');
  server.close();
  if (app) await new Promise(resolve => { app.once('exit', resolve); setTimeout(resolve, 3000).unref(); });
  await rm(directory, { recursive: true, force: true });
}
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => void close().then(() => process.exit()));
const contest = parseEventFeed(await readFile('examples/02-finals-18-teams.ndjson', 'utf8'));
const fixture = {
  ...publicContest(contest),
  clock: { startTime: '2024-09-15T09:00:00+05:00', ended: null, multiplier: 1, countdownPauseTime: null },
};
const mime = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.m3u8': 'application/vnd.apple.mpegurl', '.ts': 'video/mp2t' };
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization');
  if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
  const pathname = new URL(req.url, 'http://test').pathname;
  try {
    let body, file;
    if (pathname === '/test/health') {
      const health = await fetch(`${process.env.BROWSER_BASE_URL || 'http://127.0.0.1:4244'}/api/health`);
      res.writeHead(health.ok ? 200 : 503).end('test server'); return;
    }
    if (pathname === '/test/fixture.json') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(fixture)); return; }
    if (pathname.startsWith('/test/media/')) file = path.resolve('tests/browser/media', path.basename(pathname));
    else if (pathname.startsWith('/test/')) file = path.resolve('tests/browser', path.basename(pathname));
    else { file = path.resolve(root, '.' + decodeURIComponent(pathname)); if (!file.startsWith(root + path.sep)) throw Error('Invalid path');
      if (process.env.REFERENCE_RENDER_ROOT && pathname.startsWith('/js/render/')) file = path.join(process.env.REFERENCE_RENDER_ROOT, 'render', path.basename(pathname));
    }
    body = await readFile(file);
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch { res.writeHead(404).end('Not found'); }
});
server.listen(4240, '127.0.0.1');
