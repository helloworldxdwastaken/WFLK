// Simple in-memory rate limiting (resets on cold start)
const rateLimit = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const MAX_REQUESTS = 3; // Max 3 reports per minute per IP

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

function sanitizeInput(str, maxLength = 500) {
    if (!str || typeof str !== 'string') return '';
    return str
        .trim()
        .substring(0, maxLength)
        .replace(/[<>]/g, '')
        .replace(/[\x00-\x1F\x7F]/g, '');
}

const ALLOWED_ORIGINS = [
    'https://www.wflktheflock.com',
    'https://wflktheflock.com',
    'https://wflk.vercel.app',
    'http://localhost:3000'
];

export default async function handler(req, res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');

    const origin = req.headers.origin || '';
    const referer = req.headers.referer || '';
    const isAllowedOrigin = ALLOWED_ORIGINS.some(allowed =>
        origin.startsWith(allowed) || referer.startsWith(allowed)
    );

    // Set CORS only for allowed origins
    if (isAllowedOrigin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    if (!isAllowedOrigin && process.env.NODE_ENV === 'production') {
        return res.status(403).json({ error: 'Forbidden' });
    }

    const clientIp = req.headers['x-forwarded-for']?.split(',')[0] ||
                     req.headers['x-real-ip'] ||
                     'unknown';

    if (isRateLimited(clientIp)) {
        return res.status(429).json({ error: 'Too many reports. Please wait a minute.' });
    }

    const webhookUrl = process.env.DISCORD_VEIL_WEBHOOK;

    if (!webhookUrl) {
        console.error('DISCORD_VEIL_WEBHOOK environment variable not set');
        return res.status(500).json({ error: 'Server configuration error' });
    }

    try {
        const { name, pronouns, location, report, when, shareOnAir, website } = req.body;

        // Honeypot check
        if (website) {
            return res.status(200).json({ success: true });
        }

        // Report is required
        if (!report) {
            return res.status(400).json({ error: 'Please include a report' });
        }

        const sanitizedName = sanitizeInput(name, 100) || 'Anonymous Reporter';
        const sanitizedLocation = sanitizeInput(location, 200);
        const sanitizedReport = sanitizeInput(report, 3000);
        const sanitizedWhen = sanitizeInput(when, 200);

        // Whitelist pronouns - only allow known values
        const allowedPronouns = ['he/him', 'she/her', 'they/them', 'other'];
        const sanitizedPronouns = allowedPronouns.includes(pronouns) ? pronouns : '';

        // Whitelist shareOnAir - only allow known values
        const allowedShareOnAir = ['yes', 'no'];
        const sanitizedShareOnAir = allowedShareOnAir.includes(shareOnAir) ? shareOnAir : '';

        // Build the Discord embed
        const fromValue = sanitizedPronouns
            ? `${sanitizedName} (${sanitizedPronouns})`
            : sanitizedName;

        const fields = [
            { name: '\ud83d\udc64 Reported By', value: fromValue, inline: true }
        ];

        if (sanitizedLocation) {
            fields.push({ name: '\ud83d\udccd Location', value: sanitizedLocation, inline: true });
        }

        if (sanitizedWhen) {
            fields.push({ name: '\ud83d\udd50 When', value: sanitizedWhen, inline: true });
        }

        fields.push({ name: '\ud83d\udcdd Report', value: sanitizedReport });

        const shareDisplay = sanitizedShareOnAir === 'yes' ? 'Yes'
            : sanitizedShareOnAir === 'no' ? 'No'
            : 'No preference';
        fields.push({ name: '\ud83c\udf99\ufe0f Share On Air?', value: shareDisplay, inline: true });

        const embed = {
            title: 'Beyond the Veil - New Report!',
            color: 0x7B2FF7,
            fields: fields,
            timestamp: new Date().toISOString(),
            footer: {
                text: 'WFLK The Flock - Beyond the Veil'
            }
        };

        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: 'WFLK Beyond the Veil',
                avatar_url: 'https://wflk.vercel.app/Resources/logo/WFLK_The_Squawk_1767560808.webp',
                embeds: [embed]
            })
        });

        if (!response.ok) {
            throw new Error('Failed to deliver report');
        }

        return res.status(200).json({ success: true });
    } catch (error) {
        console.error('Veil webhook error:', error);
        return res.status(500).json({ error: 'Failed to send report' });
    }
}
