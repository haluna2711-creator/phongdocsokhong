// ════════════════════════════════════
// PHÒNG ĐỌC SỐ 0 — Email Guard
// Chặn gửi mã truy cập "vô tội vạ": email sai định dạng, email rác/tạm thời
// (disposable), tên miền không tồn tại (không có MX record), và spam do gọi
// API liên tục (rate limit theo email + theo IP).
//
// Dùng bởi: api/auth-register.js (action=register), TRƯỚC khi insert vào
// Supabase và TRƯỚC khi gọi sendCodeEmail().
//
// CẦN THÊM bảng Supabase để lưu log rate-limit (chạy 1 lần trong SQL editor):
//
//   create table if not exists public.email_send_log (
//     id bigint generated always as identity primary key,
//     email text not null,
//     ip text not null,
//     created_at timestamptz not null default now()
//   );
//   create index if not exists email_send_log_email_idx on public.email_send_log (email, created_at);
//   create index if not exists email_send_log_ip_idx    on public.email_send_log (ip, created_at);
//
//   -- (tuỳ chọn nhưng nên có) tự xoá log cũ hơn 30 ngày để bảng không phình to,
//   -- có thể chạy định kỳ bằng 1 cron riêng hoặc pg_cron nếu Supabase hỗ trợ.
// ════════════════════════════════════

const dns = require('dns').promises;

// ── 1) Định dạng email ──
// Chặt hơn nhiều so với check "có dấu @ hay không". Không cố gắng bắt hết
// mọi email hợp lệ theo RFC (không thực tế), chỉ chặn các dạng rõ ràng sai:
// nhiều @, khoảng trắng, thiếu domain/TLD, ký tự không hợp lệ...
const EMAIL_RE = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

function isValidEmailFormat(email) {
  if (typeof email !== 'string') return false;
  if (email.length > 254) return false;
  return EMAIL_RE.test(email);
}

function getDomain(email) {
  const at = email.lastIndexOf('@');
  return at === -1 ? '' : email.slice(at + 1).toLowerCase();
}

// ── 2) Danh sách domain email rác / tạm thời (disposable) ──
// Danh sách rút gọn các domain "hòm thư dùng 1 lần" phổ biến nhất. Nên định
// kỳ cập nhật thêm — có thể merge với danh sách cộng đồng, ví dụ:
// https://github.com/disposable-email-domains/disposable-email-domains
// (tải file disposable_email_blocklist.conf, JSON.parse rồi gộp vào Set này).
const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com', 'mailinator.net', 'mailinator.org',
  '10minutemail.com', '10minutemail.net', '20minutemail.com',
  'guerrillamail.com', 'guerrillamail.net', 'guerrillamail.org', 'guerrillamail.biz', 'guerrillamailblock.com',
  'sharklasers.com', 'grr.la', 'pokemail.net',
  'yopmail.com', 'yopmail.net', 'yopmail.fr', 'cool.fr.nf', 'jetable.fr.nf',
  'temp-mail.org', 'tempmail.com', 'tempmail.net', 'tempmailo.com', 'tempmail.dev',
  'throwawaymail.com', 'throwaway.email', 'trashmail.com', 'trashmail.net', 'trash-mail.com',
  'dispostable.com', 'getnada.com', 'nada.email', 'moakt.com', 'moakt.cc',
  'fakeinbox.com', 'fakemailgenerator.com', 'maildrop.cc', 'mailnesia.com',
  'mintemail.com', 'spamgourmet.com', 'mytemp.email', 'emailondeck.com',
  'mohmal.com', 'crazymailing.com', 'mail-temporaire.fr', 'tempinbox.com',
  'anonbox.net', 'burnermail.io', 'inboxbear.com', 'mail-temp.com',
  '33mail.com', 'spam4.me', 'discard.email', 'discardmail.com',
  'tmail.ws', 'tmpmail.org', 'tmpmail.net', 'tmpeml.com', 'temp-mail.io',
  'luxusmail.org', 'nowmymail.com', 'emailtemporario.com.br', 'correotemporal.org',
]);

function isDisposableDomain(domain) {
  return DISPOSABLE_DOMAINS.has(domain);
}

// ── 3) Domain có tồn tại thật không (kiểm tra MX record) ──
// Nếu domain không có MX (và cũng không có bản ghi A/AAAA dự phòng để nhận
// mail), gần như chắc chắn gửi mail sẽ bounce → domain gõ sai hoặc bịa ra.
// Có timeout ngắn để không làm chậm toàn bộ request quá lâu nếu DNS treo.
async function domainCanReceiveMail(domain) {
  const withTimeout = (promise, ms) =>
    Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('dns_timeout')), ms)),
    ]);

  try {
    const mx = await withTimeout(dns.resolveMx(domain), 4000);
    if (mx && mx.length > 0) return true;
  } catch (_) {
    // không có MX hoặc domain không resolve được → thử tiếp bước dự phòng
  }

  // Một số domain nhỏ không khai báo MX riêng nhưng vẫn nhận mail qua A/AAAA
  // (khá hiếm nhưng vẫn hợp lệ theo RFC 5321). Coi như hợp lệ nếu có A/AAAA.
  try {
    const a = await withTimeout(dns.resolve4(domain), 3000);
    if (a && a.length > 0) return true;
  } catch (_) { /* thử tiếp */ }
  try {
    const aaaa = await withTimeout(dns.resolve6(domain), 3000);
    if (aaaa && aaaa.length > 0) return true;
  } catch (_) { /* hết cách */ }

  return false;
}

// ── 4) Rate limit theo email + theo IP (chống spam gửi hàng loạt) ──
// Giới hạn:
//   - 1 email cụ thể: tối đa 3 lần gửi / 24h (đủ dùng thật, chặn được lạm
//     dụng để "bom mail" 1 hộp thư của người khác).
//   - 1 địa chỉ IP: tối đa 8 lần gửi / 1h (chặn script tự động thử nhiều
//     email khác nhau liên tục từ cùng 1 nguồn).
const EMAIL_LIMIT = { max: 3, windowMs: 24 * 60 * 60 * 1000 };
const IP_LIMIT = { max: 8, windowMs: 60 * 60 * 1000 };

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : 'unknown';
}

// Trả về { allowed: boolean, reason?: string }
async function checkRateLimit(db, email, ip) {
  const now = Date.now();

  const emailSince = new Date(now - EMAIL_LIMIT.windowMs).toISOString();
  const { count: emailCount, error: e1 } = await db
    .from('email_send_log')
    .select('id', { count: 'exact', head: true })
    .eq('email', email)
    .gte('created_at', emailSince);
  if (e1) return { allowed: true }; // lỗi hạ tầng phụ trợ không nên chặn người dùng thật

  if ((emailCount || 0) >= EMAIL_LIMIT.max) {
    return { allowed: false, reason: 'rate_limited_email' };
  }

  const ipSince = new Date(now - IP_LIMIT.windowMs).toISOString();
  const { count: ipCount, error: e2 } = await db
    .from('email_send_log')
    .select('id', { count: 'exact', head: true })
    .eq('ip', ip)
    .gte('created_at', ipSince);
  if (e2) return { allowed: true };

  if ((ipCount || 0) >= IP_LIMIT.max) {
    return { allowed: false, reason: 'rate_limited_ip' };
  }

  return { allowed: true };
}

async function recordSend(db, email, ip) {
  // Không await/chặn response vì lỗi ở đây không quan trọng bằng việc gửi
  // mail thành công — nhưng vẫn nên log lỗi để theo dõi nếu bảng chưa tạo.
  const { error } = await db.from('email_send_log').insert({ email, ip });
  if (error) console.error('email_send_log insert failed:', error.message);
}

module.exports = {
  isValidEmailFormat,
  getDomain,
  isDisposableDomain,
  domainCanReceiveMail,
  getClientIp,
  checkRateLimit,
  recordSend,
};
