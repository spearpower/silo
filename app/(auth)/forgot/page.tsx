'use client';
import Link from 'next/link';
import { useState } from 'react';
import AuthBrand from '@/components/AuthBrand';
import { supabase } from '@/lib/supabase/browser';
import { isEmail } from '@/lib/validate';

export default function ForgotPage() {
	const [email, setEmail] = useState('');
	const [busy, setBusy] = useState(false);
	const [sent, setSent] = useState(false);
	const [error, setError] = useState('');
	const submit = async () => {
		if (!isEmail(email.trim())) { setError('That email doesn’t look right'); return; }
		setBusy(true); setError('');
		const { error: e } = await supabase().auth.resetPasswordForEmail(email.trim(), { redirectTo: `${location.origin}/auth/confirm?next=/reset-password` });
		setBusy(false);
		// Same answer whether or not the address has an account (no account probing); only rate limits are shown.
		if (e && /rate|too many/i.test(e.message)) setError('Too many requests. Wait a few minutes and try again.');
		else setSent(true);
	};
	return (
		<div className="auth-card">
			<AuthBrand title="Reset password" subtitle={sent ? undefined : 'We’ll email you a link to choose a new one.'} />
			{sent ? (
				<div className="stack">
					<div className="banner ok" role="status">If an account uses {email.trim()}, a reset link is on its way. Check your inbox and spam folder.</div>
					<Link className="btn btn-outline btn-block" href="/signin">Back to sign in</Link>
				</div>
			) : (
				<form className="stack" onSubmit={e => { e.preventDefault(); void submit(); }}>
					<div className="field"><label htmlFor="email">Email</label><input id="email" className="input" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required /></div>
					{error && <div className="banner error" role="alert">{error}</div>}
					<button className="btn btn-primary btn-block" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send reset link'}</button>
				</form>
			)}
			<p className="auth-foot"><Link href="/signin">Back to sign in</Link></p>
		</div>
	);
}
