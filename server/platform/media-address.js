const bracketHost = host => host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
export function mediaPort(name, fallback) {
  const value = process.env[name] || String(fallback);
  if (!/^[1-9][0-9]*$/.test(value) || Number(value) > 65535) throw Error(`${name} must be a port between 1 and 65535`);
  return Number(value);
}
export function mediaAddresses(req) {
  const protocol = req.protocol === 'https' ? 'https' : 'http';
  const requestHost = bracketHost(req.hostname);
  const configuredHost = process.env.MEDIA_PUBLIC_HOST?.trim();
  const publishHost = bracketHost(configuredHost && !['0.0.0.0', '::', '[::]'].includes(configuredHost) ? configuredHost : req.hostname);
  const withoutSlash = value => value.replace(/\/+$/, '');
  return {
    publishHost,
    whepBase: withoutSlash(process.env.MEDIA_BROWSER_BASE || `${protocol}://${requestHost}:${mediaPort('MEDIA_WEBRTC_PORT', 20005)}`),
    hlsBase: withoutSlash(process.env.MEDIA_HLS_BASE || `${protocol}://${requestHost}:${mediaPort('MEDIA_HLS_PORT', 20004)}`),
  };
}
