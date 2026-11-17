'use client';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { isChunkError, reloadForNewVersion, reportError } from '@/lib/client/report';

interface BeforeInstallPromptEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<unknown> }
const DISMISSED = 'silo.installDismissed';

/** Service worker, error reporting, offline notice and a polite install prompt (only on the chat list). */
export default function PwaClient() {
	const path = usePathname();
	const [offline, setOffline] = useState(false);
	const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);

	useEffect(() => {
		if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
			navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
		}
		const onError = (e: ErrorEvent) => { if (isChunkError(e.error || e.message)) reloadForNewVersion(); else reportError(e.error || e.message, 'window.onerror'); };
		const onRejection = (e: PromiseRejectionEvent) => { if (isChunkError(e.reason)) reloadForNewVersion(); else reportError(e.reason, 'unhandledrejection'); };
		window.addEventListener('error', onError);
		window.addEventListener('unhandledrejection', onRejection);
		const on = () => setOffline(false), off = () => setOffline(true);
		setOffline(navigator.onLine === false);
		window.addEventListener('online', on);
		window.addEventListener('offline', off);
		let dismissed = false;
		try { dismissed = localStorage.getItem(DISMISSED) === '1'; } catch { /* storage blocked */ }
		const onPrompt = (e: Event) => { e.preventDefault(); if (!dismissed) setPrompt(e as BeforeInstallPromptEvent); };
		window.addEventListener('beforeinstallprompt', onPrompt);
		return () => {
			window.removeEventListener('error', onError); window.removeEventListener('unhandledrejection', onRejection);
			window.removeEventListener('online', on); window.removeEventListener('offline', off);
			window.removeEventListener('beforeinstallprompt', onPrompt);
		};
	}, []);

	const dismiss = () => { try { localStorage.setItem(DISMISSED, '1'); } catch { /* ignore */ } setPrompt(null); };

	return (
		<>
			{offline && <div className="conn-pill" role="status">You’re offline. Messages will load when you’re back.</div>}
			{prompt && path === '/' && (
				<div className="toast" role="dialog" aria-label="Install Silo" style={{ pointerEvents: 'auto' }}>
					<span className="bar" />
					<span>Install Silo for quicker access and call alerts.</span>
					<button className="btn btn-sm btn-accent" type="button" onClick={async () => { await prompt.prompt(); dismiss(); }}>Install</button>
					<button className="icon-btn" style={{ color: '#fff', width: 32, height: 32 }} type="button" aria-label="Not now" onClick={dismiss}>×</button>
				</div>
			)}
		</>
	);
}
