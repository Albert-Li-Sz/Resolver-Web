const bracketHost = host => host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
export function mediaAddresses(req) {
  const protocol = req.protocol === 'https' ? 'https' : 'http';
  const requestHost = bracketHost(req.hostname);
  const configuredHost = process.env.MEDIA_PUBLIC_HOST?.trim();
  const publishHost = bracketHost(configuredHost && !['0.0.0.0', '::', '[::]'].includes(configuredHost) ? configuredHost : req.hostname);
  const withoutSlash = value => value.replace(/\/+$/, '');
  return {
    publishHost,
    whepBase: withoutSlash(process.env.MEDIA_BROWSER_BASE || `${protocol}://${requestHost}:8889`),
    hlsBase: withoutSlash(process.env.MEDIA_HLS_BASE || `${protocol}://${requestHost}:8888`),
  };
}
