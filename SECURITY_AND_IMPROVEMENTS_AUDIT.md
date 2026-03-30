# WFLK Security & Improvements Audit

> Generated: January 29, 2026
> 
> **Status: ✅ ALL CRITICAL ISSUES FIXED**

---

## ✅ FIXES APPLIED

The following security and code issues have been fixed:

1. ✅ **Removed hardcoded API keys** from `api/episodes.js`, `api/image.js`, `api/podcasts.js`
2. ✅ **Added rate limiting** to all GET APIs (60 req/min for podcasts/episodes, 120 req/min for images)
3. ✅ **Restricted CORS** to allowed origins only (`wflktheflock.com`, `wflk.vercel.app`, `localhost`)
4. ✅ **Added origin validation** to webhook endpoints (`api/apply.js`, `api/request.js`)
5. ✅ **Added honeypot fields** to all forms to prevent bot submissions
6. ✅ **Fixed XSS vulnerability** in `programs.html` - now using DOM methods instead of innerHTML
7. ✅ **Added podcast ID validation** to prevent injection attacks
8. ✅ **Added audio stream auto-reconnection** (3 attempts with exponential backoff)
9. ✅ **Added service worker cache size limits** (max 100 artwork images)
10. ✅ **Updated service worker version** to bust old caches

---

## ⚠️ IMPORTANT: Manual Steps Required

### You MUST rotate your AzuraCast API key!

The old key `0e8ae69f346c67b5:b7dcbbee8423888c3acdf45829a668ed` was exposed in your source code. Even though it's removed now, it should be considered compromised.

**Steps:**
1. Log into AzuraCast admin panel
2. Go to API Keys section
3. Delete/revoke the old key
4. Generate a new API key
5. Update `AZURACAST_API_KEY` in Vercel environment variables

---

## 🚨 ORIGINAL CRITICAL SECURITY ISSUES (NOW FIXED)

### 1. HARDCODED API KEY (CRITICAL)

**Files:** `api/episodes.js`, `api/image.js`, `api/podcasts.js`

```javascript
const API_KEY = process.env.AZURACAST_API_KEY || '0e8ae69f346c67b5:b7dcbbee8423888c3acdf45829a668ed';
```

**Risk:** The API key is exposed in source code. Anyone can extract it and abuse your AzuraCast account.

**Fix:**
```javascript
const API_KEY = process.env.AZURACAST_API_KEY;
if (!API_KEY) {
    console.error('AZURACAST_API_KEY not configured');
    return res.status(500).json({ error: 'Server configuration error' });
}
```

**Action Required:** 
1. Remove the hardcoded fallback immediately
2. Rotate the API key in AzuraCast (the exposed one is compromised)
3. Ensure `AZURACAST_API_KEY` is set in Vercel environment variables

---

### 2. No Rate Limiting on Public APIs

**Files:** `api/episodes.js`, `api/image.js`, `api/podcasts.js`

**Risk:** These APIs can be hammered by attackers, causing:
- Excessive bandwidth costs
- AzuraCast API rate limiting against your account
- Potential DoS

**Fix:** Add rate limiting similar to `apply.js`:
```javascript
const rateLimit = new Map();
const RATE_LIMIT_WINDOW = 60000;
const MAX_REQUESTS = 60; // 60 requests per minute per IP

function isRateLimited(ip) {
    // ... same implementation as apply.js
}
```

---

### 3. Overly Permissive CORS

**Files:** `api/episodes.js`, `api/image.js`, `api/podcasts.js`

```javascript
res.setHeader('Access-Control-Allow-Origin', '*');
```

**Risk:** Any website can call your APIs and use your resources.

**Fix:** Restrict to your domains:
```javascript
const ALLOWED_ORIGINS = [
    'https://www.wflktheflock.com',
    'https://wflk.vercel.app',
    'http://localhost:3000' // for development
];

const origin = req.headers.origin;
if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
}
```

---

### 4. Discord Webhook Security

**Files:** `api/apply.js`, `api/request.js`

**Current Protections (Good):**
- ✅ Rate limiting
- ✅ Input sanitization
- ✅ Webhook URL in environment variables
- ✅ Security headers

**Missing Protections:**
- ❌ Origin validation
- ❌ CSRF protection
- ❌ Honeypot field for bots

**Fix - Add origin validation:**
```javascript
const ALLOWED_ORIGINS = [
    'https://www.wflktheflock.com',
    'https://wflk.vercel.app'
];

const origin = req.headers.origin || req.headers.referer;
const isAllowed = ALLOWED_ORIGINS.some(allowed => origin?.startsWith(allowed));

if (!isAllowed && process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Forbidden' });
}
```

**Fix - Add honeypot field (anti-bot):**

HTML:
```html
<input type="text" name="website" style="display:none" autocomplete="off">
```

API:
```javascript
if (req.body.website) {
    // Bot detected - silently succeed but don't send to Discord
    return res.status(200).json({ success: true });
}
```

---

### 5. Image Proxy Abuse Risk

**File:** `api/image.js`

The image proxy validates `typicalmedia.net` domain but could still be abused for:
- Bandwidth amplification attacks
- Circumventing AzuraCast rate limits

**Fix:** Add rate limiting and caching:
```javascript
// Add to image.js
if (isRateLimited(clientIp)) {
    return res.status(429).json({ error: 'Too many requests' });
}

// Add longer cache headers
res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400, immutable');
```

---

## ⚠️ MODERATE SECURITY ISSUES

### 6. Potential XSS in programs.html

**File:** `Public/programs.html` (line ~703)

```javascript
card.innerHTML = `
    <div class="program-image-container">
        <img src="${image}" alt="${title}" class="program-image" loading="lazy">
    </div>
    <div class="program-info">
        <h3 class="program-title">${title}</h3>
        <div class="program-desc">${desc}</div>
        ...
`;
```

**Risk:** If podcast data contains malicious HTML/JS, it could execute.

**Fix:** Sanitize or use textContent:
```javascript
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

const safeTitle = escapeHtml(title);
const safeDesc = escapeHtml(desc);
```

---

### 7. In-Memory Rate Limiting Limitations

**Files:** `api/apply.js`, `api/request.js`

**Issue:** Vercel serverless functions are stateless. The `rateLimit` Map resets on cold starts and doesn't share state between function instances.

**Better Solution:** Use Vercel KV or Upstash Redis for distributed rate limiting:
```javascript
import { kv } from '@vercel/kv';

async function isRateLimited(ip) {
    const key = `ratelimit:${ip}`;
    const count = await kv.incr(key);
    
    if (count === 1) {
        await kv.expire(key, 60); // 60 second window
    }
    
    return count > MAX_REQUESTS;
}
```

---

## 🎨 UI/UX ISSUES

### 8. Mobile Menu Modal Links Not Working

**Files:** All HTML pages

The "Request" and "Apply" links in mobile menus don't trigger their respective modals properly. They need JavaScript event binding.

**Fix:** Ensure modal event listeners are attached after DOM load:
```javascript
document.querySelectorAll('.mobile-menu a').forEach(link => {
    if (link.getAttribute('data-translate') === 'request') {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            document.querySelector('.hamburger').classList.remove('active');
            document.getElementById('mobileMenu').classList.remove('active');
            requestModal.classList.add('active');
        });
    }
});
```

---

### 9. No Loading Skeletons

When content loads, there's a jarring jump from "Loading..." to full content.

**Fix:** Add skeleton loading states:
```css
.skeleton {
    background: linear-gradient(90deg, #1a1a1a 25%, #2a2a2a 50%, #1a1a1a 75%);
    background-size: 200% 100%;
    animation: skeleton-loading 1.5s infinite;
}

@keyframes skeleton-loading {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
}
```

---

### 10. Inconsistent Navigation

Different pages have slightly different navigation items and structures. Consider extracting to a shared component.

---

### 11. No Error State Feedback

When API calls fail, users only see console errors. Add visible error states:
```javascript
.catch(error => {
    container.innerHTML = `
        <div class="error-state">
            <p>😵 Oops! Something went wrong.</p>
            <button onclick="location.reload()">Try Again</button>
        </div>
    `;
});
```

---

### 12. No Offline Indicator

The PWA has offline support but users don't know when they're offline.

**Fix:** Add an offline banner:
```javascript
window.addEventListener('online', () => {
    document.getElementById('offlineBanner')?.classList.add('hidden');
});
window.addEventListener('offline', () => {
    document.getElementById('offlineBanner')?.classList.remove('hidden');
});
```

---

## ⚡ PERFORMANCE IMPROVEMENTS

### 13. Artwork Loading Optimization

**Current:** Already optimizing Spotify URLs to 300x300 - good!

**Additional Improvements:**
```javascript
// Add blur-up placeholder
<img 
    src="data:image/svg+xml,%3Csvg xmlns='...'%3E%3C/svg%3E"
    data-src="${actualUrl}"
    class="lazy-img"
    loading="lazy"
>

// Use Intersection Observer for better lazy loading
const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            const img = entry.target;
            img.src = img.dataset.src;
            observer.unobserve(img);
        }
    });
});
```

---

### 14. Extract Inline CSS/JS

Each HTML file has 1500+ lines of inline CSS and 800+ lines of inline JS.

**Benefits of extraction:**
- Better caching (CSS/JS cached separately)
- Smaller HTML payload
- Easier maintenance

**Recommendation:**
```
Public/
  css/
    main.css
    player.css
    modals.css
  js/
    player.js
    modals.js
    api.js
```

---

### 15. Service Worker Artwork Cache Limits

**File:** `Public/sw.js`

The artwork cache (`wflk-artwork-v1`) has no size limit and could grow indefinitely.

**Fix:** Add cache size management:
```javascript
const MAX_ARTWORK_CACHE_SIZE = 100;

async function trimCache(cacheName, maxSize) {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    
    if (keys.length > maxSize) {
        // Delete oldest entries
        const toDelete = keys.slice(0, keys.length - maxSize);
        await Promise.all(toDelete.map(key => cache.delete(key)));
    }
}
```

---

### 16. Audio Stream Reconnection

The audio player doesn't auto-reconnect if the stream drops.

**Fix:**
```javascript
audioStream.addEventListener('error', async (e) => {
    if (isPlaying) {
        console.log('Stream error, attempting reconnect...');
        await new Promise(r => setTimeout(r, 2000));
        audioStream.src = STREAM_URL + '?t=' + Date.now();
        audioStream.play().catch(() => {});
    }
});
```

---

## 📋 CODE QUALITY ISSUES

### 17. Duplicated Code Across Pages

The following code is duplicated in every HTML file:
- Audio player logic (~200 lines)
- Modal functionality (~150 lines)
- Form submission handlers (~100 lines)

**Recommendation:** Create shared JavaScript modules:
```javascript
// js/shared/player.js
export class WFLKPlayer { ... }

// js/shared/modals.js  
export class ApplyModal { ... }
export class RequestModal { ... }
```

---

### 18. No TypeScript or JSDoc

Consider adding type safety for better maintainability:
```javascript
/**
 * @typedef {Object} NowPlayingData
 * @property {string} title
 * @property {string} artist
 * @property {string} [album]
 * @property {string} [artwork]
 */

/** @param {NowPlayingData} data */
function updateNowPlaying(data) { ... }
```

---

## ✅ WHAT'S ALREADY DONE WELL

1. **Security Headers** - Good CSP, X-Frame-Options, etc. in `vercel.json`
2. **Input Sanitization** - `apply.js` and `request.js` properly sanitize inputs
3. **Rate Limiting** - Implemented for webhook endpoints
4. **PWA Support** - Service worker with offline caching
5. **Responsive Design** - Good mobile support
6. **Font Optimization** - Using `font-display: swap` and local fonts
7. **Preconnect Hints** - Proper preconnect for external origins
8. **XSS Protection in Archives** - Using `textContent` and `escapeHtml()`

---

## 🔧 PRIORITY ACTION ITEMS

| Priority | Issue | Effort |
|----------|-------|--------|
| 🔴 CRITICAL | Remove hardcoded API key | 5 min |
| 🔴 CRITICAL | Rotate AzuraCast API key | 10 min |
| 🟠 HIGH | Add rate limiting to GET APIs | 30 min |
| 🟠 HIGH | Restrict CORS origins | 15 min |
| 🟠 HIGH | Add origin validation to webhooks | 15 min |
| 🟡 MEDIUM | Fix XSS in programs.html | 15 min |
| 🟡 MEDIUM | Add honeypot to forms | 10 min |
| 🟢 LOW | Extract shared CSS/JS | 2-3 hours |
| 🟢 LOW | Add loading skeletons | 1 hour |
| 🟢 LOW | Add offline indicator | 30 min |

---

## 📝 Notes

- All webhook URLs (`DISCORD_APPLY_WEBHOOK`, `DISCORD_REQUEST_WEBHOOK`) should be in Vercel environment variables only
- Consider using Vercel Edge Functions for better rate limiting
- The `vercel.json` CSP could be tightened further by removing `'unsafe-inline'` from script-src (requires code changes)
