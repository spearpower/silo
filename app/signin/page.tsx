'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/client';
import { ErrorBanner } from '@/components/ui';

export default function SignInPage() {
	const [error, setError] = useState('');
	const [busy, setBusy] = useState(false);
	const [deleted, setDeleted] = useState(false);
	useEffect(() => { setDeleted(new URLSearchParams(location.search).get('deleted') === '1'); }, []);

	async function submit(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault();
		const f = new FormData(e.currentTarget);
		setBusy(true); setError('');
		try {
			await api('/api/auth/signin', { username: f.get('username'), password: f.get('password') });
			const next = new URLSearchParams(location.search).get('next');
			window.location.href = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
		} catch (err) {
			setError((err as Error).message);
			setBusy(false);
		}
	}

	return (
		<div className="app centered">
			<main>
				<div className="brand">
					<img src="/icons/icon-192.png" alt="" />
					<h1 className="large-title">PicknPlay</h1>
					<p className="subtitle center" style={{ margin: 0 }}>Sign in to play with your friends.</p>
				</div>
				<form onSubmit={submit} noValidate>
					<div className="fields">
						<div className="field">
							<label htmlFor="username">Username</label>
							<input name="username" id="username" type="text" placeholder="Your username" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} required />
						</div>
						<div className="field">
							<label htmlFor="password">Password</label>
							<input name="password" id="password" type="password" placeholder="Password" autoComplete="current-password" required />
						</div>
					</div>
					<div style={{ marginTop: 20 }}>
						<button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Signing In…' : 'Sign In'}</button>
					</div>
					{deleted && <div className="ok-banner" role="status">Your account has been deleted. Thanks for playing PicknPlay.</div>}
					<ErrorBanner>{error}</ErrorBanner>
					<details className="forgot">
						<summary>Forgot your password?</summary>
						<p>Ask an admin to reset it. They’ll give you a temporary password; sign in with it and you’ll choose a new one straight away.</p>
					</details>
					<div style={{ marginTop: 16 }}>
						<Link href="/signup" className="btn btn-plain">New here? Create an Account</Link>
					</div>
				</form>
				<p className="legal"><Link href="/privacy">Privacy Policy</Link></p>
			</main>
		</div>
	);
}
