export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.REVALIDATE_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { url, title, action } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'Missing url' });
  }

  await fetch(
    `https://asta.noxamusic.com/api/web/webhook/${process.env.ASTA_WEBHOOK_TOKEN}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, title, action: action || 'published' }),
    }
  );

  return res.status(200).json({ ok: true });
}
