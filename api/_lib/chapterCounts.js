const { getCockroachPool } = require('./cockroachAdmin');
const { getSupabaseAdmin } = require('./supabaseAdmin');

// Đồng bộ số đếm chương (tổng + đã đăng) từ CockroachDB sang 2 cột
// denormalize trên bảng novels (Supabase). Gọi hàm này sau MỌI thao tác
// ghi (insert/update/delete) trên bảng chapters, để trang chủ/danh sách
// truyện (api/novels.js) luôn đọc được số đếm mới nhất mà không cần JOIN
// xuyên 2 database (không thể JOIN Postgres <-> CockroachDB trực tiếp).
async function syncChapterCounts(novelId) {
  if (!novelId) return;

  try {
    const pool = getCockroachPool();
    const { rows } = await pool.query(
      `SELECT
         count(*)::int AS total,
         count(*) FILTER (WHERE status = 'published')::int AS published
       FROM chapters
       WHERE novel_id = $1`,
      [novelId]
    );

    const total = rows[0]?.total || 0;
    const published = rows[0]?.published || 0;

    const db = getSupabaseAdmin();
    const { error } = await db
      .from('novels')
      .update({ chapter_count_total: total, chapter_count_published: published })
      .eq('id', novelId);

    if (error) console.error('[chapterCounts] update novels thất bại:', error.message);
  } catch (err) {
    // Không throw ra ngoài — sync lỗi không nên làm hỏng response chính
    // (chương vẫn đã ghi thành công), chỉ log lại để theo dõi.
    console.error('[chapterCounts] sync thất bại cho novel', novelId, err.message);
  }
}

module.exports = { syncChapterCounts };
