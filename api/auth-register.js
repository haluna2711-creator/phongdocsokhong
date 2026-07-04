// ════════════════════════════════════
// PHÒNG ĐỌC SỐ 0 — Auth Gate API (Supabase)
// Dùng bởi js/auth.js: GET /api/auth-register?action=register&email=...
//                       GET /api/auth-register?action=verify&email=...&code=...
//                       GET /api/auth-register?action=gate-status   (public)
// Dùng bởi admin/settings.html:
//                       GET /api/auth-register?action=gate-set&open=true|false  (chỉ admin)
//
// LƯU Ý: các action gate-status/gate-set được gộp CHUNG vào file này (thay vì
// tạo file api/registration-gate.js riêng) để không vượt quá giới hạn 12
// Serverless Functions/deployment của Vercel Hobby plan.
//
// Bảng Supabase "readers" (đúng theo schema hiện tại của bạn):
//   - id             uuid, primary key, default gen_random_uuid()
//   - email          text, unique, not null
//   - access_code    text, not null (mã truy cập, ví dụ 8 ký tự)
//   - disabled       boolean, not null, default false
//   - created_at     timestamptz, not null, default now()
//   - last_login_at  timestamptz, nullable — CẦN THÊM MỚI bằng lệnh:
//       alter table public.readers add column if not exists last_login_at timestamptz;
//     Cập nhật mỗi lần verify thành công, dùng bởi api/cron-lock-inactive.js
//     để tự khoá tài khoản không đăng nhập trong 2 năm (nếu NULL thì tính
//     theo created_at, tức là chưa từng đăng nhập lần nào kể từ lúc đăng ký).
//
// Biến môi trường cần thiết trên Vercel:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  — xem api/_lib/supabaseAdmin.js
//   MAIL_SENDER_URL   — URL /exec của gas/MailSender.gs
//   MAIL_SENDER_KEY   — phải trùng với Script Property "MAIL_KEY" trong Apps Script
// ════════════════════════════════════

const { getSupabaseAdmin } = require('./_lib/supabaseAdmin');
const { requireAdmin } = require('./_lib/auth');

// Bỏ các ký tự dễ nhầm lẫn khi đọc mã qua email (0/O, 1/I).
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function genCode(len = 8) {
  let out = '';
  for (let i = 0; i < len; i++) {
    out += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return out;
}

async function sendCodeEmail(email, code) {
  const base = process.env.MAIL_SENDER_URL;
  const key = process.env.MAIL_SENDER_KEY;
  if (!base) throw new Error('Thiếu biến môi trường MAIL_SENDER_URL.');
  if (!key) throw new Error('Thiếu biến môi trường MAIL_SENDER_KEY.');

  const qs = new URLSearchParams({ action: 'sendCode', key, email, code });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  let r, data;
  try {
    r = await fetch(`${base}?${qs.toString()}`, { signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Apps Script phản hồi quá chậm.');
    throw err;
  } finally {
    clearTimeout(timer);
  }
  try {
    data = await r.json();
  } catch (_) {
    throw new Error('Apps Script không trả về JSON hợp lệ (kiểm tra quyền deployment: "Anyone").');
  }
  if (!data.ok) throw new Error(data.error || 'Gửi email thất bại.');
}

module.exports = async function handler(req, res) {
  try {
    const action = String(req.query.action || '').trim();
    const db = getSupabaseAdmin();

    // ── Trạng thái cổng đăng ký: public, không cần email/đăng nhập ──
    // Gọi bởi js/auth.js để biết cổng đang mở hay đang bị admin khoá.
    if (action === 'gate-status') {
      const { data, error } = await db
        .from('app_settings')
        .select('value')
        .eq('key', 'registration_open')
        .maybeSingle();
      if (error) return res.status(200).json({ ok: true, open: true });
      const open = data ? data.value !== false : true;
      return res.status(200).json({ ok: true, open });
    }

    // ── Khoá / mở cổng đăng ký: CHỈ admin ──
    // Gọi bởi admin/settings.html. Dùng GET với query ?open=true|false để
    // dùng chung được với 1 file API duy nhất (tránh tạo thêm Serverless
    // Function mới — Vercel Hobby giới hạn tối đa 12 function/deployment).
    if (action === 'gate-set') {
      if (!requireAdmin(req, res)) return;
      const openRaw = String(req.query.open || '').trim();
      if (openRaw !== 'true' && openRaw !== 'false') {
        return res.status(400).json({ ok: false, reason: 'missing_open' });
      }
      const open = openRaw === 'true';
      const { error } = await db
        .from('app_settings')
        .upsert(
          { key: 'registration_open', value: open, updated_at: new Date().toISOString() },
          { onConflict: 'key' }
        );
      if (error) return res.status(500).json({ ok: false, reason: error.message });
      return res.status(200).json({ ok: true, open });
    }

    const email = String(req.query.email || '').trim().toLowerCase();

    if (!email || email.indexOf('@') < 1) {
      return res.status(200).json({ ok: false, reason: 'invalid_email' });
    }

    // ── Đăng ký: tạo mã mới, gửi email ──
    if (action === 'register') {
      // Luôn kiểm tra email đã có sẵn trong bảng "readers" TRƯỚC — người đã
      // đăng ký từ trước đó (đã có access_code) không bị ảnh hưởng bởi việc
      // khoá cổng, họ vẫn được báo "already_registered" như bình thường để
      // front-end chuyển họ sang bước đăng nhập (action=verify).
      const { data: existing, error: selErr } = await db
        .from('readers')
        .select('id, disabled')
        .eq('email', email)
        .maybeSingle();
      if (selErr) return res.status(500).json({ ok: false, reason: selErr.message });

      if (existing) {
        if (existing.disabled) {
          return res.status(200).json({ ok: false, reason: 'account_disabled' });
        }
        return res.status(200).json({ ok: false, reason: 'already_registered' });
      }

      // Email này CHƯA từng đăng ký → đây là người đăng ký mới. Chỉ ở
      // trường hợp này mới kiểm tra cổng đăng ký có đang bị admin khoá
      // không (/admin/settings.html). Người đã đăng ký (nhánh ở trên) luôn
      // được đăng nhập bình thường dù cổng đang khoá.
      const { data: gate, error: gateErr } = await db
        .from('app_settings')
        .select('value')
        .eq('key', 'registration_open')
        .maybeSingle();
      const registrationOpen = gateErr ? true : (gate ? gate.value !== false : true);
      if (!registrationOpen) {
        return res.status(200).json({ ok: false, reason: 'registration_closed' });
      }

      const code = genCode();
      const { error: insErr } = await db
        .from('readers')
        .insert({ email, access_code: code, disabled: false });
      if (insErr) return res.status(500).json({ ok: false, reason: insErr.message });

      try {
        await sendCodeEmail(email, code);
      } catch (mailErr) {
        // Đã lưu email+mã ở DB nhưng gửi mail thất bại — báo lỗi rõ ràng
        // thay vì để front-end hiểu nhầm là lỗi mạng.
        return res.status(502).json({ ok: false, reason: 'mail_failed', detail: mailErr.message });
      }

      return res.status(200).json({ ok: true });
    }

    // ── Xác thực: kiểm tra email + mã ──
    if (action === 'verify') {
      const code = String(req.query.code || '').trim().toUpperCase();
      if (!code) return res.status(200).json({ ok: false, reason: 'invalid_code' });

      const { data: reader, error } = await db
        .from('readers')
        .select('id, access_code, disabled')
        .eq('email', email)
        .maybeSingle();
      if (error) return res.status(500).json({ ok: false, reason: error.message });
      if (!reader) return res.status(200).json({ ok: false, reason: 'email_not_found' });
      if (reader.disabled) return res.status(200).json({ ok: false, reason: 'account_disabled' });
      if (String(reader.access_code).toUpperCase() !== code) {
        return res.status(200).json({ ok: false, reason: 'wrong_code' });
      }

      // Đăng nhập thành công → cập nhật mốc hoạt động gần nhất. Không chặn
      // response nếu update lỗi (không quan trọng bằng việc cho vào được).
      await db
        .from('readers')
        .update({ last_login_at: new Date().toISOString() })
        .eq('id', reader.id);

      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ ok: false, reason: 'unknown_action' });
  } catch (err) {
    return res.status(500).json({ ok: false, reason: err.message });
  }
};
