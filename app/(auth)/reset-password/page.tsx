'use client';
import { useState } from 'react';
import AuthBrand from '@/components/AuthBrand';
import { supabase } from '@/lib/supabase/browser';

// Reached from the reset email via /auth/confirm, which already signed the person in for this purpose.
export default function ResetPasswordPage() {
	const [pw, setPw] = useState('');
	const [pw2, setPw2] = useState('');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const submit = async () => {
		if (pw.length < 8) { setError('Use at least 8 characters'); return; }
		if (pw !== pw2) { setError('The passwords don’t match'); return; }
		setBusy(true); setError('');
		const db = supabase();
		const { error: e } = await db.auth.updateUser({ password: pw });
		if (e) { setBusy(false); setError(/session/i.test(e.message) ? 'This reset link has expired. Ask for a new one.' : e.message); return; }
		location.href = '/';
	};
	return (
		<div className="auth-card">
			<AuthBrand title="Choose a new password" />
			<form className="stack" onSubmit={e => { e.preventDefault(); void submit(); }}>
				<div className="field"><label htmlFor="pw">New password</label><input id="pw" className="input" type="password" autoComplete="new-password" value={pw} onChange={e => setPw(e.target.value)} minLength={8} required /></div>
				<div className="field"><label htmlFor="pw2">Repeat it</label><input id="pw2" className="input" type="password" autoComplete="new-password" value={pw2} onChange={e => setPw2(e.target.value)} required /></div>
				{error && <div className="banner error" role="alert">{error} {/expired/.test(error) && <a href="/forgot">Get a new link</a>}</div>}
				<button className="btn btn-primary btn-block" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save password'}</button>
			</form>
		</div>
	);
}
