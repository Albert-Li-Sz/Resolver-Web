import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchFeedText } from '../server/lib/remote-feed.js';
const lookupImpl = async () => [{ address: '93.184.215.14', family: 4 }];

test('remote feed decodes UTF-8 across chunk boundaries', async () => {
  const bytes = new TextEncoder().encode('滚榜');
  const fetchImpl = async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(bytes.slice(0, 2)); controller.enqueue(bytes.slice(2)); controller.close(); },
  }));
  assert.equal(await fetchFeedText('http://fixture', { fetchImpl, lookupImpl }), '滚榜');
});

test('remote feed rejects excess bytes while streaming and cancels the body', async () => {
  let cancelled = false;
  const fetchImpl = async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(20)); },
    cancel() { cancelled = true; },
  }));
  await assert.rejects(fetchFeedText('http://fixture', { fetchImpl, lookupImpl, maxBytes: 10 }), { status: 413 });
  assert.equal(cancelled, true);
});

test('remote feed times out even after headers have arrived', async () => {
  const fetchImpl = async (url, { signal }) => new Response(new ReadableStream({
    start(controller) { signal.addEventListener('abort', () => controller.error(signal.reason)); },
  }));
  await assert.rejects(fetchFeedText('http://fixture', { fetchImpl, lookupImpl, timeoutMs: 15 }), { status: 504 });
});

test('SSRF blocks encoded IPs, IPv6, credentials, private DNS and redirect hops before requests', async () => {
  for (const url of ['http://127.1/', 'http://2130706433/', 'http://0x7f000001/', 'http://[::1]/',
    'http://[::ffff:127.0.0.1]/', 'http://[2002:7f00:1::]/', 'http://169.254.169.254/', 'http://192.168.1.1/', 'http://user:pass@example.com/']) {
    let requests = 0;
    await assert.rejects(fetchFeedText(url, { fetchImpl: async () => { requests++; }, lookupImpl }), { status: 400 });
    assert.equal(requests, 0, url);
  }
  await assert.rejects(fetchFeedText('https://fixture/', { lookupImpl: async () => [{ address: '10.0.0.1', family: 4 }] }), { status: 400 });
  await assert.rejects(fetchFeedText('https://fixture/', { lookupImpl: async () => [{ address: '93.184.215.14', family: 4 }, { address: '::1', family: 6 }] }), { status: 400 });
  let requests = 0;
  await assert.rejects(fetchFeedText('https://fixture/', { lookupImpl, fetchImpl: async (_url, options) => {
    requests++; assert.equal(options.redirect, 'manual'); assert.equal(options.address, '93.184.215.14');
    return new Response('', { status: 302, headers: { location: 'http://127.0.0.1/secret' } });
  } }), { status: 400 });
  assert.equal(requests, 1);
});

test('only an exact administrator allowlist origin permits a LAN CDS', async () => {
  const options = { allowedOrigins: ['http://127.0.0.1:8080'], fetchImpl: async () => new Response('feed') };
  assert.equal(await fetchFeedText('http://127.0.0.1:8080/feed', options), 'feed');
  await assert.rejects(fetchFeedText('http://127.0.0.1:8081/feed', options), { status: 400 });
});

test('DNS is included in the transfer deadline', async () => {
  await assert.rejects(fetchFeedText('https://fixture/', { timeoutMs: 10, lookupImpl: () => new Promise(() => {}) }), { status: 504 });
});
