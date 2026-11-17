'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import AuthBrand from '@/components/AuthBrand';
import { supabase } from '@/lib/supabase/browser';
import { safeNext } from '@/lib/validate';

function SignIn() {
	const params = useSearchParams();
	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState(params.get('error') === 'link' ? 'That link has expired or was already used. Sign in, or ask for a new link.' : '');
	const notice = params.get('deleted') ? 'Your account was deleted.' : params.get('reset') ? 'Password changed. Sign in with your new password.' : '';

	const submit = async () => {
		setBusy(true); setError('');
		try {
			const { error: e } = await supabase().auth.signInWithPassword({ email: email.trim(), password });
			if (e) {
				setError(/confirm/i.test(e.message) ? 'Confirm your email first: open the link we sent you.'
					: /banned/i.test(e.message) ? 'This account is suspended.'
					: /invalid/i.test(e.message) ? 'That email and password don’t match.' : 'Couldn’t sign in. Try again.');
				setBusy(false);
				return;
			}
			location.href = safeNext(params.get('next'));
		} catch (e) { setError((e as Error).message); setBusy(false); }
	};

	return (
		<div className="auth-card">
			<AuthBrand title="Welcome back" subtitle="Sign in to Silo" />
			<form className="stack" onSubmit={e => { e.preventDefault(); void submit(); }}>
				{notice && <div className="banner ok" role="status">{notice}</div>}
				<div className="field"><label htmlFor="email">Email</label><input id="email" className="input" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required /></div>
				<div className="field">
					<label htmlFor="password">Password</label>
					<input id="password" className="input" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required />
				</div>
				{error && <div className="banner error" role="alert">{error}</div>}
				<button className="btn btn-primary btn-block" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
				<Link href="/forgot" className="small" style={{ textAlign: 'center' }}>Forgot your password?</Link>
			</form>
			<p className="auth-foot">New to Silo? <Link href="/signup">Create an account</Link></p>
		</div>
	);
}

export default function SignInPage() {
	return <Suspense><SignIn /></Suspense>;
}
