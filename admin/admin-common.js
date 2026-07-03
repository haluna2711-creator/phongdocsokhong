// ════════════════════════════════════
// PHÒNG ĐỌC SỐ 0 — Admin common helpers
// ════════════════════════════════════

async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (_) {}
  if (!res.ok) {
    if (res.status === 401) { window.location.href = '/admin/login.html'; }
    throw new Error((data && data.reason) || `HTTP ${res.status}`);
  }
  return data;
}

async function guardAdmin() {
  try {
    const r = await api('/api/admin-session');
    if (!r.ok) window.location.href = '/admin/login.html';
  } catch (_) {
    window.location.href = '/admin/login.html';
  }
}

function toast(msg, type = '') {
  let el = document.getElementById('pdsToast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'pdsToast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 3200);
}

function renderSidebar(active) {
  const items = [
    { href: '/admin/index.html', label: 'Tổng quan', key: 'dashboard' },
    { href: '/admin/novels.html', label: 'Truyện', key: 'novels' },
    { href: '/admin/labels.html', label: 'Thể loại', key: 'labels' },
    { href: '/admin/chapters.html', label: 'Đăng chương', key: 'chapters' },
  ];
  const nav = items.map(i =>
    `<a href="${i.href}" class="${i.key === active ? 'active' : ''}">${i.label}</a>`
  ).join('');
  return `
    <div id="sidebar">
      <div class="brand">✦ Phòng Đọc Số 0</div>
      ${nav}
      <div class="spacer"></div>
      <span class="logout" id="pdsLogoutBtn">Đăng xuất</span>
    </div>`;
}

function mountShell(active, mainHtml) {
  document.getElementById('app').innerHTML = `
    <div id="shell">
      ${renderSidebar(active)}
      <main>${mainHtml}</main>
    </div>`;
  const btn = document.getElementById('pdsLogoutBtn');
  if (btn) btn.addEventListener('click', async () => {
    await api('/api/admin-logout', { method: 'POST' });
    window.location.href = '/admin/login.html';
  });
}

function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('vi-VN', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
}
