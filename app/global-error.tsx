'use client';
// Last-resort screen when the whole app shell fails. Plain styles: globals.css may not be loaded here.
import { useEffect } from 'react';
import { isChunkError, reloadForNewVersion, reportError } from '@/lib/report';

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
	useEffect(() => {
		reportError(error, 'global-error');
		if (isChunkError(error)) reloadForNewVersion();
	}, [error]);
	return (
		<html lang="en">
			<body style={{ margin: 0, minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#0A3F29', color: '#F6F3EA', font: '16px system-ui, sans-serif', textAlign: 'center', padding: 24 }}>
				<div>
					<h1 style={{ fontSize: 26 }}>Something went wrong</h1>
					<p>Your game is saved. Reload to get the latest version of PicknPlay.</p>
					<button type="button" onClick={() => location.reload()} style={{ font: '600 17px system-ui', padding: '12px 28px', borderRadius: 12, border: 0, background: '#F2C14E', color: '#1A1405' }}>Reload</button>
					<p style={{ marginTop: 18, fontSize: 13, opacity: 0.7, wordBreak: 'break-word' }}>Error: {error.message || 'unknown'}{error.digest ? ` (${error.digest})` : ''}</p>
				</div>
			</body>
		</html>
	);
}
