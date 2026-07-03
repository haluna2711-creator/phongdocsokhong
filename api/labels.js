const { getSupabaseAdmin } = require('./_lib/supabaseAdmin');
const { requireAdmin } = require('./_lib/auth');

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
    const { data, error } = await db.from('labels').select('*').order('name');
    if (error) return res.status(500).json({ ok: false, reason: error.message });
    return res.status(200).json({ ok: true, labels: data });
  }

  if (!requireAdmin(req, res)) return;

  if (req.method === 'POST') {
    const { name, bg_gradient } = req.body || {};
    if (!name) return res.status(400).json({ ok: false, reason: 'missing_name' });
    const { data, error } = await db
      .from('labels')
      .insert({ name, slug: slugify(name), bg_gradient: bg_gradient || null })
      .select().single();
    if (error) return res.status(500).json({ ok: false, reason: error.message });
    return res.status(200).json({ ok: true, label: data });
  }

  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ ok: false, reason: 'missing_id' });
    const { error } = await db.from('labels').delete().eq('id', id);
    if (error) return res.status(500).json({ ok: false, reason: error.message });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ ok: false, reason: 'method_not_allowed' });
};
