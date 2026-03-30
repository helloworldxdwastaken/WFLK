// Simple in-memory rate limiting (resets on cold start)
const rateLimit = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const MAX_REQUESTS = 3; // Max 3 messages per minute per IP

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
        return res.status(429).json({ error: 'Too many messages. Please wait a minute.' });
    }

    const webhookUrl = process.env.DISCORD_TINA_WEBHOOK;

    if (!webhookUrl) {
        console.error('DISCORD_TINA_WEBHOOK environment variable not set');
        return res.status(500).json({ error: 'Server configuration error' });
    }

    try {
        const { name, pronouns, message, audioBase64, website } = req.body;

        // Honeypot check
        if (website) {
            return res.status(200).json({ success: true });
        }

        // Must have either a text message or audio
        if (!message && !audioBase64) {
            return res.status(400).json({ error: 'Please include a message or voice recording' });
        }

        const sanitizedName = sanitizeInput(name, 100) || 'Anonymous Listener';
        const sanitizedMessage = sanitizeInput(message, 2000);

        // Whitelist pronouns - only allow known values
        const allowedPronouns = ['he/him', 'she/her', 'they/them', 'other'];
        const sanitizedPronouns = allowedPronouns.includes(pronouns) ? pronouns : '';

        // Build the Discord embed
        const fromValue = sanitizedPronouns
            ? `${sanitizedName} (${sanitizedPronouns})`
            : sanitizedName;

        const fields = [
            { name: '\ud83d\udc64 From', value: fromValue, inline: true },
            { name: '\ud83d\udce8 Type', value: audioBase64 ? '\ud83c\udf99\ufe0f Voice Message' : '\ud83d\udcdd Text Message', inline: true }
        ];

        if (sanitizedMessage) {
            fields.push({ name: '\ud83d\udcac Message', value: sanitizedMessage });
        }

        const embed = {
            title: '\ud83d\udcde Talk to Tina - New Message!',
            color: 0xE71D36,
            fields: fields,
            timestamp: new Date().toISOString(),
            footer: {
                text: 'WFLK The Flock - Talk to Tina'
            }
        };

        // If there's audio, send as multipart with file attachment
        if (audioBase64) {
            // Validate base64 format and size
            if (typeof audioBase64 !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(audioBase64)) {
                return res.status(400).json({ error: 'Invalid audio data' });
            }

            if (audioBase64.length > 4000000) {
                return res.status(400).json({ error: 'Recording too long. Please keep it under 60 seconds.' });
            }

            const audioBuffer = Buffer.from(audioBase64, 'base64');

            // Verify decoded buffer isn't empty or suspiciously small
            if (audioBuffer.length < 100) {
                return res.status(400).json({ error: 'Invalid audio recording' });
            }
            const boundary = '----WebKitFormBoundary' + Date.now().toString(36);

            const payloadJson = JSON.stringify({
                username: 'WFLK Talk to Tina',
                avatar_url: 'https://wflk.vercel.app/Resources/logo/WFLK_The_Squawk_1767560808.webp',
                embeds: [embed]
            });

            const parts = [];
            // JSON payload part
            parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="payload_json"\r\nContent-Type: application/json\r\n\r\n${payloadJson}\r\n`);
            // Audio file part
            parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="files[0]"; filename="voice-message.webm"\r\nContent-Type: audio/webm\r\n\r\n`);

            const bodyParts = [
                Buffer.from(parts[0], 'utf-8'),
                Buffer.from(parts[1], 'utf-8'),
                audioBuffer,
                Buffer.from(`\r\n--${boundary}--\r\n`, 'utf-8')
            ];

            const body = Buffer.concat(bodyParts);

            const response = await fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
                body: body
            });

            if (!response.ok) {
                throw new Error('Failed to deliver message');
            }
        } else {
            // Text-only message
            const response = await fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: 'WFLK Talk to Tina',
                    avatar_url: 'https://wflk.vercel.app/Resources/logo/WFLK_The_Squawk_1767560808.webp',
                    embeds: [embed]
                })
            });

            if (!response.ok) {
                throw new Error('Failed to deliver message');
            }
        }

        return res.status(200).json({ success: true });
    } catch (error) {
        console.error('Tina webhook error:', error);
        return res.status(500).json({ error: 'Failed to send message' });
    }
}
