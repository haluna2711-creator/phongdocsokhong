// ════════════════════════════════════
// PHÒNG ĐỌC SỐ 0 — API bình luận (công khai + quản trị, gộp 1 file)
// Proxy tới Google Apps Script (gas/CommentsApi.gs).
//
// GỘP CHUNG 1 FILE (thay vì tách api/comments.js + api/admin-comments.js)
// vì gói Vercel Hobby chỉ cho tối đa 12 Serverless Functions/deployment —
// tách file sẽ vượt giới hạn và làm deploy thất bại toàn bộ.
//
// Cách phân luồng: dựa vào có đang đăng nhập admin (cookie phiên) hay không.
//   - Độc giả thường (chưa đăng nhập admin):
//       GET  /api/comments?postUrl=...           → xem bình luận 1 chương
//       POST /api/comments  {postUrl,name,body,postTitle?,parentId?}
//                                                  → gửi bình luận / trả lời
//   - Admin (đã đăng nhập, dùng bởi admin/comments.html):
//       GET    /api/comments[?postUrl=...]        → xem toàn bộ (tất cả chương)
//       DELETE /api/comments?id=...                → xoá 1 bình luận
//       POST   /api/comments {postUrl,postTitle,parentId,body,name?}
//                                                  → admin trả lời (bắt buộc parentId)
//
// Biến môi trường cần thiết trên Vercel:
//   COMMENT_URL          — URL /exec của Apps Script (gas/CommentsApi.gs)
//   COMMENTS_ADMIN_KEY    — phải trùng Script Property "ADMIN_KEY" (chỉ cần
//                           cho các thao tác admin: list toàn bộ / xoá / reply)
// ════════════════════════════════════

const { isAdmin } = require('./_lib/auth');

function gasUrl(action, params) {
  const base = process.env.COMMENT_URL;
  if (!base) throw new Error('Thiếu biến môi trường COMMENT_URL.');
  const key = process.env.COMMENTS_ADMIN_KEY || '';
  const qs = new URLSearchParams({ action, key, ...params });
  return `${base}?${qs.toString()}`;
}

module.exports = async function handler(req, res) {
  try {
    const admin = isAdmin(req);

    // ── GET: admin xem toàn bộ (mọi chương), độc giả xem theo 1 chương ──
    if (req.method === 'GET') {
      if (admin) {
        const postUrl = req.query.postUrl || '';
        const r = await fetch(gasUrl('adminList', postUrl ? { postUrl } : {}));
        const data = await r.json();
        if (!data.ok) return res.status(502).json({ ok: false, reason: data.error || 'gas_error' });
        return res.status(200).json({ ok: true, comments: data.data });
      }

      const postUrl = req.query.postUrl || '';
      if (!postUrl) return res.status(400).json({ ok: false, reason: 'missing_postUrl' });
      const r = await fetch(gasUrl('getComments', { postUrl }));
      const data = await r.json();
      if (!data.ok) return res.status(502).json({ ok: false, reason: data.error || 'gas_error' });
      return res.status(200).json({ ok: true, data: data.data });
    }

    // ── DELETE: chỉ admin ──
    if (req.method === 'DELETE') {
      if (!admin) return res.status(401).json({ ok: false, reason: 'unauthorized' });
      const { id } = req.query;
      if (!id) return res.status(400).json({ ok: false, reason: 'missing_id' });
      const r = await fetch(gasUrl('adminDelete', { id }));
      const data = await r.json();
      if (!data.ok) return res.status(502).json({ ok: false, reason: data.error || 'gas_error' });
      return res.status(200).json({ ok: true });
    }

    // ── POST: admin trả lời (bắt buộc parentId), hoặc độc giả gửi bình luận/trả lời ──
    if (req.method === 'POST') {
      if (admin) {
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

      const { postUrl, postTitle, name, body, parentId } = req.body || {};
      if (!postUrl || !name || !body) {
        return res.status(400).json({ ok: false, reason: 'missing_fields' });
      }
      const r = await fetch(gasUrl('addComment', {
        postUrl,
        postTitle: postTitle || '',
        name: String(name).trim().slice(0, 60),
        body: String(body).trim().slice(0, 2000),
        parentId: parentId || '',
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
