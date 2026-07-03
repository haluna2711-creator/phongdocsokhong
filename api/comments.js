// ════════════════════════════════════
// PHÒNG ĐỌC SỐ 0 — API bình luận (công khai + quản trị, gộp 1 file)
// Proxy tới Google Apps Script (gas/CommentsApi.gs).
//
// GỘP CHUNG 1 FILE (thay vì tách riêng) vì gói Vercel Hobby chỉ cho tối đa
// 12 Serverless Functions/deployment.
//
// QUAN TRỌNG: phân luồng công khai/quản trị dựa vào HÌNH DẠNG DỮ LIỆU gửi
// lên (có postUrl/name hay không), KHÔNG dựa vào việc trình duyệt có đang
// đăng nhập admin hay không — vì admin cũng có thể đang mở trang đọc truyện
// trong cùng trình duyệt để gửi 1 bình luận bình thường, và request đó vẫn
// phải được xử lý như công khai.
//
//   - Công khai (bất kỳ ai, kể cả admin đang duyệt web):
//       GET  /api/comments?postUrl=...            → xem bình luận 1 chương
//       POST /api/comments {postUrl,name,body,postTitle?,parentId?}
//                                                   → gửi bình luận / trả lời
//   - Quản trị (bắt buộc đăng nhập admin, dùng bởi admin/comments.html):
//       GET    /api/comments                       → xem toàn bộ (không kèm postUrl)
//       DELETE /api/comments?id=...                 → xoá 1 bình luận
//       POST   /api/comments {postUrl,postTitle,parentId,body} (không có "name")
//                                                   → admin trả lời
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
    // ── GET: có postUrl → công khai (xem bình luận 1 chương).
    //         không có postUrl → quản trị (xem toàn bộ, cần đăng nhập).
    if (req.method === 'GET') {
      const postUrl = req.query.postUrl || '';

      if (postUrl) {
        const r = await fetch(gasUrl('getComments', { postUrl }));
        const data = await r.json();
        if (!data.ok) return res.status(502).json({ ok: false, reason: data.error || 'gas_error' });
        return res.status(200).json({ ok: true, data: data.data });
      }

      if (!isAdmin(req)) return res.status(401).json({ ok: false, reason: 'unauthorized' });
      const r = await fetch(gasUrl('adminList', {}));
      const data = await r.json();
      if (!data.ok) return res.status(502).json({ ok: false, reason: data.error || 'gas_error' });
      return res.status(200).json({ ok: true, comments: data.data });
    }

    // ── DELETE: luôn luôn chỉ admin ──
    if (req.method === 'DELETE') {
      if (!isAdmin(req)) return res.status(401).json({ ok: false, reason: 'unauthorized' });
      const { id } = req.query;
      if (!id) return res.status(400).json({ ok: false, reason: 'missing_id' });
      const r = await fetch(gasUrl('adminDelete', { id }));
      const data = await r.json();
      if (!data.ok) return res.status(502).json({ ok: false, reason: data.error || 'gas_error' });
      return res.status(200).json({ ok: true });
    }

    // ── POST: có "name" → công khai (bình luận/trả lời của độc giả).
    //          không có "name" → admin trả lời (cần đăng nhập, bắt buộc parentId).
    if (req.method === 'POST') {
      const { postUrl, postTitle, name, body, parentId } = req.body || {};

      if (name) {
        if (!postUrl || !body) {
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

      if (!isAdmin(req)) return res.status(401).json({ ok: false, reason: 'unauthorized' });
      if (!postUrl || !parentId || !body) {
        return res.status(400).json({ ok: false, reason: 'missing_fields' });
      }
      const r = await fetch(gasUrl('adminReply', {
        postUrl,
        postTitle: postTitle || '',
        parentId,
        body,
        name: 'Quản trị viên',
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
