import { timingSafeEqual } from 'node:crypto';

export function equalSecret(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function managementAccess(req, res, next) {
  // Express routing is case-insensitive by default; match that policy here.
  const route = req.path.toLowerCase();
  const platformPublic = /^\/api\/(?:time\/?$|broadcast\/(?:output|events|heartbeat)\/?$|displays\/(?:register|events)\/?$|displays\/[a-f0-9]{32}\/(?:state|events|heartbeat|renew-code|settings)\/?$|media\/read\/[a-f0-9]{32}\/?$)/.test(route);
  const publicApi = platformPublic || /^\/api\/(?:health\/?$|watch(?:\/|$)|game\/[^/]+(?:\/playback)?\/?$)/.test(route);
  const management = (route.startsWith('/api/') && !publicApi) ||
    ['/index', '/index.html', '/display', '/display.html', '/logos', '/logos.html', '/presets', '/presets.html', '/preview', '/preview.html', '/render-test.html'].includes(route);
  const platformManagement = /^\/(?:resolver|contest|presentation-admin)(?:\/|$)/.test(route) || (/^\/live(?:\/|$)/.test(route) && !/^\/live\/(?:program|overlay)(?:\/|$)/.test(route));
  if (!management && !platformManagement) return next();
  const key = process.env.RESOLVER_ADMIN_KEY;
  if (key) {
    const basic = /^Basic\s+(\S+)$/i.exec(req.get('Authorization') || '');
    const credential = basic ? Buffer.from(basic[1], 'base64').toString() : '';
    const password = credential.startsWith('admin:') ? credential.slice(6) : '';
    if (!equalSecret(req.get('X-Resolver-Admin'), key) && !equalSecret(password, key)) {
      res.setHeader('WWW-Authenticate', 'Basic realm="Resolver management", charset="UTF-8"');
      return res.status(401).json({ error: '配置中心需要管理员凭据（用户名 admin）' });
    }
  } else {
    let localHost = false;
    try { localHost = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(`http://${req.get('Host')}`).hostname); }
    catch { /* Invalid Host is not an authorized local management origin. */ }
    if (!localHost || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) {
      return res.status(403).json({ error: '配置中心仅允许本机地址访问；局域网或域名主持请设置 RESOLVER_ADMIN_KEY' });
    }
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const origin = req.get('Origin');
    let sameHost = !origin;
    try {
      const parsed = new URL(origin);
      sameHost = ['http:', 'https:'].includes(parsed.protocol) && parsed.host === req.get('Host');
    } catch { /* A missing or malformed Origin is handled by sameHost. */ }
    if (!sameHost || req.get('Sec-Fetch-Site') === 'cross-site') return res.status(403).json({ error: '不允许跨站管理请求' });
  }
  next();
}
