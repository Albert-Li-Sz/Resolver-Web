import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { Readable } from 'node:stream';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import { LIMITS, inputError } from './limits.js';
import { restrictedNetwork } from './network-policy.js';

const private4 = new BlockList();
for (const [address, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]]) private4.addSubnet(address, prefix);
const global6 = new BlockList(); global6.addSubnet('2000::', 3, 'ipv6');
const reserved6 = new BlockList();
for (const [address, prefix] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]]) reserved6.addSubnet(address, prefix, 'ipv6');

export function isPublicAddress(address) {
  return isIP(address) === 4 ? !private4.check(address, 'ipv4') :
    isIP(address) === 6 && global6.check(address, 'ipv6') && !reserved6.check(address, 'ipv6');
}

function requestPinned(url, { address, family, signal, headers }) {
  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? https : http).get(url, {
      signal, headers, agent: false, autoSelectFamily: false,
      // Keep Host/SNI from the URL but use the checked address on the socket.
      lookup: (_host, _options, callback) => callback(null, address, family),
    }, (response) => {
      if ([204, 205, 304].includes(response.statusCode)) {
        response.resume(); resolve(new Response(null, { status: response.statusCode, headers: response.headers })); return;
      }
      let body = response;
      const encoding = response.headers['content-encoding'];
      const decoder = encoding === 'gzip' ? createGunzip() : encoding === 'br' ? createBrotliDecompress() : encoding === 'deflate' ? createInflate() : null;
      if (decoder) {
        response.on('error', (err) => decoder.destroy(err));
        decoder.on('close', () => response.destroy());
        body = response.pipe(decoder);
      } else if (encoding && encoding !== 'identity') {
        response.destroy(); reject(inputError('远程事件流使用了不支持的压缩格式', 502)); return;
      }
      resolve(new Response(Readable.toWeb(body), { status: response.statusCode, headers: response.headers }));
    });
    request.on('error', reject);
  });
}

/** A single deadline covers DNS, every redirect and the decompressed body. */
export async function fetchRemoteBytes(input, {
  accept = 'application/json, application/x-ndjson, text/plain', timeoutMs = 25_000, maxBytes = LIMITS.feedBytes, fetchImpl = requestPinned, lookupImpl = lookup,
  allowedOrigins = (process.env.RESOLVER_FEED_ORIGINS || '').split(',').map((origin) => origin.trim()).filter(Boolean),
  restrictNetwork = restrictedNetwork(),
} = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const aborted = new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(inputError('远程请求超时', 504)), { once: true }));
  const transfer = async () => {
    let url;
    try { url = new URL(input); } catch { throw inputError('请提供完整的 http(s) 事件流地址'); }
    for (let redirects = 0; redirects <= 5; redirects++) {
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.href.length > 4096) throw inputError('远程地址协议或凭据无效');
      const explicitlyAllowed = !restrictNetwork || allowedOrigins.includes(url.origin) || allowedOrigins.includes('*');
      if (!explicitlyAllowed && url.port && !['80', '443'].includes(url.port)) throw inputError('远程事件流仅允许 80/443 端口');
      const hostname = url.hostname.replace(/^\[|\]$/g, '');
      const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await lookupImpl(hostname, { all: true, verbatim: true });
      controller.signal.throwIfAborted();
      if (!addresses.length || addresses.some(({ address }) => !isIP(address) || (!explicitlyAllowed && !isPublicAddress(address)))) throw inputError('禁止抓取回环、内网、链路本地或保留地址；局域网 CDS 请由管理员配置允许的来源');
      const response = await fetchImpl(url, {
        ...addresses[0], signal: controller.signal, redirect: 'manual',
        headers: { accept, 'accept-encoding': 'identity' },
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        await response.body?.cancel();
        if (!location || redirects === 5) throw inputError('远程重定向无效或次数过多', 502);
        try { url = new URL(location, url); } catch { throw inputError('远程重定向地址无效', 502); }
        continue;
      }
      if (!response.ok) { await response.body?.cancel(); throw inputError(`远程服务器返回 ${response.status}`, 502); }
      const reader = response.body?.getReader();
      if (!reader) return { buffer: Buffer.alloc(0), contentType: response.headers.get('content-type') };
      const chunks = [];
      let bytes = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > maxBytes) { await reader.cancel(); throw inputError('远程事件流文件过大', 413); }
          chunks.push(Buffer.from(value));
        }
        return { buffer: Buffer.concat(chunks), contentType: response.headers.get('content-type') };
      } finally { reader.releaseLock(); }
    }
  };
  try { return await Promise.race([transfer(), aborted]); }
  catch (err) {
    if (controller.signal.aborted) throw inputError('远程请求超时', 504);
    if (err.expose) throw err;
    throw inputError('远程请求失败，请检查地址与网络连接', 502);
  } finally { clearTimeout(timer); }
}

export async function fetchFeedText(input, options) {
  const { buffer } = await fetchRemoteBytes(input, options);
  return buffer.toString('utf8');
}
