// ════════════════════════════════════
// PHÒNG ĐỌC SỐ 0 — Reaction + Bình luận theo CHƯƠNG
// Dùng lại 2 Apps Script cũ (COMMENT_URL, REACT_URL trong config.js)
// nhưng khóa theo chapter_id thay vì postUrl của Blogger.
// ════════════════════════════════════

window.initReactionsComments = function initReactionsComments() {
  const ctx = window.PDS_REACT_CTX;
  if (!ctx || !ctx.chapter_id) return;

  const CHAPTER_KEY = `${ctx.novel_slug}/${ctx.chapter_id}`; // khóa ổn định, duy nhất theo chương
  const CHAPTER_TITLE = document.getElementById('ch-title')?.textContent || '';

  const reactRow   = document.getElementById('reactionsRow');
  const commentForm= document.getElementById('commentForm');
  const nameEl     = document.getElementById('commentName');
  const bodyEl     = document.getElementById('commentContent');
  const submitBtn  = document.getElementById('commentSubmitBtn');
  const listEl     = document.getElementById('commentList');

  // ─────────────────────────────
  // REACTIONS
  // ─────────────────────────────
  const RE = { love: '❤️', fire: '🔥', cry: '😭', shock: '😱', star: '⭐' };
  const RK = 'pds_react_voted_' + CHAPTER_KEY.replace(/\W+/g, '_');

  function getVoted() { try { return localStorage.getItem(RK) || null; } catch { return null; } }
  function saveVoted(t) { try { localStorage.setItem(RK, t); } catch {} }

  function renderReactions(counts, voted) {
    if (!reactRow) return;
    reactRow.innerHTML = Object.keys(RE).map(type => `
      <button class="reaction-btn${voted === type ? ' active' : ''}" data-type="${type}" ${voted ? 'disabled' : ''}>
        <span class="reaction-emoji">${RE[type]}</span>
        <span class="reaction-count" id="rc-${type}">${(counts && counts[type]) || 0}</span>
      </button>`).join('');

    reactRow.querySelectorAll('.reaction-btn').forEach(btn => {
      btn.addEventListener('click', () => doReact(btn.dataset.type));
    });
  }

  function doReact(type) {
    if (getVoted()) return;
    saveVoted(type);
    renderReactions(currentCounts, type);
    fetch(`${PDS_CONFIG.REACT_URL}?action=add&post=${encodeURIComponent(CHAPTER_KEY)}&type=${type}`)
      .then(r => r.json())
      .then(counts => { currentCounts = counts; renderReactions(counts, type); })
      .catch(() => {});
  }

  let currentCounts = null;
  function fetchReactions() {
    fetch(`${PDS_CONFIG.REACT_URL}?action=get&post=${encodeURIComponent(CHAPTER_KEY)}`)
      .then(r => r.json())
      .then(counts => { currentCounts = counts; renderReactions(counts, getVoted()); })
      .catch(() => renderReactions(null, getVoted()));
  }

  // ─────────────────────────────
  // COMMENTS
  // ─────────────────────────────
  function esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function timeAgo(ts) {
    const m = Math.floor((Date.now() - Number(ts)) / 60000);
    if (m < 1) return 'vừa xong';
    if (m < 60) return m + ' phút trước';
    const h = Math.floor(m / 60);
    return h < 24 ? h + ' giờ trước' : Math.floor(h / 24) + ' ngày trước';
  }
  function initials(n) {
    return String(n || '?').trim().split(/\s+/).map(w => w[0] || '').join('').toUpperCase().slice(0, 2) || '?';
  }

  function renderComments(items) {
    if (!listEl) return;
    const countEl = document.querySelector('.novel-comments h2');
    if (countEl) countEl.textContent = `✦ Bình luận chương này (${items.length})`;

    if (!items.length) {
      listEl.innerHTML = '<div class="empty-msg">Chưa có bình luận nào cho chương này. Hãy là người đầu tiên!</div>';
      return;
    }
    listEl.innerHTML = items
      .sort((a, b) => b.ts - a.ts)
      .map(c => `
        <div class="comment-item">
          <div class="comment-item-head">
            <span class="comment-author">${esc(initials(c.name))} · ${esc(c.name)}</span>
            <span class="comment-time">${timeAgo(c.ts)}</span>
          </div>
          <div class="comment-body">${esc(c.body)}</div>
        </div>`).join('');
  }

  function fetchComments() {
    if (listEl) listEl.innerHTML = '<div class="empty-msg">Đang tải bình luận...</div>';
    fetch(`${PDS_CONFIG.COMMENT_URL}?action=getComments&postUrl=${encodeURIComponent(CHAPTER_KEY)}`)
      .then(r => r.json())
      .then(d => renderComments(d.ok ? (d.data || []) : []))
      .catch(() => renderComments([]));
  }

  function submitComment() {
    const name = (nameEl?.value || '').trim();
    const body = (bodyEl?.value || '').trim();
    if (!name || !body) {
      if (!name) nameEl?.focus(); else bodyEl?.focus();
      return;
    }
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Đang gửi...'; }

    const params = 'action=addComment'
      + '&postUrl=' + encodeURIComponent(CHAPTER_KEY)
      + '&postTitle=' + encodeURIComponent(CHAPTER_TITLE)
      + '&name=' + encodeURIComponent(name)
      + '&body=' + encodeURIComponent(body);

    fetch(`${PDS_CONFIG.COMMENT_URL}?${params}`)
      .then(r => r.json())
      .then(d => {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Gửi bình luận'; }
        if (d.ok) {
          if (nameEl) nameEl.value = '';
          if (bodyEl) bodyEl.value = '';
          fetchComments();
        } else {
          alert('Lỗi gửi bình luận: ' + (d.error || 'unknown'));
        }
      })
      .catch(() => {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Gửi bình luận'; }
        alert('Không kết nối được. Vui lòng thử lại.');
      });
  }

  commentForm?.addEventListener('submit', e => { e.preventDefault(); submitComment(); });

  fetchReactions();
  fetchComments();
};
