const { Pool } = require('pg');

// Kết nối tới CockroachDB — nơi lưu bảng "chapters". Mirror pattern của
// supabaseAdmin.js: 1 pool duy nhất, dùng chung giữa các lượt gọi hàm
// serverless (Vercel giữ ấm container giữa các request gần nhau).
let _pool = null;

function getCockroachPool() {
  if (_pool) return _pool;

  const connectionString = process.env.COCKROACH_DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'Thiếu biến môi trường COCKROACH_DATABASE_URL. ' +
      'Vào Vercel → Project Settings → Environment Variables để thêm.'
    );
  }

  _pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: true },
    // Serverless function chạy ngắn hạn, nhiều instance song song → giữ pool
    // nhỏ để không áp đảo số connection cho phép của CockroachDB.
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  _pool.on('error', (err) => {
    console.error('[cockroachAdmin] idle client error:', err.message);
  });

  return _pool;
}

module.exports = { getCockroachPool };
