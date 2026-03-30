// Rate limiting
const rateLimit = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const MAX_REQUESTS = 60; // 60 requests per minute per IP

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
    
    // Handle OPTIONS request for CORS
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

    const API_KEY = process.env.AZURACAST_API_KEY;
    if (!API_KEY) {
        console.error('AZURACAST_API_KEY environment variable not set');
        return res.status(500).json({ error: 'Server configuration error' });
    }

    const STATION_ID = '189';
    const API_URL = `https://azura.typicalmedia.net/api/station/${STATION_ID}/podcasts`;

    try {
        const response = await fetch(API_URL, {
            headers: {
                'X-API-Key': API_KEY,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`Azuracast API error: ${response.status}`);
        }

        const data = await response.json();
        
        // Cache for 5 minutes
        res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
        
        return res.status(200).json(data);
    } catch (error) {
        console.error('Podcast API error:', error);
        return res.status(500).json({ error: 'Failed to fetch podcasts' });
    }
}
