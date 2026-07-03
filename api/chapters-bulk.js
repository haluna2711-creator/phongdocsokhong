const { getSupabaseAdmin } = require('./_lib/supabaseAdmin');
const { requireAdmin } = require('./_lib/auth');
const { computeNextSlots } = require('./_lib/schedule');

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

  const db = getSupabaseAdmin();
  const { novel_id, chapters, mode, schedule } = req.body || {};
  // chapters: [{ title, content, volume?, chapter_number? }, ...]  — theo đúng thứ tự muốn đăng
  // mode: 'draft' | 'scheduled' | 'publish_now'
  // schedule (chỉ cần khi mode='scheduled'):
  //   { daysOfWeek:[0..6], timeOfDay:'HH:mm', timezone:'Asia/Bangkok',
  //     chaptersPerSlot:1, startFrom:'now'|'after_last' }

  if (!novel_id || !Array.isArray(chapters) || chapters.length === 0) {
    return res.status(400).json({ ok: false, reason: 'missing_fields' });
  }

  // Xác định số chương bắt đầu (tiếp nối chương cuối cùng đã có)
  const { data: maxRow } = await db
    .from('chapters').select('chapter_number')
    .eq('novel_id', novel_id)
    .order('chapter_number', { ascending: false }).limit(1).maybeSingle();
  let nextNumber = maxRow ? Number(maxRow.chapter_number) + 1 : 1;

  let scheduledTimes = [];
  if (mode === 'scheduled') {
    if (!schedule || !Array.isArray(schedule.daysOfWeek) || schedule.daysOfWeek.length === 0) {
      return res.status(400).json({ ok: false, reason: 'missing_schedule' });
    }

    let after = null;
    if (schedule.startFrom === 'after_last') {
      const { data: lastScheduled } = await db
        .from('chapters').select('scheduled_at')
        .eq('novel_id', novel_id)
        .not('scheduled_at', 'is', null)
        .order('scheduled_at', { ascending: false }).limit(1).maybeSingle();
      after = lastScheduled ? lastScheduled.scheduled_at : null;
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
  const rows = chapters.map((ch, i) => {
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

  const { data, error } = await db.from('chapters').insert(rows).select();
  if (error) return res.status(500).json({ ok: false, reason: error.message });

  // Đăng hàng loạt chương cũng tính là "cập nhật truyện" → lên mục Mới Cập Nhật.
  await db.from('novels').update({ updated_at: now }).eq('id', novel_id);

  return res.status(200).json({ ok: true, chapters: data });
};
