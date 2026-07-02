// ════════════════════════════════════
// Vercel API Route — Blogger Feed Proxy
// URL: /api/feed?label=Đam Mỹ&max=50
// ════════════════════════════════════

const BLOG_URL = 'https://phongdocsokhong.blogspot.com';

export default async function handler(req, res) {
  // Cho phép CORS từ chính domain Vercel
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');

  const { label, max = 50 } = req.query;

  if (!label) {
    return res.status(400).json({ error: 'Missing label parameter' });
  }

  const feedUrl = `${BLOG_URL}/feeds/posts/default/-/${encodeURIComponent(label)}?alt=json&max-results=${max}&orderby=updated`;

  try {
    const response = await fetch(feedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; PhongDocSo0/1.0)',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: `Blogger returned ${response.status}` });
    }

    const data = await response.json();
    return res.status(200).json(data);

  } catch (err) {
    if (err.name === 'TimeoutError') {
      return res.status(504).json({ error: 'Blogger fetch timeout' });
    }
    return res.status(500).json({ error: err.message });
  }
}
