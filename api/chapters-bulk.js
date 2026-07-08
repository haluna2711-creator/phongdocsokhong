const { getCockroachPool } = require('./_lib/cockroachAdmin');
const { getSupabaseAdmin } = require('./_lib/supabaseAdmin');
const { requireAdmin } = require('./_lib/auth');
const { computeNextSlots } = require('./_lib/schedule');
const { syncChapterCounts } = require('./_lib/chapterCounts');

function slugify(str) {
  return String(str)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, reason: 'method_not_allowed' });
  if (!requireAdmin(req, res)) return;

  const pool = getCockroachPool();
  const { novel_id, chapters, mode, schedule } = req.body || {};

  if (!novel_id || !Array.isArray(chapters) || chapters.length === 0) {
    return res.status(400).json({ ok: false, reason: 'missing_fields' });
  }

  try {
    // Xác định số chương bắt đầu (tiếp nối chương cuối cùng đã có)
    const { rows: maxRows } = await pool.query(
      `SELECT chapter_number FROM chapters WHERE novel_id = $1 ORDER BY chapter_number DESC LIMIT 1`,
      [novel_id]
    );
    let nextNumber = maxRows[0] ? Number(maxRows[0].chapter_number) + 1 : 1;

    let scheduledTimes = [];
    if (mode === 'scheduled') {
      if (!schedule || !Array.isArray(schedule.daysOfWeek) || schedule.daysOfWeek.length === 0) {
        return res.status(400).json({ ok: false, reason: 'missing_schedule' });
      }

      let after = null;
      if (schedule.startFrom === 'after_last') {
        const { rows: lastRows } = await pool.query(
          `SELECT scheduled_at FROM chapters
           WHERE novel_id = $1 AND scheduled_at IS NOT NULL
           ORDER BY scheduled_at DESC LIMIT 1`,
          [novel_id]
        );
        after = lastRows[0] ? lastRows[0].scheduled_at : null;
      }

      scheduledTimes = computeNextSlots({
        daysOfWeek: schedule.daysOfWeek,
        timeOfDay: schedule.timeOfDay || '17:00',
        timezone: schedule.timezone || 'Asia/Bangkok',
        chaptersPerSlot: schedule.chaptersPerSlot || 1,
        count: chapters.length,
        after,
      });
    }

    const now = new Date().toISOString();
    const rowsToInsert = chapters.map((ch, i) => {
      const chapter_number = ch.chapter_number !== undefined && ch.chapter_number !== null
        ? ch.chapter_number : nextNumber + i;

      let status = 'draft';
      let scheduled_at = null;
      let published_at = null;

      if (mode === 'scheduled') {
        status = 'scheduled';
        scheduled_at = scheduledTimes[i];
      } else if (mode === 'publish_now') {
        status = 'published';
        published_at = now;
      }

      return {
        novel_id,
        title: ch.title || `Chương ${chapter_number}`,
        slug: slugify(ch.title || `chuong-${chapter_number}`),
        volume: ch.volume || null,
        content: ch.content || '',
        chapter_number,
        status,
        scheduled_at,
        published_at,
      };
    });

    // Chèn tuần tự trong 1 transaction — chapters-bulk thường vài chục chương,
    // không cần tối ưu multi-row VALUES; transaction đảm bảo tất cả-hoặc-không.
    const client = await pool.connect();
    const inserted = [];
    try {
      await client.query('BEGIN');
      for (const row of rowsToInsert) {
        const { rows } = await client.query(
          `INSERT INTO chapters
             (novel_id, title, slug, volume, content, chapter_number, status, scheduled_at, published_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           RETURNING *`,
          [row.novel_id, row.title, row.slug, row.volume, row.content, row.chapter_number,
            row.status, row.scheduled_at, row.published_at]
        );
        inserted.push(rows[0]);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    // Đăng hàng loạt chương cũng tính là "cập nhật truyện" + đồng bộ số đếm.
    const db = getSupabaseAdmin();
    await db.from('novels').update({ updated_at: now }).eq('id', novel_id);
    await syncChapterCounts(novel_id);

    return res.status(200).json({ ok: true, chapters: inserted });
  } catch (err) {
    return res.status(500).json({ ok: false, reason: err.message });
  }
};
