import crypto from 'node:crypto';
import { config } from '../config.js';

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

// If ACCESS_TOKEN is set, every /api route except /health needs it as "Authorization: Bearer <token>"
// or ?token=<token> (EventSource and download links cannot send headers).
export function requireToken(req, res, next) {
  if (!config.accessToken || req.method === 'OPTIONS' || req.path === '/health') return next();
  const header = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const supplied = header || req.query.token || '';
  if (supplied && safeEqual(supplied, config.accessToken)) return next();
  res.status(401).json({ error: 'Unauthorized: access token required' });
}
