const { getSupabaseAdmin } = require('./_lib/supabaseAdmin');

// Vercel Cron gọi endpoint này định kỳ (xem vercel.json → "crons").
// Bảo vệ bằng CRON_SECRET để không ai khác gọi được endpoint này.
module.exports = async function handler(req, res) {
  const auth = req.headers.authorization || '';
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  // Vercel Cron tự gửi header Authorization: Bearer <CRON_SECRET> nếu bạn
  // đặt biến môi trường CRON_SECRET — xem SETUP_GUIDE.md.
  if (!process.env.CRON_SECRET || auth !== expected) {
    return res.status(401).json({ ok: false, reason: 'unauthorized' });
  }

  const db = getSupabaseAdmin();
  const nowIso = new Date().toISOString();

  const { data: due, error: selErr } = await db
    .from('chapters')
    .select('id')
    .eq('status', 'scheduled')
    .lte('scheduled_at', nowIso);

  if (selErr) return res.status(500).json({ ok: false, reason: selErr.message });
  if (!due || due.length === 0) return res.status(200).json({ ok: true, published: 0 });

  const ids = due.map((r) => r.id);
  const { error: updErr } = await db
    .from('chapters')
    .update({ status: 'published', published_at: nowIso })
    .in('id', ids);

  if (updErr) return res.status(500).json({ ok: false, reason: updErr.message });
  return res.status(200).json({ ok: true, published: ids.length });
};
