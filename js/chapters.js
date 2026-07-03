const { getSupabaseAdmin } = require('./_lib/supabaseAdmin');
const { isAdmin, requireAdmin } = require('./_lib/auth');

function slugify(str) {
  return String(str)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

module.exports = async function handler(req, res) {
  const db = getSupabaseAdmin();

  if (req.method === 'GET') {
    const admin = isAdmin(req);
    const { novel_id, id, slug } = req.query;
    // Khi lấy 1 chương cụ thể (id hoặc slug) trả về đầy đủ (kèm content).
    // Khi lấy danh sách (mục lục) chỉ trả trường nhẹ để tránh tải content của cả trăm chương.
    const single = !!(id || slug);
    const fields = single
      ? '*'
      : 'id, novel_id, title, slug, volume, chapter_number, status, published_at, scheduled_at';
    let query = db.from('chapters').select(fields);
    if (id) query = query.eq('id', id);
    if (slug) query = query.eq('slug', slug);
    if (novel_id) query = query.eq('novel_id', novel_id);
    if (!admin) query = query.eq('status', 'published');
    query = query.order('chapter_number', { ascending: true });

    const { data, error } = await query;
    if (error) return res.status(500).json({ ok: false, reason: error.message });
    return res.status(200).json({ ok: true, chapters: data });
  }

  if (!requireAdmin(req, res)) return;

  if (req.method === 'POST') {
    const b = req.body || {};
    if (!b.novel_id || !b.title) return res.status(400).json({ ok: false, reason: 'missing_fields' });

    let chapterNumber = b.chapter_number;
    if (chapterNumber === undefined || chapterNumber === null) {
      const { data: maxRow } = await db
        .from('chapters').select('chapter_number')
        .eq('novel_id', b.novel_id)
        .order('chapter_number', { ascending: false }).limit(1).maybeSingle();
      chapterNumber = maxRow ? Number(maxRow.chapter_number) + 1 : 1;
    }

    const { data, error } = await db.from('chapters').insert({
      novel_id: b.novel_id,
      title: b.title,
      slug: b.slug ? slugify(b.slug) : slugify(b.title),
      volume: b.volume || null,
      content: b.content || '',
      chapter_number: chapterNumber,
      status: b.status || 'draft',
      scheduled_at: b.scheduled_at || null,
      published_at: b.status === 'published' ? new Date().toISOString() : null,
    }).select().single();

    if (error) return res.status(500).json({ ok: false, reason: error.message });
    return res.status(200).json({ ok: true, chapter: data });
  }

  if (req.method === 'PUT') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ ok: false, reason: 'missing_id' });
    const b = req.body || {};
    const patch = {};
    ['title', 'volume', 'content', 'chapter_number', 'status', 'scheduled_at']
      .forEach((k) => { if (b[k] !== undefined) patch[k] = b[k]; });
    if (b.slug) patch.slug = slugify(b.slug);
    if (patch.status === 'published') {
      patch.published_at = new Date().toISOString();
      patch.scheduled_at = null;
    }
    if (patch.status === 'draft') {
      patch.scheduled_at = null;
    }

    const { data, error } = await db.from('chapters').update(patch).eq('id', id).select().single();
    if (error) return res.status(500).json({ ok: false, reason: error.message });
    return res.status(200).json({ ok: true, chapter: data });
  }

  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ ok: false, reason: 'missing_id' });
    const { error } = await db.from('chapters').delete().eq('id', id);
    if (error) return res.status(500).json({ ok: false, reason: error.message });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ ok: false, reason: 'method_not_allowed' });
};
