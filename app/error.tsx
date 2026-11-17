'use client';
// Shown instead of a blank screen when a page crashes.
import { useEffect } from 'react';
import { isChunkError, reloadForNewVersion, reportError } from '@/lib/client/report';

export default function ErrorScreen({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
	useEffect(() => {
		reportError(error, 'error-boundary');
		if (isChunkError(error)) reloadForNewVersion();
	}, [error]);
	return (
		<div className="empty" style={{ minHeight: '60dvh' }}>
			<img src="/icons/icon-192.png" alt="" width={64} height={64} style={{ borderRadius: 18 }} />
			<h2>Something went wrong</h2>
			<p>Your messages are safe. Try again, or reload to get the latest version of Silo.</p>
			<div className="row">
				<button className="btn btn-primary" type="button" onClick={() => reset()}>Try again</button>
				<button className="btn btn-outline" type="button" onClick={() => location.reload()}>Reload</button>
			</div>
			{error.digest && <p className="small">Reference: {error.digest}</p>}
		</div>
	);
}
