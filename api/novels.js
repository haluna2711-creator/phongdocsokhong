const { getSupabaseAdmin } = require('./_lib/supabaseAdmin');
const { isAdmin, requireAdmin } = require('./_lib/auth');

function slugify(str) {
  return String(str)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // bỏ dấu
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

module.exports = async function handler(req, res) {
  const db = getSupabaseAdmin();

  // ── GET: list hoặc lấy 1 truyện theo id/slug ──
  if (req.method === 'GET') {
    const admin = isAdmin(req);
    const { id, slug, light } = req.query;

    // light=1: dùng cho trang đọc chương (doc.html) — chỉ cần các trường cơ bản
    // để hiện tiêu đề/mục lục, KHÔNG cần đếm chapter_count / view_count (2 query
    // phụ tốn thời gian). Giúp mở chương nhanh hơn đáng kể.
    const isLight = light === '1' && !admin;
    const fields = isLight ? 'id, slug, title, cover_url' : '*, novel_labels(label_id, position, labels(id,name,slug))';

    let query = db.from('novels').select(fields);
    if (!admin) query = query.eq('published', true);
    if (id) query = query.eq('id', id);
    if (slug) query = query.eq('slug', slug);
    query = query.order('created_at', { ascending: false });

    const { data, error } = await query;
        if (error) return res.status(500).json({ ok: false, reason: error.message });

    // position 0 = thể loại CHÍNH, các số sau = phụ
    (data || []).forEach((n) => {
      if (Array.isArray(n.novel_labels)) n.novel_labels.sort((a, b) => (a.position || 0) - (b.position || 0));
    });

    if (!isLight && data && data.length) {
      const novelIds = data.map((n) => n.id);
      const now = new Date();
      const startOfMonthIso = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

      // Đếm số chương + đếm lượt xem qua 2 hàm SQL (get_chapter_counts /
      // get_view_counts, xem sql/stats_functions.sql) — Postgres đếm sẵn bằng
      // GROUP BY và trả về ĐÚNG SỐ DÒNG BẰNG SỐ TRUYỆN, thay vì phải kéo về
      // toàn bộ chapters/novel_views rồi đếm bằng JS ở server. Hai bảng này
      // càng nhiều dữ liệu (nhiều view/chương) thì cách cũ càng chậm dần theo
      // thời gian; cách này giữ tốc độ ổn định vì đã có index hỗ trợ.
      // Hai truy vấn độc lập nhau → chạy song song bằng Promise.all thay vì
      // await tuần tự, giảm gần một nửa thời gian chờ.
      const [{ data: chRows, error: chErr }, { data: viewRows, error: vErr }] = await Promise.all([
        db.rpc('get_chapter_counts', { ids: novelIds, only_published: !admin }),
        db.rpc('get_view_counts', { ids: novelIds, month_start: startOfMonthIso }),
      ]);
      if (chErr) console.error('[api/novels] get_chapter_counts:', chErr.message);
      if (vErr) console.error('[api/novels] get_view_counts:', vErr.message);

      const chapterCounts = {};
      (chRows || []).forEach((r) => { chapterCounts[r.novel_id] = Number(r.cnt) || 0; });
      data.forEach((n) => { n.chapter_count = chapterCounts[n.id] || 0; });

      const totalCounts = {};
      const monthCounts = {};
      (viewRows || []).forEach((r) => {
        totalCounts[r.novel_id] = Number(r.total) || 0;
        monthCounts[r.novel_id] = Number(r.month) || 0;
      });
      data.forEach((n) => {
        n.view_count_total = totalCounts[n.id] || 0;
        n.view_count_month = monthCounts[n.id] || 0;
      });
    }

    // Nội dung công khai, ít đổi → cho phép CDN/Edge của Vercel cache ngắn hạn.
    // stale-while-revalidate: người dùng vẫn nhận phản hồi cực nhanh từ cache cũ
    // trong lúc Vercel âm thầm lấy bản mới ở nền cho lần sau.
    if (!admin) res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=600');

    return res.status(200).json({ ok: true, novels: data });
  }

  // ── Mọi thao tác ghi đều cần admin ──
  if (!requireAdmin(req, res)) return;

  if (req.method === 'POST') {
    const b = req.body || {};
    if (!b.title) return res.status(400).json({ ok: false, reason: 'missing_title' });
    const slug = b.slug ? slugify(b.slug) : slugify(b.title);

    const { data: novel, error } = await db
      .from('novels')
      .insert({
        title: b.title,
        slug,
        author: b.author || null,
        editor: b.editor || null,
        description: b.description || null,
        cover_url: b.cover_url || null,
        status: b.status || 'ongoing',
        tags: b.tags || [],
        published: b.published !== false,
      })
      .select()
      .single();

    if (error) return res.status(500).json({ ok: false, reason: error.message });

    if (Array.isArray(b.label_ids) && b.label_ids.length) {
      await db.from('novel_labels').insert(
        [...new Set(b.label_ids)].map((label_id, position) => ({ novel_id: novel.id, label_id, position }))
      );
    }
    return res.status(200).json({ ok: true, novel });
  }

  if (req.method === 'PUT') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ ok: false, reason: 'missing_id' });
    const b = req.body || {};
    const patch = {};
    ['title', 'author', 'editor', 'description', 'cover_url', 'status', 'tags', 'published']
      .forEach((k) => { if (b[k] !== undefined) patch[k] = b[k]; });
    if (b.slug) patch.slug = slugify(b.slug);

    const { data, error } = await db.from('novels').update(patch).eq('id', id).select().single();
    if (error) return res.status(500).json({ ok: false, reason: error.message });

    if (Array.isArray(b.label_ids)) {
      await db.from('novel_labels').delete().eq('novel_id', id);
      if (b.label_ids.length) {
        await db.from('novel_labels').insert([...new Set(b.label_ids)].map((label_id, position) => ({ novel_id: id, label_id, position }));
      }
    }
    return res.status(200).json({ ok: true, novel: data });
  }

  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ ok: false, reason: 'missing_id' });
    const { error } = await db.from('novels').delete().eq('id', id);
    if (error) return res.status(500).json({ ok: false, reason: error.message });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ ok: false, reason: 'method_not_allowed' });
};
