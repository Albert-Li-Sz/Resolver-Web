import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fetchFeedText } from '../server/lib/remote-feed.js';
import { checkedURL } from '../server/platform/feed.js';
import { mediaAddresses } from '../server/platform/media-address.js';
import { mediaInput } from '../media-worker/source.mjs';
import { trustProxy } from '../server/lib/network-policy.js';

const directory = await mkdtemp(path.join(tmpdir(), 'resolver-network-'));
process.env.RESOLVER_DATA_DIR = directory;
for (const key of ['RESOLVER_ADMIN_KEY', 'RESOLVER_NETWORK_POLICY', 'RESOLVER_ALLOWED_ORIGINS', 'RESOLVER_SECURITY_HEADERS', 'RESOLVER_TRUST_PROXY', 'MEDIA_PUBLIC_HOST', 'MEDIA_BROWSER_BASE', 'MEDIA_HLS_BASE']) delete process.env[key];
const { app, platform } = await import('../server/index.js');
after(async () => { platform.feeds.close(); await rm(directory, { force: true, recursive: true }); });
function environment(t, values) {
  const old = {};
  for (const [key, value] of Object.entries(values)) { old[key] = process.env[key]; if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  t.after(() => { for (const [key, value] of Object.entries(old)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
}
async function serve(t, handler = app) {
  const server = http.createServer(handler).listen(0, '0.0.0.0');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  return 'http://127.0.0.1:' + server.address().port;
}
const json = body => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const withHost = (base, route, options = {}) => new Promise((resolve, reject) => {
  const req = http.request(new URL(route, base), options, res => {
    const chunks = [];
    res.on('data', chunk => chunks.push(chunk));
    res.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers: res.headers })));
  });
  req.on('error', reject);
  req.end(options.body);
});

test('default open deployment accepts arbitrary Host and Origin, including cross-site writes', async t => {
  const base = await serve(t);
  for (const host of ['192.168.50.10:4173', 'contest.example.org', 'other.example.net:8080']) {
    const origin = 'https://' + host;
    const r = await withHost(base, '/api/workspaces', { ...json({ name: 'Open source' }), headers: { ...json({}).headers, Host: host, Origin: origin, 'Sec-Fetch-Site': 'cross-site' } });
    assert.equal(r.status, 201, await r.text());
    assert.equal(r.headers.get('access-control-allow-origin'), origin);
    assert.equal(r.headers.get('access-control-allow-credentials'), 'true');
    assert.equal(r.headers.get('content-security-policy'), null);
  }
  assert.equal((await (await fetch(base + '/api/platform')).json()).networkPolicy, 'open');
});

test('CORS preflight works before optional admin authentication; configured passwords still authenticate writes', async t => {
  environment(t, { RESOLVER_ADMIN_KEY: 'network-fixture-admin' });
  const base = await serve(t), origin = 'https://director.example.org';
  const preflight = await fetch(base + '/api/workspaces', { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,x-resolver-admin' } });
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers.get('access-control-allow-headers'), /x-resolver-admin/);
  assert.equal((await fetch(base + '/api/workspaces', { ...json({ name: 'No key' }), headers: { ...json({}).headers, Origin: origin } })).status, 401);
  const r = await fetch(base + '/api/workspaces', { ...json({ name: 'Authenticated' }), headers: { ...json({}).headers, Origin: origin, 'X-Resolver-Admin': 'network-fixture-admin' } });
  assert.equal(r.status, 201);
});

test('deployer may restore restricted access, select allowed origins and enable response headers', async t => {
  environment(t, { RESOLVER_NETWORK_POLICY: 'restricted', RESOLVER_ADMIN_KEY: undefined });
  const base = await serve(t);
  assert.equal((await withHost(base, '/api/workspaces', { headers: { Host: 'external.example' } })).status, 403);
  assert.equal((await fetch(base + '/api/workspaces', { headers: { Origin: 'https://outside.example' } })).status, 403);
  environment(t, { RESOLVER_ADMIN_KEY: 'configured-key', RESOLVER_ALLOWED_ORIGINS: 'https://director.example' });
  const r = await fetch(base + '/api/workspaces', { ...json({ name: 'Allowed origin' }), headers: { ...json({}).headers, Origin: 'https://director.example', 'Sec-Fetch-Site': 'cross-site', 'X-Resolver-Admin': 'configured-key' } });
  assert.equal(r.status, 201);
  assert.match(r.headers.get('content-security-policy'), /frame-ancestors/);
});

test('explicit origin list also limits the open network mode when the deployer requests it', async t => {
  environment(t, { RESOLVER_ALLOWED_ORIGINS: 'https://allowed.example' });
  const base = await serve(t);
  assert.equal((await fetch(base + '/api/health', { headers: { Origin: 'https://different.example' } })).status, 403);
  assert.equal((await fetch(base + '/api/health', { headers: { Origin: 'https://allowed.example' } })).status, 200);
});

test('loopback CCS feeds on arbitrary ports and local image caching work without allowlists', async t => {
  const feed = await readFile('examples/02-finals-18-teams.ndjson', 'utf8');
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
  const source = await serve(t, (req, res) => {
    res.setHeader('Content-Type', req.url === '/image' ? 'image/png' : 'application/x-ndjson');
    res.end(req.url === '/image' ? image : feed);
  });
  assert.equal(await fetchFeedText(source), feed);
  assert.equal((await checkedURL(source)).address.address, '127.0.0.1');
  const base = await serve(t);
  const r = await fetch(base + '/api/fetch', json({ url: source }));
  assert.equal(r.status, 200);
  assert.equal((await r.json()).contest.teams.length, 18);
  const cached = await (await fetch(base + '/api/assets/cache', json({ urls: [source + '/image'] }))).json();
  assert.match(cached.items[0].url, /^\/media\//);
});

test('persistent source connection tests accept loopback without a per-source private-address checkbox', async t => {
  const source = await serve(t, (_req, res) => res.end(JSON.stringify({ type: 'contest', data: { id: 'local', name: 'Loopback' } }) + '\n'));
  const base = await serve(t);
  const workspace = await (await fetch(base + '/api/workspaces', json({ name: 'Local CCS' }))).json();
  const r = await fetch(base + '/api/workspaces/' + workspace.id + '/test', json({ source: { mode: 'ndjson', url: source, allowPrivate: false } }));
  assert.equal(r.status, 200, await r.text());
});

test('media URLs follow the current IP, domain and forwarded HTTPS host instead of a fixed installation host', async t => {
  const base = await serve(t);
  const media = await (await fetch(base + '/api/media/sources', json({ name: 'Published', kind: 'publish' }))).json();
  for (const [host, expected] of [['venue.example.org', 'venue.example.org'], ['192.168.50.10:8080', '192.168.50.10']]) {
    const links = await (await withHost(base, '/api/media/sources/' + media.id + '/publish', { headers: { Host: host } })).json();
    assert.ok(links.rtmp.startsWith('rtmp://' + expected + ':1935/'));
  }
  const req = { protocol: 'https', hostname: 'proxy.example.org' };
  assert.equal(mediaAddresses(req).hlsBase, 'https://proxy.example.org:8888');
  assert.equal(mediaAddresses(req).whepBase, 'https://proxy.example.org:8889');
  const proxyLinks = await (await fetch(base + '/api/media/sources/' + media.id + '/publish', { headers: { Host: 'upstream:4173', 'X-Forwarded-Host': 'public.example.org', 'X-Forwarded-Proto': 'https' } })).json();
  assert.ok(proxyLinks.rtmp.startsWith('rtmp://public.example.org:1935/'));
  environment(t, { MEDIA_BROWSER_BASE: '/webrtc/', MEDIA_HLS_BASE: 'https://video.example.org/hls/' });
  assert.deepEqual(mediaAddresses(req), { publishHost: 'proxy.example.org', whepBase: '/webrtc', hlsBase: 'https://video.example.org/hls' });
});

test('reverse proxy trust remains configurable by the deployer', t => {
  environment(t, { RESOLVER_TRUST_PROXY: undefined });
  assert.equal(trustProxy(), true);
  process.env.RESOLVER_TRUST_PROXY = 'false'; assert.equal(trustProxy(), false);
  process.env.RESOLVER_TRUST_PROXY = '2'; assert.equal(trustProxy(), 2);
  process.env.RESOLVER_TRUST_PROXY = 'loopback,10.0.0.0/8'; assert.deepEqual(trustProxy(), ['loopback', '10.0.0.0/8']);
});

test('media worker accepts local and LAN sources by default and retains configurable restrictions', async () => {
  const source = { id: 'a'.repeat(32), kind: 'pull', allowPrivate: false, url: 'rtsp://fixture:8554/live' };
  for (const address of ['127.0.0.1', '192.168.1.20', '10.0.0.20', '169.254.1.20', '::1']) {
    const options = { key: 'worker-fixture', lookupImpl: async () => [{ address }] };
    assert.ok((await mediaInput(source, options)).startsWith('rtsp://'));
    await assert.rejects(mediaInput(source, { ...options, networkPolicy: 'restricted' }));
  }
  assert.ok((await mediaInput({ ...source, allowPrivate: true }, { key: 'fixture', networkPolicy: 'restricted', lookupImpl: async () => [{ address: '192.168.1.20' }] })).includes('192.168.1.20'));
});
