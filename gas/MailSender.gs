/**
 * ════════════════════════════════════
 * PHÒNG ĐỌC SỐ 0 — Mail Sender (Apps Script)
 * CHỈ dùng để gửi email mã truy cập. KHÔNG lưu bất kỳ dữ liệu nào —
 * toàn bộ dữ liệu email/mã truy cập nay nằm ở Supabase (bảng "readers"),
 * xem api/auth-register.js. Script này thay thế hoàn toàn cho Apps Script
 * "Gate" cũ (đã dùng Google Sheet để lưu email + mã).
 *
 * CÀI ĐẶT:
 * 1) script.google.com → New project → dán toàn bộ nội dung file này vào Code.gs
 *    (không cần Google Sheet nào cho script này cả).
 * 2) Project Settings > Script Properties: thêm khoá "MAIL_KEY" với 1 chuỗi
 *    bí mật dài, ngẫu nhiên (giống ADMIN_KEY của CommentsApi.gs).
 *    Chuỗi này phải trùng với biến môi trường MAIL_SENDER_KEY trên Vercel.
 * 3) Deploy > New deployment > Web app:
 *      - Execute as: Me
 *      - Who has access: Anyone
 * 4) Copy URL /exec và dán vào biến môi trường MAIL_SENDER_URL trên Vercel.
 */

function isValidKey_(key) {
  const expected = PropertiesService.getScriptProperties().getProperty('MAIL_KEY');
  return !!expected && !!key && key === expected;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  try {
    const action = (e.parameter.action || '').trim();
    if (action === 'sendCode') return handleSendCode_(e);
    if (action === 'ping') return json_({ ok: true }); // để "đánh thức" script, tránh cold start khi thật sự cần gửi mail
    return json_({ ok: false, error: 'unknown_action' });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  return doGet(e);
}

function handleSendCode_(e) {
  if (!isValidKey_(e.parameter.key)) return json_({ ok: false, error: 'unauthorized' });

  const email = String(e.parameter.email || '').trim();
  const code = String(e.parameter.code || '').trim();
  if (!email || !code) return json_({ ok: false, error: 'missing_fields' });

  MailApp.sendEmail({
    to: email,
    subject: '[Phòng Đọc Số 0] Mã truy cập của bạn',
    name: 'Phòng Đọc Số 0',
    // Bản text thuần — dùng khi hộp thư chặn/không hiển thị được HTML.
    body:
      'Xin chào Lữ Khách,\n\n' +
      'Mã truy cập của bạn: ' + code + '\n\n' +
      'Hãy lưu mã này lại. Bạn sẽ cần nhập cả email và mã này mỗi lần mở lại trang.\n' +
      'Nếu bạn không yêu cầu mã này, vui lòng bỏ qua email này.',
    htmlBody: buildCodeEmailHtml_(code),
  });

  return json_({ ok: true });
}

// Giao diện email — cùng tông đen/vàng với trang web (xem css/style.css).
// Dùng bố cục <table> + CSS inline để hiển thị đúng trên mọi trình đọc mail
// (Gmail, Outlook, Apple Mail...) vì email không load được font ngoài/CSS file.
//
// LƯU Ý QUAN TRỌNG VỀ FONT:
// Các chữ tiếng Việt có dấu kép (ầ, ế, ố, ộ, ữ...) rất dễ bị "rã dấu" khi
// hiển thị bằng font serif in-nghiêng (Georgia italic) trên Gmail/Outlook,
// vì các engine này không có sẵn glyph ghép cho những ký tự đó và phải tự
// dựng lại — dễ lệch. Vì vậy toàn bộ phần chữ tiếng Việt (không phải mã số)
// dùng font sans-serif KHÔNG in nghiêng (Arial/Helvetica), vốn có glyph dựng
// sẵn đầy đủ cho tiếng Việt và hiển thị ổn định trên mọi client.
// Georgia chỉ còn dùng cho phần không dấu: biểu tượng ✦ và ô mã số (A-Z0-9).
function buildCodeEmailHtml_(code) {
  const GOLD = '#F8DB8F';
  const GOLD_SOFT = 'rgba(248,219,143,0.75)';
  const GOLD_BORDER = 'rgba(248,219,143,0.28)';
  const WHITE = '#F5F0E8';
  const MUTED = 'rgba(245,240,232,0.58)';
  const BG_OUTER = '#000000';
  const BG_CARD = '#111111';
  const BG_CODEBOX = '#0A0A0A';

  const VN_FONT = "Arial, Helvetica, 'Segoe UI', sans-serif";

  return `
<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0;padding:0;background:${BG_OUTER}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG_OUTER};padding:40px 16px">
  <tr>
    <td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:${BG_CARD};border:1px solid ${GOLD_BORDER};border-radius:12px">

        <!-- Title -->
        <tr>
          <td style="padding:36px 32px 8px 32px;text-align:center">
            <span style="font-family:Georgia,'Times New Roman',serif;font-size:20px;letter-spacing:1px;color:${GOLD};font-weight:bold">
              &#10022;&nbsp;
            </span><span style="font-family:${VN_FONT};font-size:20px;color:${GOLD};font-weight:bold">
              Phòng Đọc Số 0
            </span><span style="font-family:Georgia,'Times New Roman',serif;font-size:20px;letter-spacing:1px;color:${GOLD};font-weight:bold">
              &nbsp;&#10022;
            </span>
          </td>
        </tr>

        <!-- Greeting + label -->
        <tr>
          <td style="padding:20px 32px 0 32px">
            <p style="margin:0 0 18px 0;font-family:${VN_FONT};font-size:15px;color:${WHITE};line-height:1.6">
              Xin chào Lữ Khách,
            </p>
            <p style="margin:0 0 10px 0;font-family:${VN_FONT};font-size:13px;color:${MUTED}">
              Mã truy cập của bạn:
            </p>
          </td>
        </tr>

        <!-- Code box -->
        <tr>
          <td style="padding:0 32px">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG_CODEBOX};border:1px solid ${GOLD_BORDER};border-radius:8px">
              <tr>
                <td style="padding:20px;text-align:center">
                  <span style="font-family:'Courier New',Consolas,monospace;font-size:28px;font-weight:bold;letter-spacing:6px;color:${GOLD}">
                    ${code}
                  </span>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Instructions -->
        <tr>
          <td style="padding:20px 32px 36px 32px">
            <p style="margin:0;font-family:${VN_FONT};font-size:12.5px;color:${MUTED};line-height:1.7">
              Hãy lưu mã này lại. Bạn sẽ cần nhập cả email và mã này mỗi lần mở lại trang.<br/>
              Nếu bạn không yêu cầu mã này, vui lòng bỏ qua email này.
            </p>
            <p style="margin:22px 0 0 0;text-align:center;color:${GOLD};letter-spacing:6px;font-size:12px">
              &#10022;&nbsp;&#10022;&nbsp;&#10022;
            </p>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}
