// ════════════════════════════════════
// PHÒNG ĐỌC SỐ 0 — Admin API cho bình luận
// Proxy có xác thực tới Google Apps Script (gas/CommentsApi.gs).
// Khoá bí mật (COMMENTS_ADMIN_KEY) chỉ nằm ở server, không lộ ra trình duyệt.
//
// Biến môi trường cần thiết trên Vercel:
//   COMMENT_URL          — URL /exec của Apps Script (giống js/config.js -> COMMENT_URL)
//   COMMENTS_ADMIN_KEY    — phải trùng với Script Property "ADMIN_KEY" trong Apps Script
// ════════════════════════════════════

const { requireAdmin } = require('./_lib/auth');

function gasUrl(action, params) {
  const base = process.env.COMMENT_URL;
  if (!base) throw new Error('Thiếu biến môi trường COMMENT_URL.');
  const key = process.env.COMMENTS_ADMIN_KEY;
  if (!key) throw new Error('Thiếu biến môi trường COMMENTS_ADMIN_KEY.');
  const qs = new URLSearchParams({ action, key, ...params });
  return `${base}?${qs.toString()}`;
}

module.exports = async function handler(req, res) {
  if (!requireAdmin(req, res)) return;

  try {
    if (req.method === 'GET') {
      const postUrl = req.query.postUrl || '';
      const r = await fetch(gasUrl('adminList', postUrl ? { postUrl } : {}));
      const data = await r.json();
      if (!data.ok) return res.status(502).json({ ok: false, reason: data.error || 'gas_error' });
      return res.status(200).json({ ok: true, comments: data.data });
    }

    if (req.method === 'DELETE') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ ok: false, reason: 'missing_id' });
      const r = await fetch(gasUrl('adminDelete', { id }));
      const data = await r.json();
      if (!data.ok) return res.status(502).json({ ok: false, reason: data.error || 'gas_error' });
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'POST') {
      const { postUrl, postTitle, parentId, body, name } = req.body || {};
      if (!postUrl || !parentId || !body) {
        return res.status(400).json({ ok: false, reason: 'missing_fields' });
      }
      const r = await fetch(gasUrl('adminReply', {
        postUrl,
        postTitle: postTitle || '',
        parentId,
        body,
        name: name || 'Quản trị viên',
      }));
      const data = await r.json();
      if (!data.ok) return res.status(502).json({ ok: false, reason: data.error || 'gas_error' });
      return res.status(200).json({ ok: true, id: data.id });
    }

    return res.status(405).json({ ok: false, reason: 'method_not_allowed' });
  } catch (err) {
    return res.status(500).json({ ok: false, reason: err.message });
  }
};
