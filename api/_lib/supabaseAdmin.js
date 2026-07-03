const { createClient } = require('@supabase/supabase-js');

// Dùng service_role key — CHỈ được require() từ code chạy trên server
// (thư mục /api). Không bao giờ để lộ key này ra phía client.
let _client = null;

function getSupabaseAdmin() {
  if (_client) return _client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      'Thiếu biến môi trường SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY. ' +
      'Vào Vercel → Project Settings → Environment Variables để thêm.'
    );
  }

  _client = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return _client;
}

module.exports = { getSupabaseAdmin };
