import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { gzipSync } from 'node:zlib';
import { fetchFeedText } from '../server/lib/remote-feed.js';

test('the actual HTTP socket uses checked DNS, including safe redirects and compressed-byte limits', async (t) => {
  let requests = 0;
  const server = http.createServer((req, res) => {
    requests++;
    if (req.url === '/redirect') { res.writeHead(302, { Location: '/feed' }); res.end(); }
    else if (req.url === '/empty') { res.writeHead(204); res.end(); }
    else { res.writeHead(200, { 'Content-Encoding': 'gzip' }); res.end(gzipSync('滚榜 event feed')); }
  });
  server.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const origin = `http://feed.fixture.test:${server.address().port}`;
  let lookups = 0;
  const options = { allowedOrigins: [origin], lookupImpl: async () => { lookups++; return [{ address: '127.0.0.1', family: 4 }]; } };
  assert.equal(await fetchFeedText(origin + '/redirect', options), '滚榜 event feed');
  assert.equal(lookups, 2, 'one resolution and one pinned connection per redirect hop');
  assert.equal(requests, 2);
  await assert.rejects(fetchFeedText(origin + '/feed', { ...options, maxBytes: 5 }), { status: 413 });
  assert.equal(await fetchFeedText(origin + '/empty', options), '');
});
