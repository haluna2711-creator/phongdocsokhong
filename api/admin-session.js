const { isAdmin } = require('./_lib/auth');

module.exports = async function handler(req, res) {
  return res.status(200).json({ ok: isAdmin(req) });
};
