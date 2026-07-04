// ════════════════════════════════════
// PHÒNG ĐỌC SỐ 0 — Khoá / Mở cổng đăng ký nhận mã
//
// GET  /api/registration-gate  → public, KHÔNG cần đăng nhập admin.
//      Được gọi bởi js/auth.js (cổng đăng ký ở trang chủ) để biết cổng
//      đang mở hay đang bị khoá, TRƯỚC khi người dùng bấm "Nhận mã".
//      Trả về: { ok: true, open: boolean }
//
// PUT  /api/registration-gate  → CHỈ admin. Body: { open: true|false }
//      Dùng bởi admin/settings.html để khoá/mở cổng bất cứ lúc nào.
//
// Bảng Supabase "app_settings" (tạo nếu chưa có, chạy 1 lần trong SQL editor):
//
//   create table if not exists public.app_settings (
//     key        text primary key,
//     value      jsonb not null,
//     updated_at timestamptz not null default now()
//   );
//   insert into public.app_settings (key, value)
//     values ('registration_open', 'true')
//     on conflict (key) do nothing;
//
// Nếu bảng/dòng này CHƯA tồn tại (chưa chạy migration ở trên), API mặc định
// coi cổng là ĐANG MỞ — để tránh việc vô tình khoá đăng ký của toàn site
// chỉ vì thiếu migration.
// ════════════════════════════════════

const { getSupabaseAdmin } = require('./_lib/supabaseAdmin');
const { requireAdmin } = require('./_lib/auth');

const KEY = 'registration_open';

module.exports = async function handler(req, res) {
  const db = getSupabaseAdmin();

  if (req.method === 'GET') {
    const { data, error } = await db
      .from('app_settings')
      .select('value')
      .eq('key', KEY)
      .maybeSingle();
    // Lỗi truy vấn (vd. bảng chưa tồn tại) → không chặn front-end, coi như mở.
    if (error) return res.status(200).json({ ok: true, open: true });
    const open = data ? data.value !== false : true;
    return res.status(200).json({ ok: true, open });
  }

  if (req.method === 'PUT') {
    if (!requireAdmin(req, res)) return;
    const { open } = req.body || {};
    if (typeof open !== 'boolean') {
      return res.status(400).json({ ok: false, reason: 'missing_open' });
    }
    const { error } = await db
      .from('app_settings')
      .upsert(
        { key: KEY, value: open, updated_at: new Date().toISOString() },
        { onConflict: 'key' }
      );
    if (error) return res.status(500).json({ ok: false, reason: error.message });
    return res.status(200).json({ ok: true, open });
  }

  return res.status(405).json({ ok: false, reason: 'method_not_allowed' });
};
