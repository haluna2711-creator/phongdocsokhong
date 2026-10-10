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

  // Tách 2 nhóm: chương THAY THẾ (có replace_id = id chương đã có) và chương MỚI.
  const replacements = chapters.filter((c) => c.replace_id);
  const fresh = chapters.filter((c) => !c.replace_id);
  const replaced = [];

  if (replacements.length) {
    const ids = replacements.map((c) => c.replace_id);
    if (new Set(ids).size !== ids.length) {
      return res.status(400).json({ ok: false, reason: 'duplicate_replace_id' });
    }
    // Chỉ cho phép thay thế chương THUỘC ĐÚNG truyện này.
    const { data: found, error: findErr } = await db
      .from('chapters').select('id').eq('novel_id', novel_id).in('id', ids);
    if (findErr) return res.status(500).json({ ok: false, reason: findErr.message });
    if ((found || []).length !== ids.length) {
      return res.status(400).json({ ok: false, reason: 'invalid_replace_id' });
    }

    // Ghi đè NỘI DUNG + tên (+ quyển nếu có nhập). Giữ nguyên slug, số chương, trạng thái và
    // lịch đăng để link cũ / tiến độ đọc của bạn đọc không bị hỏng. Làm theo lô 10 chương/lần.
    for (let i = 0; i < replacements.length; i += 10) {
      const batch = replacements.slice(i, i + 10);
      const results = await Promise.all(batch.map((ch) => {
        const patch = { content: ch.content || '' };
        if (ch.title) patch.title = ch.title;
        if (ch.volume) patch.volume = ch.volume;
        return db.from('chapters').update(patch)
          .eq('id', ch.replace_id).eq('novel_id', novel_id)
          .select('id, title, chapter_number, status').single();
      }));
      for (const r of results) {
        if (r.error) return res.status(500).json({ ok: false, reason: r.error.message });
        replaced.push(r.data);
      }
    }
  }

  // Xác định số chương bắt đầu (tiếp nối chương cuối cùng đã có)
  const { data: maxRow } = await db
    .from('chapters').select('chapter_number')
    .eq('novel_id', novel_id)
    .order('chapter_number', { ascending: false }).limit(1).maybeSingle();
  let nextNumber = maxRow ? Number(maxRow.chapter_number) + 1 : 1;

  let scheduledTimes = [];
  if (mode === 'scheduled' && fresh.length) {
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
      count: fresh.length,
      after,
    });
  }

  const now = new Date().toISOString();
  const rows = fresh.map((ch, i) => {
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

  let data = [];
  if (rows.length) {
    const ins = await db.from('chapters').insert(rows).select();
    if (ins.error) return res.status(500).json({ ok: false, reason: ins.error.message });
    data = ins.data;
  }

  // Đăng hàng loạt chương cũng tính là "cập nhật truyện" → lên mục Mới Cập Nhật.
  await db.from('novels').update({ updated_at: now }).eq('id', novel_id);

  return res.status(200).json({ ok: true, chapters: data, replaced });
};
