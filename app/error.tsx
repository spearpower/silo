'use client';
// Shown instead of the blank "client-side exception" page when a screen crashes.
import { useEffect } from 'react';
import { isChunkError, reloadForNewVersion, reportError } from '@/lib/report';

export default function ErrorScreen({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
	useEffect(() => {
		reportError(error, 'error-boundary');
		if (isChunkError(error)) reloadForNewVersion();
	}, [error]);
	return (
		<div className="app centered"><main className="center">
			<div className="brand"><img src="/icons/icon-192.png" alt="" /><h1 className="large-title">Something went wrong</h1></div>
			<p className="subtitle">Your game is saved. Tap Try Again, or Reload to get the latest version of PicknPlay.</p>
			<button className="btn btn-primary" type="button" onClick={() => reset()}>Try Again</button>
			<button className="btn btn-plain" type="button" onClick={() => location.reload()}>Reload</button>
			<a className="btn btn-plain" href="/">Back to Play</a>
			<p className="footnote" style={{ marginTop: 16, wordBreak: 'break-word' }}>Error: {error.message || 'unknown'}{error.digest ? ` (${error.digest})` : ''}</p>
		</main></div>
	);
}
