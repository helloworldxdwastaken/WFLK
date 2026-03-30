// Rate limiting
const rateLimit = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const MAX_REQUESTS = 120; // 120 requests per minute per IP (higher for images)

function isRateLimited(ip) {
    const now = Date.now();
    const windowStart = now - RATE_LIMIT_WINDOW;
    
    if (!rateLimit.has(ip)) {
        rateLimit.set(ip, []);
    }
    
    const requests = rateLimit.get(ip).filter(time => time > windowStart);
    rateLimit.set(ip, requests);
    
    if (requests.length >= MAX_REQUESTS) {
        return true;
    }
    
    requests.push(now);
    return false;
}

// Allowed origins
const ALLOWED_ORIGINS = [
    'https://www.wflktheflock.com',
    'https://wflktheflock.com',
    'https://wflk.vercel.app',
    'http://localhost:3000'
];

export default async function handler(req, res) {
    // Set security headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');

    // CORS - only allow specific origins
    const origin = req.headers.origin;
    if (ALLOWED_ORIGINS.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');

    // Handle OPTIONS request
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Rate limiting
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0] || 
                     req.headers['x-real-ip'] || 
                     'unknown';
    
    if (isRateLimited(clientIp)) {
        return res.status(429).json({ error: 'Too many requests. Please wait.' });
    }

    const { url } = req.query;

    if (!url) {
        return res.status(400).json({ error: 'Image URL is required' });
    }

    // Validate URL is from allowed domain
    try {
        const parsedUrl = new URL(url);
        if (!parsedUrl.hostname.endsWith('typicalmedia.net')) {
            return res.status(403).json({ error: 'Invalid image host' });
        }
    } catch (e) {
        return res.status(400).json({ error: 'Invalid URL' });
    }

    const API_KEY = process.env.AZURACAST_API_KEY;
    if (!API_KEY) {
        console.error('AZURACAST_API_KEY environment variable not set');
        return res.status(500).json({ error: 'Server configuration error' });
    }

    try {
        const response = await fetch(url, {
            headers: {
                'X-API-Key': API_KEY
            }
        });

        if (!response.ok) {
            throw new Error(`Image fetch error: ${response.status}`);
        }

        // Forward content type
        const contentType = response.headers.get('content-type');
        if (contentType) {
            res.setHeader('Content-Type', contentType);
        }

        // Cache for 1 hour
        res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600');

        const arrayBuffer = await response.arrayBuffer();
        return res.send(Buffer.from(arrayBuffer));
    } catch (error) {
        console.error('Proxy image error:', error);
        return res.status(500).json({ error: 'Failed to fetch image' });
    }
}
