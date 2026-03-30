// Simple in-memory rate limiting (resets on cold start)
const rateLimit = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const MAX_REQUESTS = 3; // Max 3 applications per minute per IP

function isRateLimited(ip) {
    const now = Date.now();
    const windowStart = now - RATE_LIMIT_WINDOW;
    
    if (!rateLimit.has(ip)) {
        rateLimit.set(ip, []);
    }
    
    // Clean old entries
    const requests = rateLimit.get(ip).filter(time => time > windowStart);
    rateLimit.set(ip, requests);
    
    if (requests.length >= MAX_REQUESTS) {
        return true;
    }
    
    requests.push(now);
    return false;
}

// Sanitize input to prevent injection attacks
function sanitizeInput(str, maxLength = 1024) {
    if (!str || typeof str !== 'string') return '';
    return str
        .trim()
        .substring(0, maxLength)
        .replace(/[<>]/g, '') // Remove HTML brackets
        .replace(/[\x00-\x1F\x7F]/g, ''); // Remove control characters
}

// Allowed origins for CORS and origin validation
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
    
    // Only allow POST requests
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Origin validation - prevent cross-site abuse
    const origin = req.headers.origin || '';
    const referer = req.headers.referer || '';
    const isAllowedOrigin = ALLOWED_ORIGINS.some(allowed => 
        origin.startsWith(allowed) || referer.startsWith(allowed)
    );
    
    if (!isAllowedOrigin && process.env.NODE_ENV === 'production') {
        return res.status(403).json({ error: 'Forbidden' });
    }

    // Rate limiting
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0] || 
                     req.headers['x-real-ip'] || 
                     'unknown';
    
    if (isRateLimited(clientIp)) {
        return res.status(429).json({ error: 'Too many requests. Please wait a minute.' });
    }

    // Get webhook URL from environment variable
    const webhookUrl = process.env.DISCORD_APPLY_WEBHOOK;
    
    if (!webhookUrl) {
        console.error('DISCORD_APPLY_WEBHOOK environment variable not set');
        return res.status(500).json({ error: 'Server configuration error' });
    }

    try {
        const { name, discord, position, experience, why, website } = req.body;

        // Honeypot check - if 'website' field is filled, it's likely a bot
        if (website) {
            // Silently succeed but don't actually send to Discord
            return res.status(200).json({ success: true });
        }

        // Validate required fields
        if (!name || !discord || !position || !experience || !why) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Sanitize all inputs
        const sanitizedData = {
            name: sanitizeInput(name, 100),
            discord: sanitizeInput(discord, 100),
            position: sanitizeInput(position, 100),
            experience: sanitizeInput(experience, 1024),
            why: sanitizeInput(why, 1024)
        };

        // Validate sanitized data isn't empty
        if (!sanitizedData.name || !sanitizedData.discord || !sanitizedData.position) {
            return res.status(400).json({ error: 'Invalid input data' });
        }

        // Create Discord embed
        const embed = {
            title: '📋 New Application Received!',
            color: 0xFF6B35,
            fields: [
                { name: '👤 Name', value: sanitizedData.name, inline: true },
                { name: '💬 Discord', value: sanitizedData.discord, inline: true },
                { name: '🎯 Position', value: sanitizedData.position, inline: true },
                { name: '📝 Experience', value: sanitizedData.experience || 'Not provided' },
                { name: '❓ Why Join', value: sanitizedData.why || 'Not provided' }
            ],
            timestamp: new Date().toISOString(),
            footer: {
                text: 'WFLK The Flock - Application System'
            }
        };

        // Send to Discord
        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: 'WFLK Applications',
                avatar_url: 'https://wflk.vercel.app/Resources/logo/WFLK_The_Squawk_1767560808.webp',
                embeds: [embed]
            })
        });

        if (!response.ok) {
            throw new Error(`Discord API error: ${response.status}`);
        }

        return res.status(200).json({ success: true });
    } catch (error) {
        console.error('Apply webhook error:', error);
        return res.status(500).json({ error: 'Failed to submit application' });
    }
}
