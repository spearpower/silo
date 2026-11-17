import Link from 'next/link';

export default function NotFound() {
	return (
		<div className="empty" style={{ minHeight: '80dvh' }}>
			<img src="/icons/icon-192.png" alt="" width={64} height={64} style={{ borderRadius: 18 }} />
			<h2>Page not found</h2>
			<p>That page doesn’t exist.</p>
			<Link className="btn btn-primary" href="/">Back to chats</Link>
		</div>
	);
}
