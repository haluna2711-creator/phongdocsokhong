// ════════════════════════════════════
// PHÒNG ĐỌC SỐ 0 — Main App Logic
// ════════════════════════════════════

// ── Global state ──
let libraryBooks  = [];
let activeFilter  = 'all';
let carouselPos   = 0;
let carouselAutoTimer;
let currentBanner  = 0;
let currentFeatured = 0;
let featuredTimer;
let bannerTimer;
let _cachedCardWidth = 0;

const VIEW_KEY_PREFIX = 'pds_views_';

// ════════════════════════════════════
// BLOGGER FETCHER
// ════════════════════════════════════
const GENRE_MAP = {
  'Trinh thám': 'Trinh thám',
  'Vô hạn lưu': 'Vô hạn lưu',
  'Cổ đại':     'Cổ đại',
  'Kinh dị':    'Kinh dị',
  'Hệ thống':   'Hệ thống',
};

function extractThumbnail(entry) {
  if (entry.media$thumbnail?.url) return entry.media$thumbnail.url.replace(/\/s[0-9]+-c\//, '/s400-c/');
  const content = entry.content?.$t || '';
  const match = content.match(/<img[^>]+src=["']([^"']+)["']/i);
  return match ? match[1] : '';
}

function extractChapter(entry) {
  const title = entry.title.$t || '';
  const m = title.match(/ch[aươ]*\.?\s*(\d+)/i);
  return m ? 'Ch.' + m[1] : '';
}

function parseEntry(entry) {
  const labels  = (entry.category || []).map(c => c.term);
  const genre   = labels.find(l => GENRE_MAP[l]) || 'Thư Viện Truyện';
  const links   = entry.link || [];
  const readUrl = (
    links.find(l => l.rel === 'alternate' && l.type === 'text/html') ||
    links.find(l => l.rel === 'alternate') ||
    links.find(l => l.type === 'text/html')
  )?.href || '#';
  const cover   = extractThumbnail(entry);
  const bg      = PDS_CONFIG.GENRE_BG[genre] || PDS_CONFIG.GENRE_BG['default'];
  const updated = entry.updated?.$t ? new Date(entry.updated.$t).getTime() : Date.now();
  return { id: readUrl, title: entry.title.$t, genre, cover, readUrl, chapter: extractChapter(entry), label: 'Thư Viện Truyện', bg, updatedAt: updated, blogLabels: labels };
}

function fetchByLabel(label) {
  // Dùng Vercel API proxy để tránh CORS
  const url = `/api/feed?label=${encodeURIComponent(label)}&max=${PDS_CONFIG.MAX_RESULTS}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  return fetch(url, { signal: ctrl.signal })
    .then(r => { clearTimeout(timer); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then(data => (data.feed?.entry || []).map(parseEntry))
    .catch(err => { clearTimeout(timer); console.warn(`[PDS] Fetch label "${label}":`, err); return []; });
}

function mergeBooks(existing, fetched) {
  const existingUrls = new Set(existing.map(b => b.readUrl));
  return [...existing, ...fetched.filter(b => !existingUrls.has(b.readUrl))]
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

async function loadBloggerBooks() {
  try {
    const results = await Promise.all(PDS_CONFIG.TARGET_LABELS.map(fetchByLabel));
    const fetched = results.flat();
    if (!fetched.length) return;
    libraryBooks = mergeBooks(libraryBooks, fetched);
    const doRender = () => {
      renderFilterBar();
      renderLibrary();
      renderFeatured();
      setTimeout(attachViewTracking, 800);
    };
    'requestIdleCallback' in window ? requestIdleCallback(doRender, { timeout: 1500 }) : setTimeout(doRender, 0);
  } catch (e) { console.error('[PDS] loadBloggerBooks:', e); }
}

// ════════════════════════════════════
// VIEW COUNTER
// ════════════════════════════════════
function getViewCount(readUrl) {
  try { return parseInt(localStorage.getItem(VIEW_KEY_PREFIX + btoa(readUrl).slice(0, 20)) || '0', 10); } catch { return 0; }
}
function incrementView(readUrl) {
  try { const k = VIEW_KEY_PREFIX + btoa(readUrl).slice(0, 20); localStorage.setItem(k, (parseInt(localStorage.getItem(k) || '0', 10) + 1)); } catch {}
}
function attachViewTracking() {
  document.querySelectorAll('.cf-read-link').forEach(link => {
    link.addEventListener('click', () => {
      const idx = parseInt(link.closest('.cf-card')?.dataset.cfIdx || '0', 10);
      const newest = [...libraryBooks].filter(b => b.label === 'Thư Viện Truyện').sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 5);
      if (newest[idx]) incrementView(newest[idx].readUrl);
    });
  });
  document.querySelectorAll('.starry-card-overlay a').forEach(link => {
    link.addEventListener('click', () => { if (link.href && link.href !== '#') incrementView(link.href); });
  });
}

// ════════════════════════════════════
// BANNER SLIDESHOW
// ════════════════════════════════════
function initBanner() {
  const slides = document.querySelectorAll('.banner-slide');
  if (!slides.length) return;
  function goTo(idx) {
    const mob = window.innerWidth <= 768;
    slides[currentBanner].classList.remove('active');
    if (mob) slides[currentBanner].style.display = 'none';
    currentBanner = (idx + slides.length) % slides.length;
    slides[currentBanner].classList.add('active');
    if (mob) slides[currentBanner].style.display = '';
  }
  bannerTimer = setInterval(() => goTo(currentBanner + 1), 4500);
  window.goToBanner = goTo;
}

// ════════════════════════════════════
// FEATURED COVER SLIDER
// ════════════════════════════════════
function getTopBooks() {
  return [...libraryBooks]
    .filter(b => b.label === 'Thư Viện Truyện')
    .map(b => ({ ...b, views: getViewCount(b.readUrl) }))
    .sort((a, b) => b.views - a.views || (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, 3);
}

function renderFeatured() {
  const top = getTopBooks();
  if (!top.length) return;
  const slides = document.querySelectorAll('.featured-slide');
  const dots   = document.querySelectorAll('.featured-dot');

  top.forEach((book, i) => {
    const slide = slides[i]; if (!slide) return;
    if (book.cover) {
      const existing = slide.querySelector('img.featured-auto-img');
      if (existing) { existing.src = book.cover; }
      else {
        const img = document.createElement('img');
        img.className = 'featured-auto-img'; img.src = book.cover; img.loading = 'lazy'; img.decoding = 'async';
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;position:absolute;inset:0;';
        img.onerror = () => img.style.display = 'none';
        const ph = slide.querySelector('.featured-cover-placeholder');
        ph ? (slide.insertBefore(img, ph), ph.style.display = 'none') : slide.insertBefore(img, slide.firstChild);
      }
    }
    const btn = slide.querySelector('.btn-read-now');
    if (btn && book.readUrl) { btn.href = book.readUrl; btn.onclick = () => incrementView(book.readUrl); }
  });

  updateFeaturedInfo(top);

  function goToFeatured(idx) {
    slides[currentFeatured]?.classList.remove('active');
    dots[currentFeatured]?.classList.remove('active');
    currentFeatured = (idx + slides.length) % slides.length;
    slides[currentFeatured]?.classList.add('active');
    dots[currentFeatured]?.classList.add('active');
    updateFeaturedInfo(top);
  }

  dots.forEach(dot => dot.addEventListener('click', () => goToFeatured(+dot.dataset.dot)));
  clearInterval(featuredTimer);
  featuredTimer = setInterval(() => goToFeatured(currentFeatured + 1), 3800);
  window.goToFeatured = goToFeatured;

  // Mobile tap overlay
  if ('ontouchstart' in window) {
    document.getElementById('featuredSlider')?.addEventListener('touchend', e => {
      const btn = e.target.closest('.btn-read-now');
      const slide = e.target.closest('.featured-slide');
      if (!slide) return;
      if (btn) return;
      e.preventDefault();
      const isOpen = slide.classList.contains('tapped');
      document.querySelectorAll('.featured-slide').forEach(s => s.classList.remove('tapped'));
      if (!isOpen) slide.classList.add('tapped');
    }, { passive: false });
    document.addEventListener('touchend', e => {
      if (!e.target.closest('#featuredSlider')) document.querySelectorAll('.featured-slide').forEach(s => s.classList.remove('tapped'));
    }, { passive: true });
  }
}

function updateFeaturedInfo(top) {
  const book = top[currentFeatured]; if (!book) return;
  const titleEl = document.getElementById('featuredTitle');
  const descEl  = document.getElementById('featuredDesc');
  const boxEl   = document.getElementById('featuredInfoBox');
  if (titleEl) titleEl.textContent = book.title;
  if (descEl)  descEl.textContent  = book.desc || book.genre + (book.chapter ? ' · ' + book.chapter : '');
  if (boxEl)   boxEl.style.opacity = '1';
}

// ════════════════════════════════════
// LIBRARY
// ════════════════════════════════════
function buildCard(book) {
  const card = document.createElement('div');
  card.className = 'starry-card'; card.dataset.id = book.id; card.dataset.genre = book.genre;
  const coverHtml = book.cover
    ? `<img src="${book.cover}" alt="${book.title}" loading="lazy" decoding="async" style="width:100%;height:100%;object-fit:cover;position:absolute;inset:0;" onerror="this.style.display='none'">`
    : `<div class="starry-card-placeholder" style="background:${book.bg};"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg></div>`;
  card.innerHTML = `
    <div class="starry-card-cover">
      ${coverHtml}
      <div class="starry-card-overlay">
        <a class="btn-read-now" href="${book.readUrl}" style="font-size:10px;padding:7px 16px;">ĐỌC NGAY</a>
      </div>
    </div>
    <div class="starry-card-title">${book.title}</div>
    <div class="starry-card-genre">${book.genre}${book.chapter ? ' · ' + book.chapter : ''}</div>`;
  return card;
}

function renderLibrary() {
  const container = document.getElementById('starryCards');
  const emptyEl   = document.getElementById('libraryEmpty');
  const emptyText = document.getElementById('libraryEmptyText');
  if (!container) return;

  let filtered = libraryBooks.filter(b => b.label === 'Thư Viện Truyện');
  if (activeFilter !== 'all') filtered = filtered.filter(b => b.genre === activeFilter);
  filtered = filtered.slice(0, 10);
  container.innerHTML = '';

  if (!filtered.length) {
    container.style.display = 'none'; emptyEl.style.display = 'flex';
    emptyText.innerHTML = activeFilter !== 'all' ? `Chưa có truyện thể loại <strong>${activeFilter}</strong>.` : 'Thư viện đang trống.';
    document.getElementById('carouselPrev').style.visibility = 'hidden';
    document.getElementById('carouselNext').style.visibility = 'hidden';
    document.querySelector('.orb-track').style.visibility = 'hidden';
  } else {
    container.style.display = 'flex'; emptyEl.style.display = 'none';
    document.getElementById('carouselPrev').style.visibility = 'visible';
    document.getElementById('carouselNext').style.visibility = 'visible';
    document.querySelector('.orb-track').style.visibility = 'visible';
    filtered.forEach(book => container.appendChild(buildCard(book)));
  }
  updateCounts(); resetCarousel();
  if (typeof renderCoverflow === 'function') renderCoverflow();
}

function renderFilterBar() {
  const bar = document.getElementById('libraryFilterBar');
  if (!bar) return;
  const genres = [...new Set(libraryBooks.filter(b => b.label === 'Thư Viện Truyện').map(b => b.genre))];
  bar.innerHTML = `
    <button class="lib-filter-btn active" data-filter="all" onclick="filterLibrary('all',this)">
      Đam Mỹ <span class="lib-count-badge" id="countAll">0</span>
    </button>
    ${genres.map(g => `<button class="lib-filter-btn" data-filter="${g}" onclick="filterLibrary('${g}',this)">${g}</button>`).join('')}`;
  updateCounts();
}

function updateCounts() {
  const countEl = document.getElementById('countAll');
  if (countEl) countEl.textContent = libraryBooks.filter(b => b.label === 'Thư Viện Truyện').length;
}

function filterLibrary(genre, btn) {
  activeFilter = genre;
  document.querySelectorAll('.lib-filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderLibrary();
}

// ════════════════════════════════════
// CAROUSEL
// ════════════════════════════════════
function getCardWidth() {
  if (_cachedCardWidth) return _cachedCardWidth;
  const card = document.querySelector('.starry-card');
  _cachedCardWidth = card ? card.offsetWidth + 24 : 200;
  return _cachedCardWidth;
}
window.addEventListener('resize', () => { _cachedCardWidth = 0; }, { passive: true });
function getVisibleCount() { return Math.floor((document.getElementById('starryOuter')?.offsetWidth || 800) / getCardWidth()) || 1; }
function getTotalCards()   { return document.querySelectorAll('.starry-card').length; }
function getMaxPos()       { return Math.max(0, getTotalCards() - getVisibleCount()); }
function slideCarousel(dir) {
  const cards = document.getElementById('starryCards');
  carouselPos = Math.max(0, Math.min(getMaxPos(), carouselPos + dir));
  if (cards) cards.style.transform = `translateX(-${carouselPos * getCardWidth()}px)`;
}
function resetCarousel() {
  carouselPos = 0;
  const cards = document.getElementById('starryCards');
  if (cards) cards.style.transform = 'translateX(0)';
  clearInterval(carouselAutoTimer);
  carouselAutoTimer = setInterval(() => {
    if (carouselPos >= getMaxPos()) { carouselPos = 0; if (cards) cards.style.transform = 'translateX(0)'; }
    else slideCarousel(1);
  }, 3200);
}

function initCarousel() {
  const prev = document.getElementById('carouselPrev');
  const next = document.getElementById('carouselNext');
  const outer = document.getElementById('starryOuter');
  if (!prev || !next || !outer) return;

  const rebuildTimer = () => {
    clearInterval(carouselAutoTimer);
    const cards = document.getElementById('starryCards');
    carouselAutoTimer = setInterval(() => {
      if (carouselPos >= getMaxPos()) { carouselPos = 0; if (cards) cards.style.transform = 'translateX(0)'; }
      else slideCarousel(1);
    }, 3200);
  };

  prev.addEventListener('click', () => { clearInterval(carouselAutoTimer); slideCarousel(-1); rebuildTimer(); });
  next.addEventListener('click', () => { clearInterval(carouselAutoTimer); slideCarousel(1);  rebuildTimer(); });

  // Drag / touch
  let dragStartX = null, dragCurrentX = null, isDragging = false;
  outer.addEventListener('mousedown',  e => { dragStartX = e.clientX; isDragging = true; });
  outer.addEventListener('mousemove',  e => { if (isDragging) dragCurrentX = e.clientX; });
  outer.addEventListener('mouseup',    ()  => { if (isDragging && dragStartX !== null && dragCurrentX !== null && Math.abs(dragStartX - dragCurrentX) > 40) slideCarousel(dragStartX - dragCurrentX > 0 ? 1 : -1); isDragging = false; dragStartX = dragCurrentX = null; });
  outer.addEventListener('mouseleave', ()  => { isDragging = false; dragStartX = dragCurrentX = null; });
  outer.addEventListener('touchstart', e  => { dragStartX = e.touches[0].clientX; }, { passive: true });
  outer.addEventListener('touchend',   e  => { if (dragStartX !== null && Math.abs(dragStartX - e.changedTouches[0].clientX) > 40) slideCarousel(dragStartX - e.changedTouches[0].clientX > 0 ? 1 : -1); dragStartX = null; }, { passive: true });
}

// ════════════════════════════════════
// COVERFLOW
// ════════════════════════════════════
function initCoverflow() {
  const CF_COUNT  = 3;
  const positions = ['pos-left2','pos-left1','pos-center','pos-right1','pos-right2'];
  const track     = document.getElementById('cfTrack');
  const dotsEl    = document.querySelector('.cf-dots');
  const wrapper   = document.getElementById('cfWrapper');
  if (!track || !dotsEl) return;

  let current = 0, cfCards = [], cfAuto;

  function timeAgo(ts) {
    if (!ts) return '';
    const d = Date.now() - ts, m = Math.floor(d / 60000);
    if (m < 1) return 'vừa cập nhật';
    if (m < 60) return `${m} phút trước`;
    const h = Math.floor(m / 60);
    return h < 24 ? `${h} giờ trước` : `${Math.floor(h / 24)} ngày trước`;
  }

  window.renderCoverflow = function () {
    const newest = [...libraryBooks]
      .filter(b => b.label === 'Thư Viện Truyện')
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .slice(0, CF_COUNT);

    track.innerHTML = ''; dotsEl.innerHTML = ''; cfCards = [];

    if (!newest.length) {
      track.innerHTML = '<div style="color:var(--text-muted);font-size:14px;font-style:italic;">Chưa có truyện nào.</div>';
      return;
    }

    newest.forEach((book, i) => {
      const card = document.createElement('div');
      card.className = 'cf-card'; card.dataset.cfIdx = i;
      const hasImg = !!(book.cover?.trim());
      card.innerHTML = `
        ${hasImg ? `<img class="cf-card-img" src="${book.cover}" alt="${book.title}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">` : ''}
        <div class="cf-card-placeholder" style="background:${book.bg};${hasImg?'display:none':''}"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg></div>
        <div class="cf-overlay">
          <div class="cf-badge">${i === 0 ? 'MỚI NHẤT' : 'MỚI'}</div>
          <div class="cf-title">${book.title}</div>
          <div class="cf-meta">${book.genre}${book.chapter ? ' · ' + book.chapter : ''}</div>
          <div class="cf-time">${timeAgo(book.updatedAt)}</div>
        </div>
        <a class="cf-read-link" href="${book.readUrl || '#'}" title="Đọc ${book.title}"></a>`;

      card.addEventListener('click', e => {
        if (e.target.closest('.cf-read-link') && i === current) return;
        if (i !== current) { e.preventDefault(); clearInterval(cfAuto); goTo(i); startAuto(); }
      });
      track.appendChild(card); cfCards.push(card);

      const dot = document.createElement('div');
      dot.className = 'cf-dot' + (i === 0 ? ' active' : '');
      dot.dataset.cfDot = i;
      dot.addEventListener('click', () => { clearInterval(cfAuto); goTo(i); startAuto(); });
      dotsEl.appendChild(dot);
    });

    current = Math.min(current, newest.length - 1);
    applyPositions();
  };

  function getPositionClass(cardIdx) {
    let d = Math.max(-2, Math.min(2, cardIdx - current));
    return positions[d + 2];
  }
  function applyPositions() {
    cfCards.forEach((card, i) => { card.classList.remove(...positions); card.classList.add(getPositionClass(i)); });
    document.querySelectorAll('.cf-dot').forEach((dot, i) => dot.classList.toggle('active', i === current));
  }
  function goTo(idx) {
    const total = cfCards.length; if (!total) return;
    current = ((idx % total) + total) % total; applyPositions();
  }
  function startAuto() { clearInterval(cfAuto); cfAuto = setInterval(() => goTo(current + 1), 3600); }

  document.getElementById('cfPrev')?.addEventListener('click', () => { clearInterval(cfAuto); goTo(current - 1); startAuto(); });
  document.getElementById('cfNext')?.addEventListener('click', () => { clearInterval(cfAuto); goTo(current + 1); startAuto(); });

  let cfTouchStart = null;
  wrapper?.addEventListener('touchstart', e => { cfTouchStart = e.touches[0].clientX; }, { passive: true });
  wrapper?.addEventListener('touchend', e => {
    if (cfTouchStart === null) return;
    const diff = cfTouchStart - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 40) { clearInterval(cfAuto); goTo(current + (diff > 0 ? 1 : -1)); startAuto(); }
    cfTouchStart = null;
  }, { passive: true });

  renderCoverflow();
  goTo(Math.min(1, cfCards.length - 1 < 0 ? 0 : Math.min(1, cfCards.length - 1)));
  startAuto();
}

// ════════════════════════════════════
// GALAXY CANVAS
// ════════════════════════════════════
function initGalaxyCanvas() {
  const canvas = document.getElementById('galaxyCanvas');
  if (!canvas) return;
  const isLowEnd = navigator.hardwareConcurrency <= 2 || (window.innerWidth <= 768 && navigator.hardwareConcurrency <= 4);
  if (isLowEnd) { canvas.style.display = 'none'; return; }

  const ctx = canvas.getContext('2d');
  let W, H, stars = [], dustParticles = [], animId, isVisible = false;

  const observer = new IntersectionObserver(entries => {
    isVisible = entries[0].isIntersecting;
    if (isVisible && !animId) { resize(); draw(); }
    if (!isVisible && animId) { cancelAnimationFrame(animId); animId = null; }
  }, { threshold: 0.01 });
  observer.observe(canvas);

  function resize() {
    W = canvas.width = canvas.offsetWidth; H = canvas.height = canvas.offsetHeight; buildGalaxy();
  }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function buildGalaxy() {
    stars = []; dustParticles = [];
    const num = Math.floor(W * (window.innerWidth <= 768 ? 0.25 : 0.55));
    for (let i = 0; i < num; i++) {
      const arm = Math.floor(Math.random() * 3), t = Math.random();
      const angle = arm * (Math.PI * 2 / 3) + t * Math.PI * 3.5, r = t * (W * 0.48);
      const spread = rand(-H * 0.22, H * 0.22) * (1 - t * 0.6);
      stars.push({ x: W * 0.5 + Math.cos(angle) * r + rand(-spread * 0.4, spread * 0.4), y: H * 0.5 + Math.sin(angle) * r * 0.28 + spread * 0.55, r: rand(0.35, 1.8), a: rand(0.25, 1), twinkleSpeed: rand(0.008, 0.025), twinklePhase: Math.random() * Math.PI * 2, gold: Math.random() > 0.55, vx: rand(-0.06, 0.06) });
    }
    for (let i = 0; i < 22; i++) dustParticles.push({ x: rand(W * 0.05, W * 0.95), y: rand(H * 0.2, H * 0.8), rx: rand(40, 120), ry: rand(8, 28), angle: rand(-0.25, 0.25), a: rand(0.03, 0.1), gold: Math.random() > 0.5 });
  }
  function draw() {
    if (!isVisible) { animId = null; return; }
    ctx.clearRect(0, 0, W, H);
    dustParticles.forEach(d => {
      ctx.save(); ctx.translate(d.x, d.y); ctx.rotate(d.angle);
      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, d.rx);
      const c = d.gold ? '248,219,143' : '180,140,60';
      grad.addColorStop(0, `rgba(${c},${d.a})`); grad.addColorStop(1, `rgba(${c},0)`);
      ctx.fillStyle = grad; ctx.scale(1, d.ry / d.rx); ctx.beginPath(); ctx.arc(0, 0, d.rx, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    });
    stars.forEach(s => {
      s.twinklePhase += s.twinkleSpeed;
      const alpha = s.a * (0.6 + 0.4 * Math.sin(s.twinklePhase));
      s.x += s.vx; if (s.x < 0) s.x = W; if (s.x > W) s.x = 0;
      ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = s.gold ? `rgba(248,219,143,${alpha})` : `rgba(200,168,75,${alpha})`; ctx.shadowBlur = s.r > 1.2 ? 6 : 0; ctx.shadowColor = 'rgba(248,219,143,0.8)'; ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    });
    animId = requestAnimationFrame(draw);
  }
  let resizeTimer;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { cancelAnimationFrame(animId); animId = null; if (isVisible) { resize(); draw(); } }, 200); });
}

// ════════════════════════════════════
// MOBILE MENU
// ════════════════════════════════════
function initMobileMenu() {
  const hamburger     = document.getElementById('hamburger');
  const mobileMenu    = document.getElementById('mobileMenu');
  const mobileOverlay = document.getElementById('mobileOverlay');
  const marsPlanet    = document.getElementById('marsPlanet');
  if (!mobileMenu) return;

  function openMenu() { hamburger?.classList.add('open'); marsPlanet?.classList.add('menu-open'); mobileMenu.classList.add('open'); mobileOverlay?.classList.add('open'); document.body.style.overflow = 'hidden'; }
  function closeMenu() { hamburger?.classList.remove('open'); marsPlanet?.classList.remove('menu-open'); mobileMenu.style.transition = 'left 0.38s cubic-bezier(0.4,0,0.2,1)'; mobileMenu.style.left = ''; mobileMenu.classList.remove('open'); mobileOverlay?.classList.remove('open'); document.body.style.overflow = ''; }

  hamburger?.addEventListener('click', () => mobileMenu.classList.contains('open') ? closeMenu() : openMenu());
  mobileOverlay?.addEventListener('click', closeMenu);
  mobileMenu.querySelectorAll('nav a').forEach(a => a.addEventListener('click', closeMenu));
  marsPlanet?.addEventListener('click', () => mobileMenu.classList.contains('open') ? closeMenu() : openMenu());

  // Swipe to close
  let swX = null, swY = null, isSw = false;
  mobileMenu.addEventListener('touchstart', e => { swX = e.touches[0].clientX; swY = e.touches[0].clientY; isSw = false; mobileMenu.style.transition = 'none'; }, { passive: true });
  mobileMenu.addEventListener('touchmove', e => {
    if (swX === null) return;
    const dx = e.touches[0].clientX - swX, dy = e.touches[0].clientY - swY;
    if (!isSw && Math.abs(dy) > Math.abs(dx)) { swX = null; return; }
    isSw = true;
    if (dx < 0) { mobileMenu.style.left = Math.max(dx, -mobileMenu.offsetWidth) + 'px'; if (mobileOverlay) mobileOverlay.style.opacity = (1 + dx / mobileMenu.offsetWidth) * 0.6; }
  }, { passive: true });
  mobileMenu.addEventListener('touchend', e => {
    if (swX === null) return;
    mobileMenu.style.transition = 'left 0.38s cubic-bezier(0.4,0,0.2,1)';
    if (mobileOverlay) { mobileOverlay.style.transition = 'opacity 0.38s ease'; mobileOverlay.style.opacity = ''; }
    if (e.changedTouches[0].clientX - swX < -(mobileMenu.offsetWidth * 0.3)) closeMenu();
    else mobileMenu.style.left = '0';
    swX = null; isSw = false;
  }, { passive: true });
}

// ════════════════════════════════════
// SEARCH OVERLAY
// ════════════════════════════════════
function initSearch() {
  const overlay      = document.getElementById('searchOverlay');
  const closeBtn     = document.getElementById('searchOverlayClose');
  const input        = document.getElementById('searchOverlayInput');
  const results      = document.getElementById('searchResults');
  const notFound     = document.getElementById('searchNotFound');
  const hint         = document.getElementById('searchHint');
  const mobileIcon   = document.getElementById('mobileSearchIcon');
  const drawerInput  = document.getElementById('mobileDrawerSearchInput');
  const drawerBtn    = document.getElementById('mobileDrawerSearchBtn');
  const headerInput  = document.querySelector('.header-right .search-bar input');
  const headerBtn    = document.querySelector('.header-right .search-bar button');
  if (!overlay || !input) return;

  function openSearch() { overlay.style.display = 'flex'; requestAnimationFrame(() => overlay.classList.add('open')); document.body.style.overflow = 'hidden'; setTimeout(() => input.focus(), 80); input.value = ''; showState('hint'); }
  function closeSearch() { overlay.classList.remove('open'); document.body.style.overflow = ''; setTimeout(() => { overlay.style.display = ''; showState('hint'); input.value = ''; }, 280); }
  function showState(s) {
    hint.style.display    = s === 'hint'     ? 'block' : 'none';
    results.style.display = s === 'results'  ? 'flex'  : 'none';
    notFound.style.display= s === 'notfound' ? 'flex'  : 'none';
    const c = document.getElementById('searchCount'); if (c) c.style.display = s === 'results' ? 'block' : 'none';
  }
  function highlight(text, q) { return text.replace(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`, 'gi'), '<span class="search-hl">$1</span>'); }
  function runSearch(raw) {
    const q = raw.trim().toLowerCase(); if (!q) { showState('hint'); return; }
    const hits = libraryBooks.filter(b => b.label === 'Thư Viện Truyện' && (b.title.toLowerCase().includes(q) || b.genre.toLowerCase().includes(q)));
    if (!hits.length) { document.getElementById('searchNfQuery').textContent = `"${raw.trim()}"`; showState('notfound'); return; }
    results.innerHTML = '';
    let c = document.getElementById('searchCount');
    if (!c) { c = document.createElement('div'); c.id = 'searchCount'; c.className = 'search-count'; overlay.insertBefore(c, results); }
    c.textContent = `Tìm thấy ${hits.length} truyện`; c.style.display = 'block';
    hits.forEach(book => {
      const a = document.createElement('a');
      a.className = 'search-result-card'; a.href = book.readUrl;
      a.innerHTML = `<div class="search-result-cover">${book.cover ? `<img src="${book.cover}" alt="${book.title}" onerror="this.style.display='none'">` : `<div class="search-result-ph"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg></div>`}</div><div class="search-result-title">${highlight(book.title, raw.trim())}</div><div class="search-result-meta">${highlight(book.genre, raw.trim())}${book.chapter ? ' · ' + book.chapter : ''}</div>`;
      results.appendChild(a);
    });
    showState('results');
  }

  input.addEventListener('input', e => runSearch(e.target.value));
  input.addEventListener('keydown', e => { if (e.key === 'Enter') runSearch(input.value); });
  document.getElementById('searchOverlayBtn')?.addEventListener('click', () => runSearch(input.value));
  closeBtn?.addEventListener('click', closeSearch);
  mobileIcon?.addEventListener('click', openSearch);
  drawerInput?.addEventListener('click', () => { document.getElementById('mobileMenu')?.classList.remove('open'); openSearch(); });
  drawerBtn?.addEventListener('click',   () => { document.getElementById('mobileMenu')?.classList.remove('open'); openSearch(); });
  headerInput?.addEventListener('focus', openSearch);
  headerBtn?.addEventListener('click',   openSearch);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSearch(); });
}

// ════════════════════════════════════
// BACK TO TOP
// ════════════════════════════════════
function initBTT() {
  const btn = document.getElementById('btt');
  if (!btn) return;
  let t = false;
  window.addEventListener('scroll', () => {
    if (!t) { requestAnimationFrame(() => { btn.classList.toggle('btt-show', window.scrollY > 320); t = false; }); t = true; }
  }, { passive: true });
}

// ════════════════════════════════════
// FOLLOW WIDGET
// ════════════════════════════════════
function initFollow() {
  window.followConnect = function () {
    const btn  = document.getElementById('followBtn');
    const form = document.getElementById('followItForm');
    const note = document.getElementById('followNote');
    if (!btn || !form) return;
    btn.style.display = 'none'; form.style.display = 'flex'; note.style.opacity = '0';
    setTimeout(() => document.getElementById('followEmailInput')?.focus(), 80);
  };
  window.followCancel = function () {
    const btn  = document.getElementById('followBtn');
    const form = document.getElementById('followItForm');
    const note = document.getElementById('followNote');
    if (!btn || !form) return;
    form.style.display = 'none'; btn.style.display = 'flex'; note.style.opacity = '1';
    document.getElementById('followEmailInput').value = '';
  };
  document.getElementById('followItForm')?.addEventListener('submit', () => {
    setTimeout(() => {
      const btn  = document.getElementById('followBtn');
      const form = document.getElementById('followItForm');
      const note = document.getElementById('followNote');
      if (form) form.style.display = 'none';
      if (btn)  { btn.style.display = 'flex'; btn.classList.add('following'); btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6 9 17l-5-5"/></svg><span>Đang Theo Dõi</span>`; btn.onclick = null; }
      if (note) { note.textContent = 'Kiểm tra email để xác nhận đăng ký ✦'; note.style.opacity = '1'; }
    }, 400);
  });
}

// ════════════════════════════════════
// PAUSE TIMERS KHI TAB ẨN
// ════════════════════════════════════
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    clearInterval(bannerTimer); clearInterval(featuredTimer); clearInterval(carouselAutoTimer);
  } else {
    bannerTimer = setInterval(() => window.goToBanner?.(currentBanner + 1), 4500);
    featuredTimer = setInterval(() => window.goToFeatured?.(currentFeatured + 1), 3800);
    const cards = document.getElementById('starryCards');
    carouselAutoTimer = setInterval(() => {
      if (carouselPos >= getMaxPos()) { carouselPos = 0; if (cards) cards.style.transform = 'translateX(0)'; }
      else slideCarousel(1);
    }, 3200);
  }
});

// ════════════════════════════════════
// INIT
// ════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  // Footer year
  const fy = document.getElementById('footerYearPds');
  if (fy) fy.textContent = new Date().getFullYear();

  initMobileMenu();
  initSearch();
  initBTT();
  initFollow();
  initBanner();
  initCarousel();
  initCoverflow();
  initGalaxyCanvas();

  renderFilterBar();
  renderFeatured();

  const isMobile = window.innerWidth <= 768;
  if (isMobile) {
    'requestIdleCallback' in window
      ? requestIdleCallback(() => { renderLibrary(); setTimeout(attachViewTracking, 400); }, { timeout: 2000 })
      : setTimeout(() => { renderLibrary(); setTimeout(attachViewTracking, 400); }, 300);
  } else {
    renderLibrary();
    setTimeout(attachViewTracking, 800);
  }

  // Fetch data từ Blogger
  'requestIdleCallback' in window
    ? requestIdleCallback(loadBloggerBooks, { timeout: 3000 })
    : setTimeout(loadBloggerBooks, 500);
});
