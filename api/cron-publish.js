const { getCockroachPool } = require('./_lib/cockroachAdmin');
const { getSupabaseAdmin } = require('./_lib/supabaseAdmin');
const { syncChapterCounts } = require('./_lib/chapterCounts');

// Vercel Cron gọi endpoint này định kỳ (xem vercel.json → "crons").
// Bảo vệ bằng CRON_SECRET để không ai khác gọi được endpoint này.
module.exports = async function handler(req, res) {
  const auth = req.headers.authorization || '';
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return res.status(401).json({ ok: false, reason: 'unauthorized' });
  }

  try {
    const pool = getCockroachPool();
    const nowIso = new Date().toISOString();

    const { rows: due } = await pool.query(
      `SELECT id, novel_id FROM chapters WHERE status = 'scheduled' AND scheduled_at <= $1`,
      [nowIso]
    );

    if (!due || due.length === 0) return res.status(200).json({ ok: true, published: 0 });

    const ids = due.map((r) => r.id);
    await pool.query(
      `UPDATE chapters SET status = 'published', published_at = $1 WHERE id = ANY($2::uuid[])`,
      [nowIso, ids]
    );

    // Chương vừa tự động lên sóng → đánh dấu (các) truyện cha "mới cập nhật"
    // + đồng bộ lại số đếm chương cho từng truyện bị ảnh hưởng.
    const db = getSupabaseAdmin();
    const novelIds = [...new Set(due.map((r) => r.novel_id).filter(Boolean))];
    if (novelIds.length) {
      await db.from('novels').update({ updated_at: nowIso }).in('id', novelIds);
      await Promise.all(novelIds.map((nid) => syncChapterCounts(nid)));
    }

    return res.status(200).json({ ok: true, published: ids.length });
  } catch (err) {
    return res.status(500).json({ ok: false, reason: err.message });
  }
};
