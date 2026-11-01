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

    // Tạm dừng / khởi động lại lịch đăng của 1 truyện (dùng bởi admin/chapters.html).
    // Gộp vào đây thay vì tạo file api/ riêng để không vượt giới hạn 12 Serverless Functions.
    if (b.action === 'pause' || b.action === 'resume') {
      if (!b.novel_id || typeof b.novel_id !== 'string') {
        return res.status(400).json({ ok: false, reason: 'missing_novel_id' });
      }

      if (b.action === 'pause') {
        // Mọi chương đang 'scheduled' → 'paused'. Giữ nguyên scheduled_at cũ làm tham chiếu.
        const { data, error } = await db.from('chapters')
          .update({ status: 'paused' })
          .eq('novel_id', b.novel_id)
          .eq('status', 'scheduled')
          .select('id');
        if (error) return res.status(500).json({ ok: false, reason: error.message });
        return res.status(200).json({ ok: true, paused: data.length });
      }

      // resume: client đã tính sẵn mốc đăng mới cho từng chương.
      const items = b.items;
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ ok: false, reason: 'missing_items' });
      }
      if (items.length > 1000) return res.status(400).json({ ok: false, reason: 'too_many_items' });
      for (const it of items) {
        if (!it || typeof it.id !== 'string' || !it.scheduled_at || isNaN(new Date(it.scheduled_at).getTime())) {
          return res.status(400).json({ ok: false, reason: 'invalid_items' });
        }
      }

      // Chỉ chương của truyện này và đang 'paused' mới được khởi động lại.
      // Chia lô nhỏ để không bắn hàng trăm request cùng lúc.
      let resumed = 0;
      for (let i = 0; i < items.length; i += 20) {
        const batch = items.slice(i, i + 20);
        const results = await Promise.all(batch.map((it) =>
          db.from('chapters')
            .update({ status: 'scheduled', scheduled_at: new Date(it.scheduled_at).toISOString() })
            .eq('id', it.id)
            .eq('novel_id', b.novel_id)
            .eq('status', 'paused')
            .select('id')
        ));
        for (const r of results) {
          if (r.error) return res.status(500).json({ ok: false, reason: r.error.message, resumed });
          resumed += (r.data || []).length;
        }
      }
      return res.status(200).json({ ok: true, resumed });
    }

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

    // Không có ?id=... trên query nhưng có body {novel_id, mode} → xoá hàng
    // loạt (dùng bởi admin/chapters.html, nút "Xoá nhiều/Xoá tất cả"). Gộp
    // chung vào đây (thay vì file api/chapters-bulk-delete.js riêng) để
    // không vượt quá giới hạn 12 Serverless Functions/deployment của Vercel
    // Hobby plan — admin đã được xác thực ở requireAdmin() phía trên rồi.
    if (!id) {
      const b = req.body || {};
      const { novel_id, mode, ids, volume } = b;
      if (!novel_id || typeof novel_id !== 'string') {
        return res.status(400).json({ ok: false, reason: 'missing_novel_id' });
      }

      let query = db.from('chapters').delete().eq('novel_id', novel_id);

      if (mode === 'all') {
        // Không thêm điều kiện gì khác ngoài novel_id — xoá toàn bộ chương của truyện này.
      } else if (mode === 'volume') {
        if (!volume || typeof volume !== 'string') {
          return res.status(400).json({ ok: false, reason: 'missing_volume' });
        }
        query = query.eq('volume', volume);
      } else if (mode === 'ids') {
        if (!Array.isArray(ids) || ids.length === 0) {
          return res.status(400).json({ ok: false, reason: 'missing_ids' });
        }
        if (ids.length > 1000) {
          return res.status(400).json({ ok: false, reason: 'too_many_ids' });
        }
        query = query.in('id', ids);
      } else {
        return res.status(400).json({ ok: false, reason: 'invalid_mode' });
      }

      const { data, error } = await query.select('id');
      if (error) return res.status(500).json({ ok: false, reason: error.message });

      await db.from('novels').update({ updated_at: new Date().toISOString() }).eq('id', novel_id);

      return res.status(200).json({ ok: true, deleted: data.length, ids: data.map((d) => d.id) });
    }

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
