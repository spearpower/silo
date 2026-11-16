'use client';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { isChunkError, reloadForNewVersion, reportError } from '@/lib/report';

interface BeforeInstallPromptEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<unknown> }
const DISMISSED = 'picknplay.installDismissed';

/** Service worker, offline indicator and a polite install prompt (never on the game table). */
export default function PwaClient() {
	const path = usePathname();
	const [offline, setOffline] = useState(false);
	const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
	const [iosHint, setIosHint] = useState(false);

	useEffect(() => {
		if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
			navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
		}
		// report errors that never reach an error screen; reload once if an old copy can't load a file
		const onError = (e: ErrorEvent) => { if (isChunkError(e.error || e.message)) reloadForNewVersion(); else reportError(e.error || e.message, 'window.onerror'); };
		const onRejection = (e: PromiseRejectionEvent) => { if (isChunkError(e.reason)) reloadForNewVersion(); else reportError(e.reason, 'unhandledrejection'); };
		window.addEventListener('error', onError);
		window.addEventListener('unhandledrejection', onRejection);
		const on = () => setOffline(false), off = () => setOffline(true);
		setOffline(navigator.onLine === false);
		window.addEventListener('online', on); window.addEventListener('offline', off);

		let dismissed = false;
		try { dismissed = localStorage.getItem(DISMISSED) === '1'; } catch { /* storage blocked */ }
		const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
		const onPrompt = (e: Event) => { e.preventDefault(); if (!dismissed && !standalone) setPrompt(e as BeforeInstallPromptEvent); };
		window.addEventListener('beforeinstallprompt', onPrompt);
		const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
		const t = ios && !dismissed && !standalone ? setTimeout(() => setIosHint(true), 1500) : undefined;
		return () => { window.removeEventListener('error', onError); window.removeEventListener('unhandledrejection', onRejection); window.removeEventListener('online', on); window.removeEventListener('offline', off); window.removeEventListener('beforeinstallprompt', onPrompt); if (t) clearTimeout(t); };
	}, []);

	const dismiss = () => { try { localStorage.setItem(DISMISSED, '1'); } catch { /* ignore */ } setPrompt(null); setIosHint(false); };
	const showInstall = (prompt || iosHint) && (path === '/' || path === '/scores' || path === '/signin');

	return (
		<>
			{offline && <div className="offline-pill" role="status">You are offline. Reconnecting…</div>}
			{showInstall && (
				<div className="install" role="dialog" aria-label="Install PicknPlay" style={path === '/signin' ? { bottom: 'calc(16px + var(--safe-b))' } : undefined}>
					<img src="/icons/icon-192.png" alt="" />
					<div className="t"><b>Install PicknPlay</b>{prompt ? 'Play full screen from your home screen.' : 'Tap Share, then “Add to Home Screen”.'}</div>
					{prompt && <button className="btn btn-primary" type="button" onClick={async () => { await prompt.prompt(); dismiss(); }}>Install</button>}
					<button className="x" type="button" aria-label="Not now" onClick={dismiss}>×</button>
				</div>
			)}
		</>
	);
}
