import { lookup } from 'node:dns/promises';

export async function mediaInput(source, { key, host = 'mediamtx', rtspPort = process.env.MEDIA_MTX_RTSP_PORT || 20001, networkPolicy = process.env.RESOLVER_NETWORK_POLICY || 'open', lookupImpl = lookup } = {}) {
  if (!['open', 'restricted'].includes(networkPolicy)) throw Error('Invalid network policy');
  if (!/^[a-f0-9]{32}$/.test(source.id)) throw Error('Invalid source');
  if (source.kind === 'publish') return `rtsp://worker:${encodeURIComponent(key)}@${host}:${rtspPort}/source-${source.id}`;
  const url = new URL(source.url);
  if (!['rtsp:', 'rtmp:', 'srt:', 'http:', 'https:'].includes(url.protocol) || url.username || url.password) throw Error('Invalid protocol');
  const addresses = await lookupImpl(url.hostname.replace(/^\[|\]$/g, ''), { all: true });
  if (!addresses.length || networkPolicy === 'restricted' && addresses.some(({ address }) =>
    address === '::1' || address.startsWith('127.') || address.startsWith('169.254.') ||
    address.startsWith('fe80:') || address === '0.0.0.0' || address === '::')) throw Error('Forbidden source');
  const address = addresses[0].address;
  const privateAddress = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|f[cd])/i.test(address);
  if (networkPolicy === 'restricted' && privateAddress && !source.allowPrivate) throw Error('Private source not allowed');
  // Keep TLS SNI when using HTTPS; other protocols use the resolved address.
  if (url.protocol !== 'https:') url.hostname = address.includes(':') ? `[${address}]` : address;
  if (source.username) url.username = source.username;
  if (source.password) url.password = source.password;
  return url.href;
}
