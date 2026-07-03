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
    const fields = isLight ? 'id, slug, title, cover_url' : '*, novel_labels(label_id, labels(id,name,slug))';

    let query = db.from('novels').select(fields);
    if (!admin) query = query.eq('published', true);
    if (id) query = query.eq('id', id);
    if (slug) query = query.eq('slug', slug);
    query = query.order('created_at', { ascending: false });

    const { data, error } = await query;
    if (error) return res.status(500).json({ ok: false, reason: error.message });

    if (!isLight && data && data.length) {
      // Đếm số chương + đếm lượt xem là 2 truy vấn ĐỘC LẬP với nhau — trước đây
      // chạy tuần tự (await lần lượt) khiến tổng thời gian chờ = tổng 2 truy vấn.
      // Chạy song song bằng Promise.all để tổng thời gian chờ ≈ truy vấn chậm nhất.
      const novelIds = data.map((n) => n.id);
      let cq = db.from('chapters').select('novel_id, status').in('novel_id', novelIds);
      if (!admin) cq = cq.eq('status', 'published');

      const now = new Date();
      const startOfMonthIso = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

      const [{ data: chRows }, { data: viewRows }] = await Promise.all([
        cq,
        db.from('novel_views').select('novel_id, viewed_at').in('novel_id', novelIds),
      ]);

      // Đính kèm số chương cho mỗi truyện (dùng cho danh sách admin + trang truyện)
      const counts = {};
      (chRows || []).forEach((r) => { counts[r.novel_id] = (counts[r.novel_id] || 0) + 1; });
      data.forEach((n) => { n.chapter_count = counts[n.id] || 0; });

      // Đính kèm số lượt xem (tổng + trong tháng hiện tại) cho mỗi truyện.
      // Dùng cho: mục "Nổi Bật" (xem nhiều trong tháng) và mục "Thư Viện Truyện"
      // (đọc nhiều nhất mỗi thể loại). Nguồn dữ liệu: bảng novel_views,
      // mỗi dòng là 1 lượt xem được ghi qua POST /api/views.
      const totalCounts = {};
      const monthCounts = {};
      (viewRows || []).forEach((r) => {
        totalCounts[r.novel_id] = (totalCounts[r.novel_id] || 0) + 1;
        if (r.viewed_at >= startOfMonthIso) {
          monthCounts[r.novel_id] = (monthCounts[r.novel_id] || 0) + 1;
        }
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
        b.label_ids.map((label_id) => ({ novel_id: novel.id, label_id }))
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
        await db.from('novel_labels').insert(b.label_ids.map((label_id) => ({ novel_id: id, label_id })));
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
