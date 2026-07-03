const jwt = require('jsonwebtoken');

const COOKIE_NAME = 'pds_admin_session';
const MAX_AGE_SEC = 60 * 60 * 24 * 7; // 7 ngày

function getSecret() {
  const s = process.env.ADMIN_JWT_SECRET;
  if (!s) throw new Error('Thiếu biến môi trường ADMIN_JWT_SECRET.');
  return s;
}

function signSession() {
  return jwt.sign({ role: 'admin' }, getSecret(), { expiresIn: MAX_AGE_SEC });
}

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    out[k] = decodeURIComponent(v);
  });
  return out;
}

function isAdmin(req) {
  try {
    const cookies = parseCookies(req);
    const token = cookies[COOKIE_NAME];
    if (!token) return false;
    const payload = jwt.verify(token, getSecret());
    return payload.role === 'admin';
  } catch (e) {
    return false;
  }
}

function setSessionCookie(res, token) {
  const isProd = process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';
  const attrs = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${MAX_AGE_SEC}`,
  ];
  if (isProd) attrs.push('Secure');
  res.setHeader('Set-Cookie', attrs.join('; '));
}

function clearSessionCookie(res) {
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`
  );
}

function requireAdmin(req, res) {
  if (!isAdmin(req)) {
    res.status(401).json({ ok: false, reason: 'unauthorized' });
    return false;
  }
  return true;
}

module.exports = {
  signSession,
  isAdmin,
  setSessionCookie,
  clearSessionCookie,
  requireAdmin,
};
