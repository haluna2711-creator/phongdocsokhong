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
    const { novel_id, novel_slug, id, slug } = req.query;
    // Khi lấy 1 chương cụ thể (id hoặc slug) trả về đầy đủ (kèm content).
    // Khi lấy danh sách (mục lục) chỉ trả trường nhẹ để tránh tải content của cả trăm chương.
    const single = !!(id || slug);
    const fields = single
      ? '*'
      : 'id, novel_id, title, slug, volume, chapter_number, status, published_at, scheduled_at';

    // novel_slug: lọc kèm theo slug truyện ngay trong 1 câu query (join `!inner`),
    // KHÔNG cần round-trip riêng để đổi slug -> novel_id trước. Trước đây tham số
    // này bị bỏ qua hoàn toàn nên `slug` (mã chương) có thể trùng giữa 2 truyện
    // khác nhau và trả nhầm chương — filter theo novel_slug khắc phục luôn lỗi đó.
    const selectFields = novel_slug ? `${fields}, novels!inner(slug)` : fields;
    let query = db.from('chapters').select(selectFields);
    if (id) query = query.eq('id', id);
    if (slug) query = query.eq('slug', slug);
    if (novel_id) query = query.eq('novel_id', novel_id);
    if (novel_slug) query = query.eq('novels.slug', novel_slug);
    if (!admin) query = query.eq('status', 'published');
    query = query.order('chapter_number', { ascending: true });

    const { data, error } = await query;
    if (error) return res.status(500).json({ ok: false, reason: error.message });
    // Bỏ field novels lồng vào (chỉ dùng để lọc) trước khi trả về cho client.
    const cleaned = novel_slug ? (data || []).map(({ novels, ...rest }) => rest) : data;
    // Nội dung chương đã published ít đổi → cho phép cache ngắn hạn ở CDN/Edge,
    // giúp các lượt đọc sau (đặc biệt chương hot) trả về gần như tức thì.
    if (!admin) res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=600');
    return res.status(200).json({ ok: true, chapters: cleaned });
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

    // Đánh dấu truyện vừa có chương mới → mục "Truyện Mới Cập Nhật" nhận được.
    await db.from('novels').update({ updated_at: new Date().toISOString() }).eq('id', data.novel_id);

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

    // Sửa nội dung / đăng tải chương cũng tính là "cập nhật truyện".
    await db.from('novels').update({ updated_at: new Date().toISOString() }).eq('id', data.novel_id);

    return res.status(200).json({ ok: true, chapter: data });
  }

  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ ok: false, reason: 'missing_id' });

    // Lấy novel_id trước khi xoá để có thể chạm updated_at của truyện cha.
    const { data: existing } = await db.from('chapters').select('novel_id').eq('id', id).maybeSingle();

    const { error } = await db.from('chapters').delete().eq('id', id);
    if (error) return res.status(500).json({ ok: false, reason: error.message });

    if (existing?.novel_id) {
      await db.from('novels').update({ updated_at: new Date().toISOString() }).eq('id', existing.novel_id);
    }
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ ok: false, reason: 'method_not_allowed' });
};
