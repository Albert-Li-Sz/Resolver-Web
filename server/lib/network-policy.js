// The deployment controls network exposure. Open is the default for LAN,
// reverse-proxy and multi-domain installations; restricted retains opt-in guards.
export function networkPolicy() {
  const value = process.env.RESOLVER_NETWORK_POLICY || 'open';
  if (!['open', 'restricted'].includes(value)) throw new Error('RESOLVER_NETWORK_POLICY must be open or restricted');
  return value;
}

export const restrictedNetwork = () => networkPolicy() === 'restricted';

export function trustProxy() {
  const value = process.env.RESOLVER_TRUST_PROXY;
  if (!value) return !restrictedNetwork();
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^\d+$/.test(value)) return Number(value);
  return value.split(',').map(s => s.trim()).filter(Boolean);
}

export function securityHeadersEnabled() {
  const value = process.env.RESOLVER_SECURITY_HEADERS;
  return value === undefined || value === '' ? restrictedNetwork() : ['true', '1'].includes(value);
}

function configuredOrigins() {
  return (process.env.RESOLVER_ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
}

export function requestOriginAllowed(req, management = false) {
  const origin = req.get('Origin');
  if (!origin) return !management || !restrictedNetwork() || req.get('Sec-Fetch-Site') !== 'cross-site';
  const allowed = configuredOrigins();
  if (allowed.includes('*') || allowed.includes(origin)) return true;
  if (origin === 'null') return !restrictedNetwork() && allowed.length === 0;
  let url;
  try { url = new URL(origin); } catch { return false; }
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin) return false;
  if (!restrictedNetwork() && allowed.length === 0) return true;
  return url.host === req.get('Host') && (!management || req.get('Sec-Fetch-Site') !== 'cross-site');
}

export function networkAccess(req, res, next) {
  if (!requestOriginAllowed(req)) return res.status(403).json({ error: '访问来源不在部署者配置的允许范围内' });
  const origin = req.get('Origin');
  if (origin) {
    res.vary('Origin');
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
  }
  if (req.method === 'OPTIONS' && req.get('Access-Control-Request-Method')) {
    res.vary('Access-Control-Request-Headers');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', req.get('Access-Control-Request-Headers') || 'Content-Type, Authorization');
    res.setHeader('Access-Control-Max-Age', '600');
    return res.sendStatus(204);
  }
  next();
}
