'use client';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/client';
import { ErrorBanner, NavBar } from '@/components/ui';

export default function SignUpPage() {
	const [error, setError] = useState('');
	const [busy, setBusy] = useState(false);

	async function submit(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault();
		const f = Object.fromEntries(new FormData(e.currentTarget));
		setBusy(true); setError('');
		try {
			await api('/api/auth/signup', f);
			window.location.href = '/';
		} catch (err) {
			setError((err as Error).message);
			setBusy(false);
		}
	}

	return (
		<div className="app">
			<NavBar title="Create Account" back="/signin" backLabel="Sign In" />
			<main>
				<form onSubmit={submit} noValidate>
					<div className="section-title">About you</div>
					<div className="fields">
						<div className="field"><label htmlFor="fullname">Full name</label>
							<input name="fullname" id="fullname" placeholder="e.g. Jane Akello" autoComplete="name" required /></div>
						<div className="field"><label htmlFor="email">Email (optional)</label>
							<input name="email" id="email" type="email" placeholder="you@example.com" autoComplete="email" autoCapitalize="none" inputMode="email" /></div>
						<div className="field"><label htmlFor="phone">Phone (optional)</label>
							<input name="phone" id="phone" type="tel" placeholder="e.g. 0754252423" autoComplete="tel" inputMode="numeric" maxLength={13} /></div>
					</div>
					<div className="section-title">Sign-in details</div>
					<div className="fields">
						<div className="field"><label htmlFor="username">Username</label>
							<input name="username" id="username" placeholder="Letters and numbers" maxLength={20} autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} required /></div>
						<div className="field"><label htmlFor="password">Password</label>
							<input name="password" id="password" type="password" placeholder="At least 6 characters" autoComplete="new-password" required /></div>
						<div className="field"><label htmlFor="repassword">Confirm password</label>
							<input name="repassword" id="repassword" type="password" placeholder="Type it again" autoComplete="new-password" required /></div>
					</div>
					<p className="legal" style={{ textAlign: 'left', marginTop: 14 }}>By creating an account you agree to how PicknPlay handles your data, as set out in the <Link href="/privacy">Privacy Policy</Link>.</p>
					<div style={{ marginTop: 14 }}>
						<button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create Account'}</button>
					</div>
					<ErrorBanner>{error}</ErrorBanner>
				</form>
			</main>
		</div>
	);
}
