'use client';
import { useEffect } from 'react';
import { reportError } from '@/lib/client/report';

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
	useEffect(() => { reportError(error, 'global-error'); }, [error]);
	return (
		<html lang="en">
			<body style={{ margin: 0, minHeight: '100vh', display: 'grid', placeItems: 'center', fontFamily: 'system-ui, sans-serif', background: '#03203D', color: '#EAF2F9', textAlign: 'center', padding: 24 }}>
				<div>
					<h1 style={{ fontSize: 24 }}>Silo hit a problem</h1>
					<p style={{ color: '#9DB4CA' }}>Reload to try again.</p>
					<button type="button" onClick={() => location.reload()} style={{ minHeight: 44, padding: '0 20px', borderRadius: 12, border: 0, background: '#639CC5', color: '#03203D', fontWeight: 600 }}>Reload</button>
				</div>
			</body>
		</html>
	);
}
