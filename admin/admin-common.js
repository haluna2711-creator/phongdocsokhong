// ════════════════════════════════════
// PHÒNG ĐỌC SỐ 0 — API Bình luận (ADMIN, Supabase)
// Dùng bởi admin/comments.html. Mọi thao tác đều yêu cầu đã đăng nhập admin.
// ════════════════════════════════════

const { getSupabaseAdmin } = require('./_lib/supabaseAdmin');
const { requireAdmin } = require('./_lib/auth');

function mapRow(r) {
  return {
    id: r.id,
    postUrl: r.post_url,
    postTitle: r.post_title,
    name: r.name,
    body: r.body,
    ts: Number(r.ts),
    parentId: r.parent_id || null,
    isAdmin: !!r.is_admin,
    deleted: !!r.deleted,
  };
}

module.exports = async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  const db = getSupabaseAdmin();

  if (req.method === 'GET') {
    const postUrl = String(req.query.postUrl || '').trim();
    let query = db
      .from('comments')
      .select('id, post_url, post_title, name, body, ts, parent_id, is_admin, deleted')
      .order('ts', { ascending: true });
    if (postUrl) query = query.eq('post_url', postUrl);

    const { data, error } = await query;
    if (error) return res.status(500).json({ ok: false, reason: error.message });
    return res.status(200).json({ ok: true, comments: (data || []).map(mapRow) });
  }

  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ ok: false, reason: 'missing_id' });
    const { error } = await db.from('comments').update({ deleted: true }).eq('id', id);
    if (error) return res.status(500).json({ ok: false, reason: error.message });
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'POST') {
    const b = req.body || {};
    const postUrl = String(b.postUrl || '').trim();
    const postTitle = String(b.postTitle || '').trim();
    const parentId = b.parentId ? String(b.parentId) : null;
    const body = String(b.body || '').trim().slice(0, 2000);
    const name = String(b.name || 'Quản trị viên').trim().slice(0, 60) || 'Quản trị viên';

    if (!postUrl || !parentId || !body) {
      return res.status(400).json({ ok: false, reason: 'missing_fields' });
    }

    const { data, error } = await db
      .from('comments')
      .insert({
        post_url: postUrl,
        post_title: postTitle || null,
        name,
        body,
        ts: Date.now(),
        parent_id: parentId,
        is_admin: true,
        deleted: false,
      })
      .select('id')
      .single();

    if (error) return res.status(500).json({ ok: false, reason: error.message });
    return res.status(200).json({ ok: true, id: data.id });
  }

  return res.status(405).json({ ok: false, reason: 'method_not_allowed' });
};
