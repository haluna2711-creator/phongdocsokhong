// ════════════════════════════════════
// PHÒNG ĐỌC SỐ 0 — Tự khoá tài khoản không hoạt động
// Chạy định kỳ bởi Vercel Cron (xem vercel.json → "crons").
// Khoá (disabled = true) mọi tài khoản trong bảng "readers" mà:
//   - last_login_at cũ hơn INACTIVE_YEARS năm, HOẶC
//   - chưa từng đăng nhập lần nào (last_login_at NULL) và created_at
//     cũng đã cũ hơn INACTIVE_YEARS năm.
// Tài khoản đã disabled sẵn thì bỏ qua (không cần xử lý lại).
//
// Sau khi bị khoá, người dùng vẫn có thể đăng ký lại bằng MỘT EMAIL KHÁC —
// vì action=register chỉ chặn khi trùng đúng email đang tồn tại; email mới
// luôn tạo được dòng mới trong bảng "readers", không liên quan gì tới email
// cũ đã bị khoá.
// ════════════════════════════════════

const { getSupabaseAdmin } = require('./_lib/supabaseAdmin');

const INACTIVE_YEARS = 2;

module.exports = async function handler(req, res) {
  const auth = req.headers.authorization || '';
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  // Cùng cơ chế bảo vệ với api/cron-publish.js — Vercel Cron tự gửi header
  // Authorization: Bearer <CRON_SECRET> nếu bạn đã đặt biến môi trường này.
  if (!process.env.CRON_SECRET || auth !== expected) {
    return res.status(401).json({ ok: false, reason: 'unauthorized' });
  }

  const db = getSupabaseAdmin();

  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - INACTIVE_YEARS);
  const cutoffIso = cutoff.toISOString();

  // Đã đăng nhập ít nhất 1 lần nhưng lần cuối đã quá lâu.
  const { data: staleLoggedIn, error: err1 } = await db
    .from('readers')
    .select('id')
    .eq('disabled', false)
    .not('last_login_at', 'is', null)
    .lt('last_login_at', cutoffIso);
  if (err1) return res.status(500).json({ ok: false, reason: err1.message });

  // Chưa từng đăng nhập lần nào kể từ lúc đăng ký, và đăng ký cũng đã quá lâu.
  const { data: staleNeverLoggedIn, error: err2 } = await db
    .from('readers')
    .select('id')
    .eq('disabled', false)
    .is('last_login_at', null)
    .lt('created_at', cutoffIso);
  if (err2) return res.status(500).json({ ok: false, reason: err2.message });

  const ids = [
    ...new Set([...(staleLoggedIn || []), ...(staleNeverLoggedIn || [])].map((r) => r.id)),
  ];

  if (!ids.length) return res.status(200).json({ ok: true, locked: 0 });

  const { error: updErr } = await db
    .from('readers')
    .update({ disabled: true })
    .in('id', ids);
  if (updErr) return res.status(500).json({ ok: false, reason: updErr.message });

  return res.status(200).json({ ok: true, locked: ids.length });
};
