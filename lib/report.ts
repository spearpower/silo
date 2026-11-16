'use client';
// Sends browser errors to /api/client-error so they appear in the server (Vercel) logs.
let sent = 0;
const RELOAD_KEY = 'picknplay.chunkReload';

/** True for "this phone is running an older copy of the app and a file is gone" errors. */
export const isChunkError = (e: unknown) =>
	/ChunkLoadError|Loading chunk [\w-]+ failed|Loading CSS chunk|Failed to fetch dynamically imported module|Importing a module script failed/i.test(String((e as Error)?.message || e) + String((e as Error)?.name || ''));

/** Reload once to pick up the new version (guarded so it can't loop). */
export function reloadForNewVersion(): boolean {
	try {
		const last = Number(sessionStorage.getItem(RELOAD_KEY)) || 0;
		if (Date.now() - last < 60000) return false;
		sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
	} catch { /* storage blocked: still try once */ }
	location.reload();
	return true;
}

export function reportError(e: unknown, where: string) {
	if (typeof window === 'undefined' || sent >= 5) return;
	sent++;
	const err = e as Error & { digest?: string };
	const body = JSON.stringify({
		where, path: location.pathname, message: String(err?.message || e).slice(0, 500), name: err?.name,
		stack: String(err?.stack || '').slice(0, 2000), digest: err?.digest, ua: navigator.userAgent.slice(0, 200),
		standalone: window.matchMedia?.('(display-mode: standalone)').matches || false,
	});
	try {
		if (!navigator.sendBeacon?.('/api/client-error', new Blob([body], { type: 'application/json' }))) {
			fetch('/api/client-error', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
		}
	} catch { /* never let reporting break the page */ }
}
