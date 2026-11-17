'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import AuthBrand from '@/components/AuthBrand';
import { supabase } from '@/lib/supabase/browser';
import { USERNAME, cleanName, isEmail } from '@/lib/validate';

export default function SignUpPage() {
	const [name, setName] = useState('');
	const [username, setUsername] = useState('');
	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const [available, setAvailable] = useState<boolean | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const [sent, setSent] = useState(false);

	useEffect(() => {
		setAvailable(null);
		if (!USERNAME.test(username)) return;
		const t = setTimeout(async () => {
			const { data } = await supabase().rpc('username_available', { p_username: username });
			setAvailable(data ?? null);
		}, 350);
		return () => clearTimeout(t);
	}, [username]);

	const submit = async () => {
		setError('');
		const display = cleanName(name);
		if (!display) { setError('Enter your name (up to 50 characters)'); return; }
		if (!USERNAME.test(username)) { setError('Usernames are 3–20 lowercase letters, numbers or _'); return; }
		if (available === false) { setError('That username is taken'); return; }
		if (!isEmail(email.trim())) { setError('That email doesn’t look right'); return; }
		if (password.length < 8) { setError('Use a password of at least 8 characters'); return; }
		setBusy(true);
		const { data, error: e } = await supabase().auth.signUp({
			email: email.trim(), password,
			options: { data: { username, display_name: display }, emailRedirectTo: `${location.origin}/auth/confirm?next=/` },
		});
		setBusy(false);
		if (e) {
			setError(/already registered|exists/i.test(e.message) ? 'An account with this email already exists. Sign in instead.'
				: /database error/i.test(e.message) ? 'That username was just taken. Pick another.'
				: /password/i.test(e.message) ? e.message : 'Couldn’t create the account. Try again.');
			return;
		}
		if (data.session) location.href = '/'; // email confirmation switched off in Supabase
		else setSent(true);
	};

	if (sent) {
		return (
			<div className="auth-card">
				<AuthBrand title="Check your email" subtitle={`We sent a link to ${email.trim()}. Open it to finish creating your account.`} />
				<Link className="btn btn-outline btn-block" href="/signin">Back to sign in</Link>
			</div>
		);
	}

	return (
		<div className="auth-card">
			<AuthBrand title="Join Silo" subtitle="Your private space with close friends" />
			<form className="stack" onSubmit={e => { e.preventDefault(); void submit(); }} noValidate>
				<div className="field"><label htmlFor="name">Your name</label><input id="name" className="input" autoComplete="name" value={name} maxLength={50} onChange={e => setName(e.target.value)} required /></div>
				<div className="field">
					<label htmlFor="username">Username</label>
					<input id="username" className="input" autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} maxLength={20}
						onChange={e => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} required aria-describedby="uhint" />
					<span id="uhint" className={available === false ? 'error-text' : 'hint'} aria-live="polite">
						{available === false ? 'That username is taken' : available ? 'Available' : 'Friends find you by this. 3–20 letters, numbers or _'}
					</span>
				</div>
				<div className="field"><label htmlFor="email">Email</label><input id="email" className="input" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required /></div>
				<div className="field"><label htmlFor="password">Password</label><input id="password" className="input" type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} minLength={8} required /><span className="hint">At least 8 characters.</span></div>
				{error && <div className="banner error" role="alert">{error}</div>}
				<button className="btn btn-primary btn-block" type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
				<p className="hint" style={{ textAlign: 'center', margin: 0 }}>By joining you agree to our <Link href="/privacy">privacy terms</Link>.</p>
			</form>
			<p className="auth-foot">Already have an account? <Link href="/signin">Sign in</Link></p>
		</div>
	);
}
