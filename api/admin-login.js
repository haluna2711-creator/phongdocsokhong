const { signSession, setSessionCookie } = require('./_lib/auth');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, reason: 'method_not_allowed' });
  }

  const { password } = req.body || {};
  const expected = process.env.ADMIN_PASSWORD;

  if (!expected) {
    return res.status(500).json({ ok: false, reason: 'server_not_configured' });
  }

  if (!password || password !== expected) {
    return res.status(401).json({ ok: false, reason: 'wrong_password' });
  }

  const token = signSession();
  setSessionCookie(res, token);
  return res.status(200).json({ ok: true });
};
