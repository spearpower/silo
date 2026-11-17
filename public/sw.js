/* Silo service worker.
 * - Cache-first for hashed build files (/_next/static) and app icons.
 * - Never caches pages, /api or Supabase traffic: they carry private, live data.
 * - Navigations fall back to /offline.html without a network.
 * - Web Push: shows message / call alerts; tapping opens the right chat.
 * Bump VERSION when the precached files change.
 */
const VERSION = 'silo-v1.0.0';
const STATIC_CACHE = VERSION + '-static';
const PRECACHE = ['/offline.html', '/manifest.webmanifest', '/icons/icon.svg', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png'];

self.addEventListener('install', event => {
	event.waitUntil(caches.open(STATIC_CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
	event.waitUntil(
		caches.keys()
			.then(keys => Promise.all(keys.filter(k => k !== STATIC_CACHE).map(k => caches.delete(k))))
			.then(() => self.clients.claim())
	);
});

const isStatic = url => url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/') || url.pathname === '/manifest.webmanifest';

self.addEventListener('fetch', event => {
	const req = event.request;
	if (req.method !== 'GET') return;
	const url = new URL(req.url);
	if (url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) return;
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

// ---------- Web Push ----------
self.addEventListener('push', event => {
	let d = {};
	try { d = event.data ? event.data.json() : {}; } catch (e) { d = { title: 'Silo', body: '' }; }
	const isCall = d.kind === 'call';
	event.waitUntil((async () => {
		// The app shows its own banner and sound when it's open and focused: skip duplicate message alerts then.
		if (d.kind === 'message') {
			const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
			if (wins.some(w => w.focused && w.visibilityState === 'visible')) return;
		}
		await self.registration.showNotification(d.title || 'Silo', {
			body: d.body || '',
			icon: '/icons/icon-192.png',
			badge: '/icons/icon-192.png',
			tag: d.tag || undefined,
			renotify: !!d.tag,
			requireInteraction: isCall,
			vibrate: isCall ? [300, 150, 300, 150, 300] : [80, 60, 80],
			data: { url: d.url || '/' },
		});
	})());
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
