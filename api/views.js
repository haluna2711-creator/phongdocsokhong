const { getSupabaseAdmin } = require('./_lib/supabaseAdmin');

// API công khai (không cần đăng nhập) — độc giả bấm "ĐỌC NGAY" sẽ gọi
// POST /api/views với { novel_id } để ghi 1 lượt xem vào bảng novel_views.
// Nhờ có cột viewed_at, /api/novels sẽ tự tính được:
//   - view_count_total  : tổng lượt xem (dùng cho "Thư Viện Truyện" — đọc nhiều nhất)
//   - view_count_month  : lượt xem trong tháng hiện tại (dùng cho "Nổi Bật")
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, reason: 'method_not_allowed' });

  const db = getSupabaseAdmin();
  const { novel_id } = req.body || {};
  if (!novel_id) return res.status(400).json({ ok: false, reason: 'missing_novel_id' });

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
};
