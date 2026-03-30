const CACHE_NAME = 'wflk-radio-v15';
const ARTWORK_CACHE = 'wflk-artwork-v6';
const MAX_ARTWORK_CACHE_SIZE = 100; // Limit artwork cache to 100 images

const urlsToCache = [
    '/',
    '/index.html',
    '/about',
    '/about.html',
    '/blog',
    '/blog.html',
    '/archives',
    '/archives.html',
    '/programs',
    '/programs.html',
    '/talk-to-tina',
    '/talk-to-tina.html',
    '/beyond-the-veil',
    '/beyond-the-veil.html',
    '/Resources/logo/WFLK_The_Squawk_1767560808.webp',
    '/fonts/bebas-neue.woff2',
    '/fonts/righteous.woff2',
    '/fonts/special-elite.woff2',
    '/fonts/crimson-text-regular.woff2',
    '/fonts/crimson-text-italic.woff2',
    '/fonts/crimson-text-semibold.woff2'
];

// Trim cache to prevent unbounded growth
async function trimCache(cacheName, maxSize) {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    
    if (keys.length > maxSize) {
        // Delete oldest entries (first in cache)
        const toDelete = keys.slice(0, keys.length - maxSize);
        await Promise.all(toDelete.map(key => cache.delete(key)));
        console.log(`Trimmed ${toDelete.length} items from ${cacheName}`);
    }
}

// Install event - cache assets
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('Opened cache');
                return cache.addAll(urlsToCache);
            })
            .catch(err => {
                console.log('Cache install error:', err);
            })
    );
    self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
    const cacheWhitelist = [CACHE_NAME, ARTWORK_CACHE];
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (!cacheWhitelist.includes(cacheName)) {
                        console.log('Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
    self.clients.claim();
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', event => {
    // Skip non-GET requests
    if (event.request.method !== 'GET') return;
    
    // Don't cache API calls or streaming content
    if (event.request.url.includes('/api/nowplaying') || 
        event.request.url.includes('.mp3') ||
        event.request.url.includes('/listen/') ||
        event.request.url.includes('stream')) {
        return;
    }

    // Special handling for artwork images - cache them with size limits
    if (event.request.url.includes('/uploads/') || 
        event.request.url.includes('/art') ||
        event.request.url.includes('/api/image') ||
        event.request.destination === 'image') {
        event.respondWith(
            caches.open(ARTWORK_CACHE).then(async cache => {
                const cachedResponse = await cache.match(event.request);
                if (cachedResponse) {
                    // Return cached artwork immediately
                    return cachedResponse;
                }
                
                // Fetch and cache artwork
                try {
                    const networkResponse = await fetch(event.request);
                    if (networkResponse && networkResponse.status === 200) {
                        cache.put(event.request, networkResponse.clone());
                        // Trim cache in background to prevent unbounded growth
                        trimCache(ARTWORK_CACHE, MAX_ARTWORK_CACHE_SIZE);
                    }
                    return networkResponse;
                } catch (error) {
                    // Return fallback logo if artwork fails
                    return caches.match('/Resources/logo/WFLK_The_Squawk_1767560808.webp');
                }
            })
        );
        return;
    }

    event.respondWith(
        caches.match(event.request)
            .then(response => {
                // Return cached version or fetch from network
                if (response) {
                    return response;
                }

                return fetch(event.request).then(response => {
                    // Don't cache non-successful responses
                    if (!response || response.status !== 200 || response.type !== 'basic') {
                        return response;
                    }

                    // Clone the response
                    const responseToCache = response.clone();

                    caches.open(CACHE_NAME)
                        .then(cache => {
                            cache.put(event.request, responseToCache);
                        });

                    return response;
                });
            })
            .catch(() => {
                // Offline fallback
                return caches.match('/index.html');
            })
    );
});
