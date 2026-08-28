// ════════════════════════════════════
// PHÒNG ĐỌC SỐ 0 — Auth Gate
// ════════════════════════════════════

(function () {
  // Bỏ qua gate trên trang /p/ (page tĩnh)
  const isPage = window.location.pathname.startsWith('/p/');
  if (isPage) return;

  // Đã có session → ẩn gate
  if (sessionStorage.getItem(PDS_CONFIG.SESSION_KEY) === '1') {
    const ov = document.getElementById('pdsGate');
    if (ov) ov.style.display = 'none';
    return;
  }

  // Khóa scroll
  document.documentElement.style.overflow = 'hidden';
  document.body.style.overflow = 'hidden';

  const regEmailEl   = document.getElementById('pdsRegEmail');
  const btnReg       = document.getElementById('pdsBtnReg');
  const loginEmailEl = document.getElementById('pdsLoginEmail');
  const codeEl       = document.getElementById('pdsCodeInp');
  const btnLogin     = document.getElementById('pdsBtnLogin');
  if (!regEmailEl) return;

  // Kiểm tra ngay từ đầu xem admin có đang khoá cổng đăng ký MỚI không, để
  // hiện gợi ý sớm cho người dùng. LƯU Ý: không disable input/nút — người
  // ĐÃ đăng ký từ trước vẫn phải gõ được email và bấm "Nhận Mã Truy Cập" để
  // server trả về "already_registered" rồi tự chuyển sang bước đăng nhập.
  // Việc khoá chỉ áp dụng cho email HOÀN TOÀN MỚI, do server (api/auth-register.js)
  // quyết định — ở đây chỉ hiện thông báo mang tính hướng dẫn.
  fetch('/api/auth-register?action=gate-status')
    .then(r => r.json())
    .then(d => {
      if (d && d.ok && d.open === false) {
        const errEl = document.getElementById('pdsErr');
        if (errEl) {
          errEl.className = 'pds-err-msg info';
          errEl.textContent = 'Đăng ký mới hiện đang tạm khoá. Nếu bạn đã có mã, bấm "Đăng nhập" bên dưới.';
        }
      }
    })
    .catch(() => {});

  regEmailEl.addEventListener('input', () => {
    btnReg.disabled = regEmailEl.value.trim().indexOf('@') < 1;
  });

  function checkLogin() {
    btnLogin.disabled = !(loginEmailEl.value.trim().indexOf('@') > 0 && codeEl.value.trim().length > 0);
  }
  loginEmailEl.addEventListener('input', checkLogin);
  codeEl.addEventListener('input', () => { codeEl.value = codeEl.value.toUpperCase(); checkLogin(); });

  // Nếu đã lưu email → nhảy thẳng bước 2
  const saved = localStorage.getItem(PDS_CONFIG.SAVED_EMAIL_KEY);
  if (saved) {
    loginEmailEl.value = saved;
    document.getElementById('pdsStep1').style.display = 'none';
    document.getElementById('pdsStep2').style.display = 'block';
    document.getElementById('pdsSub').textContent = 'Nhập email và mã truy cập của bạn.';
    checkLogin();
  }

  // Không cần "ping wakeup" Apps Script nữa — auth gate giờ gọi thẳng
  // /api/auth-register (Vercel function, khởi động nhanh hơn nhiều so với
  // cold-start của Google Apps Script trước đây).

  // ── BƯỚC 1: Nhận mã ──
  window.pdsRegister = function () {
    const email = regEmailEl.value.trim();
    const errEl = document.getElementById('pdsErr');
    errEl.className = 'pds-err-msg'; errEl.textContent = '';
    regEmailEl.classList.remove('err');
    if (!email || email.indexOf('@') < 1) {
      errEl.textContent = 'Vui lòng nhập email hợp lệ.';
      regEmailEl.classList.add('err'); regEmailEl.focus(); return;
    }
    setLoading('reg', true);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    fetch('/api/auth-register?action=register&email=' + encodeURIComponent(email), { signal: ctrl.signal })
      .then(r => { clearTimeout(timer); return r.json(); })
      .then(d => {
        setLoading('reg', false);
        if (d.ok) {
          localStorage.setItem(PDS_CONFIG.SAVED_EMAIL_KEY, email.toLowerCase());
          errEl.className = 'pds-err-msg ok';
          errEl.textContent = 'Đã gửi mã! Kiểm tra hộp thư (kể cả Thư Rác).';
          setTimeout(() => goToStep2(email, 'Nhập email và mã vừa được gửi để bước vào.'), 1400);
        } else if (d.reason === 'already_registered') {
          localStorage.setItem(PDS_CONFIG.SAVED_EMAIL_KEY, email.toLowerCase());
          errEl.className = 'pds-err-msg info';
          errEl.textContent = 'Email này đã được cấp mã trước đó. Vui lòng kiểm tra hộp thư cũ.';
          setTimeout(() => goToStep2(email, 'Nhập mã đã được cấp trước đó để bước vào.'), 2200);
        } else if (d.reason === 'account_disabled') {
          errEl.textContent = 'Tài khoản này đã bị khoá.';
          regEmailEl.classList.add('err');
        } else if (d.reason === 'registration_closed') {
          errEl.className = 'pds-err-msg info';
          errEl.textContent = 'Email này chưa từng đăng ký và đăng ký mới hiện đang tạm khoá. Nếu bạn đã có mã, bấm "Đăng nhập" bên dưới.';
        } else if (d.reason === 'disposable_email') {
          errEl.textContent = 'Vui lòng dùng email chính chủ, không dùng email tạm thời/dùng 1 lần.';
          regEmailEl.classList.add('err');
        } else if (d.reason === 'domain_not_found') {
          errEl.textContent = 'Không tìm thấy tên miền email này. Vui lòng kiểm tra lại chính tả.';
          regEmailEl.classList.add('err');
        } else if (d.reason === 'rate_limited_email') {
          errEl.textContent = 'Email này vừa được gửi mã gần đây. Vui lòng kiểm tra hộp thư (kể cả Thư Rác) hoặc thử lại sau.';
        } else if (d.reason === 'rate_limited_ip') {
          errEl.textContent = 'Bạn đã yêu cầu quá nhiều lần. Vui lòng thử lại sau ít phút.';
        } else {
          errEl.textContent = 'Có lỗi xảy ra. Vui lòng thử lại.';
          regEmailEl.classList.add('err');
        }
      })
      .catch(err => {
        clearTimeout(timer); setLoading('reg', false);
        document.getElementById('pdsErr').textContent = err.name === 'AbortError'
          ? 'Yêu cầu quá thời gian. Vui lòng thử lại.'
          : 'Không kết nối được. Kiểm tra mạng và thử lại.';
      });
  };

  // ── BƯỚC 2: Đăng nhập ──
  window.pdsLogin = function () {
    const email = loginEmailEl.value.trim();
    const code  = codeEl.value.trim().toUpperCase();
    const errEl = document.getElementById('pdsErr2');
    errEl.className = 'pds-err-msg'; errEl.textContent = '';
    loginEmailEl.classList.remove('err'); codeEl.classList.remove('err');
    if (!email || email.indexOf('@') < 1) { errEl.textContent = 'Vui lòng nhập email hợp lệ.'; loginEmailEl.classList.add('err'); loginEmailEl.focus(); return; }
    if (!code) { errEl.textContent = 'Vui lòng nhập mã truy cập.'; codeEl.classList.add('err'); codeEl.focus(); return; }
    setLoading('login', true);
    const ctrl2 = new AbortController();
    const timer2 = setTimeout(() => ctrl2.abort(), 10000);
    fetch('/api/auth-register?action=verify&email=' + encodeURIComponent(email) + '&code=' + encodeURIComponent(code), { signal: ctrl2.signal })
      .then(r => { clearTimeout(timer2); return r.json(); })
      .then(d => {
        setLoading('login', false);
        if (d.ok) {
          localStorage.setItem(PDS_CONFIG.SAVED_EMAIL_KEY, email.toLowerCase());
          sessionStorage.setItem(PDS_CONFIG.SESSION_KEY, '1');
          const gate = document.getElementById('pdsGate');
          if (gate) { gate.classList.add('unlocking'); setTimeout(() => gate.style.display = 'none', 560); }
          document.documentElement.style.overflow = '';
          document.body.style.overflow = '';
        } else if (d.reason === 'wrong_code' || d.reason === 'invalid_code') {
          errEl.textContent = 'Mã không đúng. Vui lòng kiểm tra lại.';
          codeEl.classList.add('err'); shake();
        } else if (d.reason === 'email_not_found') {
          errEl.textContent = 'Email chưa đăng ký. Vui lòng quay lại bước 1.';
          loginEmailEl.classList.add('err');
        } else if (d.reason === 'account_disabled') {
          errEl.textContent = 'Tài khoản này đã bị khoá.';
        } else {
          errEl.textContent = 'Có lỗi xảy ra. Vui lòng thử lại.'; shake();
        }
      })
      .catch(err => {
        clearTimeout(timer2); setLoading('login', false);
        document.getElementById('pdsErr2').textContent = err.name === 'AbortError'
          ? 'Yêu cầu quá thời gian. Vui lòng thử lại.'
          : 'Không kết nối được. Kiểm tra mạng và thử lại.';
      });
  };

  function goToStep2(email, subtitle) {
    document.getElementById('pdsStep1').style.display = 'none';
    document.getElementById('pdsStep2').style.display = 'block';
    document.getElementById('pdsSub').textContent = subtitle;
    document.getElementById('pdsErr2').textContent = '';
    loginEmailEl.value = email.toLowerCase();
    checkLogin(); codeEl.focus();
  }

  function shake() {
    const box = document.getElementById('pdsBox');
    if (!box) return;
    box.classList.add('pds-shake');
    setTimeout(() => box.classList.remove('pds-shake'), 500);
  }

  function setLoading(which, on) {
    if (which === 'reg') {
      document.getElementById('pdsSpinReg').style.display  = on ? 'block' : 'none';
      document.getElementById('pdsIconReg').style.display  = on ? 'none' : '';
      document.getElementById('pdsTxtReg').textContent     = on ? 'Đang gửi...' : 'Nhận Mã Truy Cập';
      document.getElementById('pdsBtnReg').disabled        = on;
    } else {
      document.getElementById('pdsSpinLogin').style.display = on ? 'block' : 'none';
      document.getElementById('pdsIconLogin').style.display = on ? 'none' : '';
      document.getElementById('pdsTxtLogin').textContent    = on ? 'Đang xác thực...' : 'Bước Vào';
      document.getElementById('pdsBtnLogin').disabled       = on;
    }
  }

  window.pdsBackToReg = function () {
    document.getElementById('pdsStep2').style.display = 'none';
    document.getElementById('pdsStep1').style.display = 'block';
    document.getElementById('pdsSub').textContent = 'Không gian này chỉ dành cho lữ khách được mời. Nhập email để nhận mã truy cập.';
    document.getElementById('pdsErr').textContent = '';
    localStorage.removeItem(PDS_CONFIG.SAVED_EMAIL_KEY);
    regEmailEl.value = ''; regEmailEl.focus();
  };

  // Cho người ĐÃ có mã truy cập đi thẳng vào bước đăng nhập, không phải phụ
  // thuộc vào việc bấm "Nhận Mã Truy Cập" rồi chờ server trả về
  // "already_registered". Quan trọng khi cổng đăng ký MỚI đang bị khoá —
  // người đã có mã vẫn phải luôn vào được, bất kể trạng thái khoá/mở.
  window.pdsGoLogin = function () {
    const prefill = regEmailEl.value.trim();
    goToStep2(prefill, 'Nhập email và mã truy cập của bạn.');
  };

  // Enter để submit
  document.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    const gate = document.getElementById('pdsGate');
    if (!gate || gate.style.display === 'none') return;
    const s2 = document.getElementById('pdsStep2');
    if (s2 && s2.style.display === 'block' && !btnLogin.disabled) window.pdsLogin();
    else if (!btnReg.disabled) window.pdsRegister();
  });
})();
