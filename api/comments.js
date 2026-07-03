// ════════════════════════════════════
// PHÒNG ĐỌC SỐ 0 — Public API cho bình luận (đọc + gửi bình luận chương)
// KHÔNG cần đăng nhập — proxy tới Google Apps Script (gas/CommentsApi.gs),
// dùng action "getComments" (xem) và "addComment" (gửi bình luận/trả lời).
// Dùng bởi js/reactions-comments.js trên trang đọc chương (doc.html).
//
// Để quản trị (xem toàn bộ nhiều chương / xoá / admin trả lời), xem
// api/admin-comments.js — endpoint đó mới cần đăng nhập admin.
//
// Biến môi trường cần thiết trên Vercel:
//   COMMENT_URL   — URL /exec của Apps Script (gas/CommentsApi.gs)
// ════════════════════════════════════

function gasUrl(action, params) {
  const base = process.env.COMMENT_URL;
  if (!base) throw new Error('Thiếu biến môi trường COMMENT_URL.');
  // COMMENTS_ADMIN_KEY không bắt buộc cho action công khai (getComments/
  // addComment không kiểm tra khoá này ở phía Apps Script), nhưng gửi kèm
  // nếu có sẵn cũng không sao.
  const key = process.env.COMMENTS_ADMIN_KEY || '';
  const qs = new URLSearchParams({ action, key, ...params });
  return `${base}?${qs.toString()}`;
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const postUrl = req.query.postUrl || '';
      if (!postUrl) return res.status(400).json({ ok: false, reason: 'missing_postUrl' });

      const r = await fetch(gasUrl('getComments', { postUrl }));
      const data = await r.json();
      if (!data.ok) return res.status(502).json({ ok: false, reason: data.error || 'gas_error' });
      return res.status(200).json({ ok: true, data: data.data });
    }

    if (req.method === 'POST') {
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
