const { getCockroachPool } = require('./_lib/cockroachAdmin');
const { getSupabaseAdmin } = require('./_lib/supabaseAdmin');
const { isAdmin, requireAdmin } = require('./_lib/auth');
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
  const pool = getCockroachPool();

  if (req.method === 'GET') {
    const admin = isAdmin(req);
    const { novel_id, novel_slug, id, slug } = req.query;

    // novel_slug: chapters giờ nằm ở CockroachDB, không JOIN được với bảng
    // novels bên Supabase như trước (novels!inner(slug)) — phải đổi slug
    // -> novel_id bằng 1 query riêng trên Supabase trước.
    let resolvedNovelId = novel_id || null;
    if (novel_slug && !resolvedNovelId) {
      const db = getSupabaseAdmin();
      const { data: novel, error: novelErr } = await db
        .from('novels').select('id').eq('slug', novel_slug).maybeSingle();
      if (novelErr) return res.status(500).json({ ok: false, reason: novelErr.message });
      if (!novel) {
        if (!admin) res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=600');
        return res.status(200).json({ ok: true, chapters: [] });
      }
      resolvedNovelId = novel.id;
    }

    // Khi lấy 1 chương cụ thể (id hoặc slug) trả về đầy đủ (kèm content).
    // Khi lấy danh sách (mục lục) chỉ trả trường nhẹ.
    const single = !!(id || slug);
    const fields = single
      ? '*'
      : 'id, novel_id, title, slug, volume, chapter_number, status, published_at, scheduled_at';

    const conditions = [];
    const params = [];
    if (id) { params.push(id); conditions.push(`id = $${params.length}`); }
    if (slug) { params.push(slug); conditions.push(`slug = $${params.length}`); }
    if (resolvedNovelId) { params.push(resolvedNovelId); conditions.push(`novel_id = $${params.length}`); }
    if (!admin) conditions.push(`status = 'published'`);

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    let rows;
    try {
      const result = await pool.query(
        `SELECT ${fields} FROM chapters ${where} ORDER BY chapter_number ASC`,
        params
      );
      rows = result.rows;
    } catch (err) {
      return res.status(500).json({ ok: false, reason: err.message });
    }

    // Nội dung chương đã published ít đổi → cho phép cache ngắn hạn ở CDN/Edge.
    if (!admin) res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=600');
    return res.status(200).json({ ok: true, chapters: rows });
  }

  if (!requireAdmin(req, res)) return;

  if (req.method === 'POST') {
    const b = req.body || {};
    if (!b.novel_id || !b.title) return res.status(400).json({ ok: false, reason: 'missing_fields' });

    try {
      let chapterNumber = b.chapter_number;
      if (chapterNumber === undefined || chapterNumber === null) {
        const { rows: maxRows } = await pool.query(
          `SELECT chapter_number FROM chapters WHERE novel_id = $1 ORDER BY chapter_number DESC LIMIT 1`,
          [b.novel_id]
        );
        chapterNumber = maxRows[0] ? Number(maxRows[0].chapter_number) + 1 : 1;
      }

      const slug = b.slug ? slugify(b.slug) : slugify(b.title);
      const status = b.status || 'draft';
      const publishedAt = status === 'published' ? new Date().toISOString() : null;

      const { rows } = await pool.query(
        `INSERT INTO chapters
           (novel_id, title, slug, volume, content, chapter_number, status, scheduled_at, published_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING *`,
        [b.novel_id, b.title, slug, b.volume || null, b.content || '', chapterNumber, status,
          b.scheduled_at || null, publishedAt]
      );
      const chapter = rows[0];

      // Đánh dấu truyện vừa có chương mới + đồng bộ số đếm chương.
      const db = getSupabaseAdmin();
      await db.from('novels').update({ updated_at: new Date().toISOString() }).eq('id', chapter.novel_id);
      await syncChapterCounts(chapter.novel_id);

      return res.status(200).json({ ok: true, chapter });
    } catch (err) {
      return res.status(500).json({ ok: false, reason: err.message });
    }
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

    const keys = Object.keys(patch);
    if (keys.length === 0) return res.status(400).json({ ok: false, reason: 'empty_patch' });

    try {
      const setClauses = keys.map((k, i) => `${k} = $${i + 1}`);
      const values = keys.map((k) => patch[k]);
      values.push(id);

      const { rows } = await pool.query(
        `UPDATE chapters SET ${setClauses.join(', ')}, updated_at = now()
         WHERE id = $${values.length} RETURNING *`,
        values
      );
      const chapter = rows[0];
      if (!chapter) return res.status(404).json({ ok: false, reason: 'not_found' });

      // Sửa nội dung / đăng tải chương cũng tính là "cập nhật truyện" + đồng bộ số đếm.
      const db = getSupabaseAdmin();
      await db.from('novels').update({ updated_at: new Date().toISOString() }).eq('id', chapter.novel_id);
      await syncChapterCounts(chapter.novel_id);

      return res.status(200).json({ ok: true, chapter });
    } catch (err) {
      return res.status(500).json({ ok: false, reason: err.message });
    }
  }

  if (req.method === 'DELETE') {
    const { id } = req.query;
    const db = getSupabaseAdmin();

    if (!id) {
      const b = req.body || {};
      const { novel_id, mode, ids, volume } = b;
      if (!novel_id || typeof novel_id !== 'string') {
        return res.status(400).json({ ok: false, reason: 'missing_novel_id' });
      }

      let where = 'novel_id = $1';
      const params = [novel_id];

      if (mode === 'all') {
        // Không thêm điều kiện gì khác — xoá toàn bộ chương của truyện này.
      } else if (mode === 'volume') {
        if (!volume || typeof volume !== 'string') {
          return res.status(400).json({ ok: false, reason: 'missing_volume' });
        }
        params.push(volume);
        where += ` AND volume = $${params.length}`;
      } else if (mode === 'ids') {
        if (!Array.isArray(ids) || ids.length === 0) {
          return res.status(400).json({ ok: false, reason: 'missing_ids' });
        }
        if (ids.length > 1000) {
          return res.status(400).json({ ok: false, reason: 'too_many_ids' });
        }
        params.push(ids);
        where += ` AND id = ANY($${params.length}::uuid[])`;
      } else {
        return res.status(400).json({ ok: false, reason: 'invalid_mode' });
      }

      try {
        const { rows } = await pool.query(`DELETE FROM chapters WHERE ${where} RETURNING id`, params);

        await db.from('novels').update({ updated_at: new Date().toISOString() }).eq('id', novel_id);
        await syncChapterCounts(novel_id);

        return res.status(200).json({ ok: true, deleted: rows.length, ids: rows.map((r) => r.id) });
      } catch (err) {
        return res.status(500).json({ ok: false, reason: err.message });
      }
    }

    try {
      const { rows: existingRows } = await pool.query('SELECT novel_id FROM chapters WHERE id = $1', [id]);
      const existing = existingRows[0];

      const { rowCount } = await pool.query('DELETE FROM chapters WHERE id = $1', [id]);
      if (rowCount === 0) return res.status(404).json({ ok: false, reason: 'not_found' });

      if (existing?.novel_id) {
        await db.from('novels').update({ updated_at: new Date().toISOString() }).eq('id', existing.novel_id);
        await syncChapterCounts(existing.novel_id);
      }
      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(500).json({ ok: false, reason: err.message });
    }
  }

  return res.status(405).json({ ok: false, reason: 'method_not_allowed' });
};
