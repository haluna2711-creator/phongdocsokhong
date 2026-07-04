const { getSupabaseAdmin } = require('./_lib/supabaseAdmin');

// ════════════════════════════════════
// PHÒNG ĐỌC SỐ 0 — API "Engagement" (Lượt xem truyện + Reaction theo chương)
// GỘP CHUNG 1 FILE (thay vì tách api/reactions.js riêng) vì gói Vercel Hobby
// chỉ cho tối đa 12 Serverless Functions/deployment và repo đã dùng hết 12/12
// (xem ghi chú tương tự trong api/comments.js).
//
// QUAN TRỌNG: phân luồng "lượt xem truyện" / "reaction theo chương" dựa vào
// HÌNH DẠNG DỮ LIỆU gửi lên (có novel_id hay có post/type), giống cách
// api/comments.js phân luồng công khai/quản trị.
//
//   - Lượt xem truyện (giữ nguyên hành vi cũ, không đổi):
//       POST /api/views { novel_id }              → ghi 1 lượt xem
//
//   - Reaction theo chương (MỚI — bảng "reactions" đã có sẵn trên Supabase:
//     id bigserial, post_key text, type text, created_at timestamptz):
//       GET  /api/views?post=...                  → { ok, counts }
//       POST /api/views { post, type }             → ghi 1 lượt react, trả về counts mới
// ════════════════════════════════════

const REACTION_TYPES = ['love', 'fire', 'cry', 'shock', 'star'];

async function getReactionCounts(db, postKey) {
  const { data, error } = await db.from('reactions').select('type').eq('post_key', postKey);
  if (error) throw error;
  const counts = {};
  (data || []).forEach((r) => { counts[r.type] = (counts[r.type] || 0) + 1; });
  return counts;
}

module.exports = async function handler(req, res) {
  const db = getSupabaseAdmin();

  // ── GET: chỉ dùng cho reaction (xem lượt xem truyện không có endpoint đọc riêng) ──
  if (req.method === 'GET') {
    const post = req.query.post || '';
    if (!post) return res.status(400).json({ ok: false, reason: 'missing_post' });

    try {
      const counts = await getReactionCounts(db, String(post));
      return res.status(200).json({ ok: true, counts });
    } catch (err) {
      return res.status(500).json({ ok: false, reason: err.message });
    }
  }

  if (req.method === 'POST') {
    const { novel_id, post, type } = req.body || {};

    // ── Có "post" + "type" → reaction theo chương ──
    if (post && type) {
      if (!REACTION_TYPES.includes(type)) {
        return res.status(400).json({ ok: false, reason: 'invalid_type' });
      }
      const { error: insertErr } = await db.from('reactions').insert({
        post_key: String(post).slice(0, 500),
        type,
      });
      if (insertErr) return res.status(500).json({ ok: false, reason: insertErr.message });

      try {
        const counts = await getReactionCounts(db, String(post));
        return res.status(200).json({ ok: true, counts });
      } catch (err) {
        return res.status(500).json({ ok: false, reason: err.message });
      }
    }

    // ── Có "novel_id" → lượt xem truyện (hành vi cũ, giữ nguyên) ──
    if (novel_id) {
      // Chỉ ghi nhận view cho truyện có tồn tại và đang published, tránh spam id rác.
      const { data: novel, error: findErr } = await db
        .from('novels')
        .select('id')
        .eq('id', novel_id)
        .eq('published', true)
        .maybeSingle();

      if (findErr) return res.status(500).json({ ok: false, reason: findErr.message });
      if (!novel) return res.status(404).json({ ok: false, reason: 'novel_not_found' });

      const { error } = await db.from('novel_views').insert({ novel_id });
      if (error) return res.status(500).json({ ok: false, reason: error.message });

      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ ok: false, reason: 'missing_fields' });
  }

  return res.status(405).json({ ok: false, reason: 'method_not_allowed' });
};
