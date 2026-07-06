// api/chapters-bulk-delete.js
//
// API xoá chương hàng loạt cho Supabase + Vercel.
// Dùng 1 câu lệnh DELETE duy nhất (atomic) thay vì loop nhiều request nhỏ,
// tránh nghẽn connection pool của serverless function và tránh xoá dở dang.
//
// Body nhận vào:
//   { novel_id: string, mode: 'all' }
//   { novel_id: string, mode: 'volume', volume: string }
//   { novel_id: string, mode: 'ids', ids: string[] }

import { createClient } from '@supabase/supabase-js';

// SERVICE ROLE KEY chỉ dùng ở server (route này), KHÔNG bao giờ đưa ra client
// hay prefix bằng NEXT_PUBLIC_. Nó bypass RLS nên cần kiểm tra quyền admin
// trước khi thực thi (xem TODO bên dưới).
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // TODO: chèn middleware/kiểm tra session admin của bạn ở đây trước khi xoá.
    // Ví dụ: verify JWT / cookie admin, nếu không hợp lệ thì return 401.

    const { novel_id, mode, ids, volume } = req.body || {};

    if (!novel_id || typeof novel_id !== 'string') {
      return res.status(400).json({ error: 'Thiếu hoặc sai novel_id' });
    }

    let query = supabase.from('chapters').delete().eq('novel_id', novel_id);

    if (mode === 'all') {
      // Không thêm điều kiện gì khác ngoài novel_id — xoá toàn bộ chương
      // của đúng truyện này.
    } else if (mode === 'volume') {
      if (!volume || typeof volume !== 'string') {
        return res.status(400).json({ error: 'Thiếu volume' });
      }
      query = query.eq('volume', volume);
    } else if (mode === 'ids') {
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: 'Thiếu danh sách ids' });
      }
      if (ids.length > 1000) {
        // Supabase/PostgREST giới hạn kích thước mệnh đề IN hợp lý; chia nhỏ
        // nếu bạn cần xoá số lượng cực lớn trong 1 lần.
        return res.status(400).json({ error: 'Tối đa 1000 id mỗi lần gọi' });
      }
      query = query.in('id', ids);
    } else {
      return res.status(400).json({ error: 'mode không hợp lệ (all | volume | ids)' });
    }

    // .select('id') để PostgREST trả về đúng danh sách bản ghi đã xoá,
    // dùng để verify số lượng và trả kết quả chính xác cho client.
    const { data, error } = await query.select('id');

    if (error) throw error;

    return res.status(200).json({
      deleted: data.length,
      ids: data.map(d => d.id),
    });
  } catch (e) {
    console.error('chapters-bulk-delete error:', e);
    return res.status(500).json({ error: e.message || 'Lỗi server' });
  }
}
