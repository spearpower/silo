/* PicknPlay service worker (Next.js build).
 * - Cache-first for hashed build files (/_next/static) and the card/avatar/icon art.
 * - Never caches pages or /api: they carry the signed-in player and live game state.
 * - Navigations fall back to /offline.html when the network is down.
 * Bump VERSION when the precached files change.
 */
const VERSION = 'picknplay-v1.1.0';
const STATIC_CACHE = VERSION + '-static';

// Card back and Jokers up front; the 52 face cards are cached the first time they are shown (cache-first below).
const CARDS = ['/cards/back.svg', '/cards/XR.svg', '/cards/XB.svg'];

const SOUNDS = ['turn', 'chat', 'deal', 'play', 'draw', 'shuffle', 'penalty', 'hit', 'cancel', 'suit', 'skip', 'reverse', 'cut', 'lastcard', 'win', 'lose', 'tick', 'error'].map(n => '/sounds/' + n + '.wav');
const PRECACHE = ['/offline.html', '/manifest.webmanifest', '/icons/icon.svg', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png'].concat(SOUNDS, CARDS);

self.addEventListener('install', event => {
	event.waitUntil(caches.open(STATIC_CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
	event.waitUntil(
		caches.keys()
			.then(keys => Promise.all(keys.filter(k => k.startsWith('picknplay-') && k !== STATIC_CACHE).map(k => caches.delete(k))))
			.then(() => self.clients.claim())
	);
});

const isStatic = url => url.pathname.startsWith('/_next/static/') || /^\/(cards|avatars|icons|sounds)\//.test(url.pathname) || url.pathname === '/manifest.webmanifest';

self.addEventListener('fetch', event => {
	const req = event.request;
	if (req.method !== 'GET') return;
	const url = new URL(req.url);
	if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

	if (req.mode === 'navigate') {
		event.respondWith(fetch(req).catch(() => caches.match('/offline.html')));
		return;
	}
	if (isStatic(url)) {
		event.respondWith(
			caches.open(STATIC_CACHE).then(cache =>
				cache.match(req).then(hit => hit || fetch(req).then(res => {
					if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
					return res;
				}))
			)
		);
	}
});

// ---------- Phone alerts (Web Push) ----------
self.addEventListener('push', event => {
	let d = {};
	try { d = event.data ? event.data.json() : {}; } catch (e) { d = { title: 'PicknPlay', body: event.data ? event.data.text() : '' }; }
	const title = d.title || 'PicknPlay';
	event.waitUntil(self.registration.showNotification(title, {
		body: d.body || '',
		icon: '/icons/icon-192.png',
		badge: '/icons/icon-192.png',
		tag: d.tag || undefined,
		renotify: !!d.tag,
		vibrate: [90, 60, 90],
		data: { url: d.url || '/' },
	}));
});

self.addEventListener('notificationclick', event => {
	event.notification.close();
	const url = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
	event.waitUntil((async () => {
		const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
		for (const w of wins) {
			if (new URL(w.url).origin === self.location.origin) {
				await w.focus();
				if ('navigate' in w) { try { await w.navigate(url); } catch (e) { /* cross-scope */ } }
				return;
			}
		}
		await self.clients.openWindow(url);
	})());
});
