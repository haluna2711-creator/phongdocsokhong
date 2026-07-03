/**
 * ════════════════════════════════════
 * PHÒNG ĐỌC SỐ 0 — Comments Apps Script backend
 * Thay thế cho script COMMENT_URL cũ. Hỗ trợ:
 *   - Bình luận + trả lời (parentId)
 *   - Quản trị: xem tất cả, xoá, trả lời với tư cách admin
 *
 * CÀI ĐẶT:
 * 1) Tạo 1 Google Sheet mới, đặt tên sheet đầu tiên là "Comments" với hàng tiêu đề:
 *    id | postUrl | postTitle | name | body | ts | parentId | isAdmin | deleted
 * 2) Extensions > Apps Script, dán toàn bộ nội dung file này vào Code.gs
 * 3) Project Settings > Script Properties: thêm khoá "ADMIN_KEY" với 1 chuỗi bí mật dài, ngẫu nhiên.
 *    (Chuỗi này phải trùng với biến môi trường COMMENTS_ADMIN_KEY trên Vercel — xem api/comments.js)
 * 4) Deploy > New deployment > Web app:
 *      - Execute as: Me
 *      - Who has access: Anyone
 * 5) Copy URL /exec và dán vào js/config.js -> COMMENT_URL
 *    (Nếu bạn sửa lại 1 deployment đã có sẵn thay vì tạo mới, URL không đổi.)
 */

const SHEET_NAME = 'Comments';
const HEADERS = ['id', 'postUrl', 'postTitle', 'name', 'body', 'ts', 'parentId', 'isAdmin', 'deleted'];

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(HEADERS);
  }
  return sh;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function isValidAdminKey_(key) {
  const expected = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY');
  return !!expected && !!key && key === expected;
}

function rowsToObjects_(sh) {
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  const [headers, ...rows] = values;
  return rows
    .filter(r => r.some(c => c !== '' && c !== null))
    .map(r => {
      const o = {};
      headers.forEach((h, i) => { o[h] = r[i]; });
      return o;
    });
}

function esc_(s) { return String(s == null ? '' : s); }

function doGet(e) {
  const action = (e.parameter.action || '').trim();
  try {
    if (action === 'getComments') return handleGetComments_(e);
    if (action === 'addComment') return handleAddComment_(e);
    if (action === 'adminList') return handleAdminList_(e);
    if (action === 'adminDelete') return handleAdminDelete_(e);
    if (action === 'adminReply') return handleAdminReply_(e);
    return json_({ ok: false, error: 'unknown_action' });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

// Cho phép gọi bằng POST tương đương GET (dùng chung tham số qua e.parameter khi form-encoded)
function doPost(e) {
  return doGet(e);
}

// ── Đọc bình luận công khai cho 1 chương (không trả về bình luận đã bị xoá) ──
function handleGetComments_(e) {
  const postUrl = esc_(e.parameter.postUrl);
  if (!postUrl) return json_({ ok: false, error: 'missing_postUrl' });

  const sh = getSheet_();
  const items = rowsToObjects_(sh)
    .filter(r => esc_(r.postUrl) === postUrl && !r.deleted)
    .map(r => ({
      id: esc_(r.id),
      name: esc_(r.name),
      body: esc_(r.body),
      ts: Number(r.ts),
      parentId: r.parentId ? esc_(r.parentId) : null,
      isAdmin: !!r.isAdmin,
    }));

  return json_({ ok: true, data: items });
}

// ── Người đọc gửi bình luận (hoặc trả lời nếu có parentId) ──
function handleAddComment_(e) {
  const postUrl   = esc_(e.parameter.postUrl);
  const postTitle = esc_(e.parameter.postTitle);
  const name      = esc_(e.parameter.name).trim().slice(0, 60);
  const body      = esc_(e.parameter.body).trim().slice(0, 2000);
  const parentId  = esc_(e.parameter.parentId || '');

  if (!postUrl || !name || !body) return json_({ ok: false, error: 'missing_fields' });

  const sh = getSheet_();
  const id = Utilities.getUuid();
  sh.appendRow([id, postUrl, postTitle, name, body, Date.now(), parentId || '', false, false]);

  return json_({ ok: true, id: id });
}

// ── ADMIN: liệt kê toàn bộ bình luận (có thể lọc theo postUrl) ──
function handleAdminList_(e) {
  if (!isValidAdminKey_(e.parameter.key)) return json_({ ok: false, error: 'unauthorized' });
  const postUrl = esc_(e.parameter.postUrl || '');

  const sh = getSheet_();
  let items = rowsToObjects_(sh).map(r => ({
    id: esc_(r.id),
    postUrl: esc_(r.postUrl),
    postTitle: esc_(r.postTitle),
    name: esc_(r.name),
    body: esc_(r.body),
    ts: Number(r.ts),
    parentId: r.parentId ? esc_(r.parentId) : null,
    isAdmin: !!r.isAdmin,
    deleted: !!r.deleted,
  }));
  if (postUrl) items = items.filter(r => r.postUrl === postUrl);

  return json_({ ok: true, data: items });
}

// ── ADMIN: xoá mềm 1 bình luận (giữ lại lịch sử, ẩn khỏi công khai) ──
function handleAdminDelete_(e) {
  if (!isValidAdminKey_(e.parameter.key)) return json_({ ok: false, error: 'unauthorized' });
  const id = esc_(e.parameter.id);
  if (!id) return json_({ ok: false, error: 'missing_id' });

  const sh = getSheet_();
  const values = sh.getDataRange().getValues();
  const idCol = HEADERS.indexOf('id');
  const delCol = HEADERS.indexOf('deleted');

  for (let i = 1; i < values.length; i++) {
    if (esc_(values[i][idCol]) === id) {
      sh.getRange(i + 1, delCol + 1).setValue(true);
      return json_({ ok: true });
    }
  }
  return json_({ ok: false, error: 'not_found' });
}

// ── ADMIN: trả lời 1 bình luận với tư cách quản trị viên ──
function handleAdminReply_(e) {
  if (!isValidAdminKey_(e.parameter.key)) return json_({ ok: false, error: 'unauthorized' });
  const postUrl   = esc_(e.parameter.postUrl);
  const postTitle = esc_(e.parameter.postTitle);
  const parentId  = esc_(e.parameter.parentId);
  const body      = esc_(e.parameter.body).trim().slice(0, 2000);
  const name      = esc_(e.parameter.name || 'Quản trị viên').trim().slice(0, 60) || 'Quản trị viên';

  if (!postUrl || !parentId || !body) return json_({ ok: false, error: 'missing_fields' });

  const sh = getSheet_();
  const id = Utilities.getUuid();
  sh.appendRow([id, postUrl, postTitle, name, body, Date.now(), parentId, true, false]);

  return json_({ ok: true, id: id });
}
