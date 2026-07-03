// ════════════════════════════════════
// PHÒNG ĐỌC SỐ 0 — Reaction + Bình luận theo CHƯƠNG
// Dùng lại 2 Apps Script cũ (COMMENT_URL, REACT_URL trong config.js)
// nhưng khóa theo chapter_id thay vì postUrl của Blogger.
// Hỗ trợ: thông báo sau khi react, trả lời bình luận (reply lồng nhau).
// ════════════════════════════════════

window.initReactionsComments = function initReactionsComments() {
  const ctx = window.PDS_REACT_CTX;
  if (!ctx || !ctx.chapter_id) return;

  const CHAPTER_KEY = `${ctx.novel_slug}/${ctx.chapter_id}`; // khóa ổn định, duy nhất theo chương
  const CHAPTER_TITLE = document.getElementById('ch-title')?.textContent || '';

  const reactRow   = document.getElementById('reactionsRow');
  const reactMsgEl = document.getElementById('reactionMsg');
  const commentForm= document.getElementById('commentForm');
  const nameEl     = document.getElementById('commentName');
  const bodyEl     = document.getElementById('commentContent');
  const submitBtn  = document.getElementById('commentSubmitBtn');
  const listEl     = document.getElementById('commentList');

  // ─────────────────────────────
  // REACTIONS
  // ─────────────────────────────
  const RE = { love: '❤️', fire: '🔥', cry: '😭', shock: '😱', star: '⭐' };
  const RE_MSG = {
    love:  '❤️ Lữ khách đã thả tim cho truyện này!',
    fire:  '🔥 Cháy khét lẹt rồi!',
    cry:   '😭 Lữ khách đã khóc cùng nhân vật!',
    shock: '😱 Cốt truyện gây sốc thật sự!',
    star:  '⭐ Lữ khách đánh giá 5 sao!',
  };
  const RK = 'pds_react_voted_' + CHAPTER_KEY.replace(/\W+/g, '_');

  function getVoted() { try { return localStorage.getItem(RK) || null; } catch { return null; } }
  function saveVoted(t) { try { localStorage.setItem(RK, t); } catch {} }

  function showReactionMsg(type) {
    if (!reactMsgEl) return;
    const msg = RE_MSG[type];
    if (!msg) { reactMsgEl.classList.remove('show'); return; }
    reactMsgEl.textContent = msg;
    reactMsgEl.classList.add('show');
  }

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

    if (voted) showReactionMsg(voted);
  }

  function doReact(type) {
    if (getVoted()) return;
    saveVoted(type);
    renderReactions(currentCounts, type);
    showReactionMsg(type);
    fetch('/api/reactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ post: CHAPTER_KEY, type }),
    })
      .then(r => r.json())
      .then(d => { currentCounts = d.counts || {}; renderReactions(currentCounts, type); })
      .catch(() => {});
  }

  let currentCounts = null;
  function fetchReactions() {
    fetch(`/api/reactions?post=${encodeURIComponent(CHAPTER_KEY)}`)
      .then(r => r.json())
      .then(d => { currentCounts = d.counts || {}; renderReactions(currentCounts, getVoted()); })
      .catch(() => renderReactions(null, getVoted()));
  }

  // ─────────────────────────────
  // COMMENTS (hỗ trợ trả lời — reply lồng 1 cấp)
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

  // id an toàn để gắn vào DOM (data-attrs)
  function safeId(id) { return String(id ?? '').replace(/[^a-zA-Z0-9_-]/g, ''); }

  let allComments = [];
  let openReplyId = null; // id bình luận đang mở form trả lời

  function buildTree(items) {
    const byId = new Map();
    items.forEach(c => byId.set(String(c.id), { ...c, replies: [] }));
    const roots = [];
    byId.forEach(c => {
      const pid = c.parentId ? String(c.parentId) : null;
      if (pid && byId.has(pid)) byId.get(pid).replies.push(c);
      else roots.push(c);
    });
    roots.sort((a, b) => b.ts - a.ts);
    roots.forEach(r => r.replies.sort((a, b) => a.ts - b.ts));
    return roots;
  }

  function renderComment(c, isReply) {
    const sid = safeId(c.id);
    const adminBadge = c.isAdmin ? '<span class="comment-admin-badge">Quản thư</span>' : '';
    const replyBtn = isReply ? '' : `<div class="comment-actions"><button class="comment-reply-btn" data-reply="${sid}">Trả lời</button></div>`;
    const replyForm = (!isReply && openReplyId === String(c.id)) ? `
      <form class="reply-form" data-reply-form="${sid}">
        <input type="text" class="reply-name" placeholder="Tên hiển thị..." maxlength="40" required/>
        <textarea class="reply-body" placeholder="Viết trả lời..." maxlength="1000" required></textarea>
        <div class="reply-form-actions">
          <button type="button" class="btn-cancel" data-cancel-reply="${sid}">Huỷ</button>
          <button type="submit" class="btn-send">Gửi</button>
        </div>
      </form>` : '';

    const repliesHtml = (c.replies && c.replies.length)
      ? `<div class="comment-replies">${c.replies.map(r => renderComment(r, true)).join('')}</div>`
      : '';

    return `
      <div class="comment-item" data-comment-id="${sid}">
        <div class="comment-item-head">
          <span class="comment-author">${esc(initials(c.name))} · ${esc(c.name)}</span>
          ${adminBadge}
          <span class="comment-time">${timeAgo(c.ts)}</span>
        </div>
        <div class="comment-body">${esc(c.body)}</div>
        ${replyBtn}
        ${replyForm}
        ${repliesHtml}
      </div>`;
  }

  function countAll(items) {
    return items.reduce((n, c) => n + 1 + countAll(c.replies || []), 0);
  }

  function renderComments(items) {
    if (!listEl) return;
    allComments = items;
    const tree = buildTree(items);
    const countEl = document.querySelector('.novel-comments h2');
    if (countEl) countEl.textContent = `✦ Bình luận chương này (${items.length})`;

    if (!items.length) {
      listEl.innerHTML = '<div class="empty-msg">Chưa có bình luận nào cho chương này. Hãy là người đầu tiên!</div>';
      return;
    }
    listEl.innerHTML = tree.map(c => renderComment(c, false)).join('');

    listEl.querySelectorAll('[data-reply]').forEach(btn => {
      btn.addEventListener('click', () => {
        openReplyId = openReplyId === btn.dataset.reply ? null : btn.dataset.reply;
        renderComments(allComments);
      });
    });
    listEl.querySelectorAll('[data-cancel-reply]').forEach(btn => {
      btn.addEventListener('click', () => { openReplyId = null; renderComments(allComments); });
    });
    listEl.querySelectorAll('[data-reply-form]').forEach(form => {
      form.addEventListener('submit', e => {
        e.preventDefault();
        const parentId = form.dataset.replyForm;
        const name = form.querySelector('.reply-name').value.trim();
        const body = form.querySelector('.reply-body').value.trim();
        if (!name || !body) return;
        submitComment(name, body, parentId, form);
      });
    });
  }

  function fetchComments() {
    if (listEl) listEl.innerHTML = '<div class="empty-msg">Đang tải bình luận...</div>';
    fetch(`/api/comments?postUrl=${encodeURIComponent(CHAPTER_KEY)}`)
      .then(r => r.json())
      .then(d => renderComments(d.ok ? (d.data || []) : []))
      .catch(() => renderComments([]));
  }

  function submitComment(name, body, parentId, formEl) {
    const btn = formEl ? formEl.querySelector('.btn-send') : submitBtn;
    if (btn) { btn.disabled = true; btn.textContent = formEl ? 'Đang gửi...' : 'Đang gửi...'; }

    const payload = { postUrl: CHAPTER_KEY, postTitle: CHAPTER_TITLE, name, body };
    if (parentId) payload.parentId = parentId;

    fetch('/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(r => r.json())
      .then(d => {
        if (d.ok) {
          if (formEl) {
            openReplyId = null;
          } else {
            if (nameEl) nameEl.value = '';
            if (bodyEl) bodyEl.value = '';
          }
          fetchComments();
        } else {
          if (btn) { btn.disabled = false; btn.textContent = formEl ? 'Gửi' : 'Gửi bình luận'; }
          alert('Lỗi gửi bình luận: ' + (d.reason || 'unknown'));
        }
      })
      .catch(() => {
        if (btn) { btn.disabled = false; btn.textContent = formEl ? 'Gửi' : 'Gửi bình luận'; }
        alert('Không kết nối được. Vui lòng thử lại.');
      });
  }

  commentForm?.addEventListener('submit', e => {
    e.preventDefault();
    const name = (nameEl?.value || '').trim();
    const body = (bodyEl?.value || '').trim();
    if (!name || !body) {
      if (!name) nameEl?.focus(); else bodyEl?.focus();
      return;
    }
    submitComment(name, body, null, null);
  });

  fetchReactions();
  fetchComments();
};
