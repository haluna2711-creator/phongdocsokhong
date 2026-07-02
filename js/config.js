// ════════════════════════════════════
// PHÒNG ĐỌC SỐ 0 — Config
// Chỉnh sửa file này khi cần đổi URL
// ════════════════════════════════════

const PDS_CONFIG = {
  // Blogger blog URL — giữ nguyên để fetch truyện
  BLOG_URL: 'https://phongdocsokhong.blogspot.com',

  // Các label cần lấy từ Blogger
  TARGET_LABELS: ['Đam Mỹ', 'Thư Viện Truyện'],

  // Số bài tối đa mỗi label
  MAX_RESULTS: 50,

  // Google Apps Script — Auth gate
  GATE_URL: 'https://script.google.com/macros/s/AKfycbylmqIW7n5SbrSYWN1OnV0SmtGsgigv6dZXHzqxvxkGou-5XcclEvNJDkF64wo7zZGUBw/exec',

  // Google Apps Script — Comment + Reply
  COMMENT_URL: 'https://script.google.com/macros/s/AKfycbx8QZXbiXNmn1daebdRX4TUMpDNLpMaGurY0jPdHHIhW5Kk0U71smu1txx-4NfLpFHYuA/exec',

  // Google Apps Script — Reaction
  REACT_URL: 'https://script.google.com/macros/s/AKfycbx-dADGHLyTi1iInNLb9n4_Xe572wmLmkspo4kucaL8qvLfj3HhQz2nahMiUjuwHN87/exec',

  // Follow.it form action URL
  FOLLOW_URL: 'https://api.follow.it/subscription-form/aTRFdXlTY2JkbGJKQ2J5bHArd1RBaVpLYWx6QnN2UDFyUk9BbktnOHdhMHcwQW45cy9qUEJmdmd5MDJqOEp4YTVYZnlxclExcGI5a3ZmQ21vdWN4MDFtWXZ4OEFPSW4zV1JlZ0VEbFlJRzBaUmF3WEk2R2xYQTN0YS83alpDb3N8bHpVd2VKa1lTbFRCMGgyR2xYWk5zUUhGQW94a2tUSEhMN3o4SHpnNnFVTT0=/8',

  // Logo URL
  LOGO_URL: 'https://phongdocsokhong.wordpress.com/wp-content/uploads/2026/05/logo-ngang.png',

  // Navigation links
  NAV_LINKS: [
    { label: 'Trang Chủ',            href: '/' },
    { label: 'Quỹ Đạo Luân Chuyển', href: '/p/quy-dao-luan-chuyen' },
    { label: 'Tinh Cầu Hội Tụ',     href: '/p/tinh-cau-hoi-tu' },
    { label: 'Thẻ Bạn Đọc',         href: '/p/the-ban-doc' },
  ],

  // Footer links
  FOOTER_LINKS: [
    { label: 'Liên Hệ',  href: '/p/lien-he' },
    { label: 'Quy Định', href: '/p/quy-dinh' },
  ],

  // Genre background gradients
  GENRE_BG: {
    'Trinh thám':   'linear-gradient(145deg,#12082a,#0d0515)',
    'Huyền huyễn':  'linear-gradient(145deg,#1a1220,#0a0a0a)',
    'Cổ đại':       'linear-gradient(145deg,#1a0f0f,#120a0a)',
    'Kinh dị':      'linear-gradient(145deg,#0a0a0a,#1a0a0a)',
    'Hệ thống':     'linear-gradient(145deg,#0a1a0a,#0a120a)',
    'Vô hạn lưu':   'linear-gradient(145deg,#0a0a1a,#0a0a12)',
    'default':      'linear-gradient(145deg,#1a1220,#0a0a0a)',
  },

  // Session / localStorage keys
  SESSION_KEY:     'pds_session_v1',
  SAVED_EMAIL_KEY: 'pds_saved_email_v1',
};
