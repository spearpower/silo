'use client';
import Link from 'next/link';
import AlertsSwitch from '@/components/AlertsSwitch';
import DeleteAccount from '@/components/DeleteAccount';
import { useEffect, useState } from 'react';
import { api } from '@/lib/client';
import { AVATARS, avatarUrl } from '@/lib/avatars';
import { soundOn, setSoundOn, initSound, soundVolume, setSoundVolume, playSound } from '@/lib/sound';
import { ErrorBanner, NavBar, Skeleton, TabBar, Chevron } from '@/components/ui';

interface Account { id: number; username: string; fullname: string; email: string | null; phone: string | null; photo: string; role: 'player' | 'admin' | 'superadmin' }

export default function AccountPage() {
	const [acc, setAcc] = useState<Account | null>(null);
	const [form, setForm] = useState({ username: '', fullname: '', email: '', phone: '', photo: '' });
	const [msg, setMsg] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
	const [pw, setPw] = useState({ current: '', next: '', repeat: '' });
	const [pwMsg, setPwMsg] = useState(''); const [pwError, setPwError] = useState('');
	const [sound, setSound] = useState(true);
	const [volume, setVolume] = useState(80);

	useEffect(() => {
		initSound();
		setSound(soundOn());
		setVolume(Math.round(soundVolume() * 100));
		api<Account>('/api/account').then(a => {
			setAcc(a);
			setForm({ username: a.username, fullname: a.fullname, email: a.email || '', phone: a.phone || '', photo: a.photo });
		}).catch(e => setError(e.message));
	}, []);

	const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, [k]: e.target.value }));
	const dirty = !!acc && (form.username !== acc.username || form.fullname !== acc.fullname || form.email !== (acc.email || '') || form.phone !== (acc.phone || '') || form.photo !== acc.photo);

	async function save(e: React.FormEvent) {
		e.preventDefault();
		setBusy(true); setMsg(''); setError('');
		try {
			const r = await api<{ account: Account }>('/api/account', form);
			setAcc(r.account);
			setMsg('Saved');
			setTimeout(() => setMsg(''), 2500);
		} catch (err) { setError((err as Error).message); }
		finally { setBusy(false); }
	}

	async function changePw(e: React.FormEvent) {
		e.preventDefault();
		setPwMsg(''); setPwError('');
		try {
			await api('/api/account/password', pw);
			setPw({ current: '', next: '', repeat: '' });
			setPwMsg('Password changed');
		} catch (err) { setPwError((err as Error).message); }
	}

	if (!acc) return (
		<div className="app has-tabs"><NavBar /><main><h1 className="large-title">Account</h1>{error ? <ErrorBanner>{error}</ErrorBanner> : <Skeleton rows={3} label="Loading your account" />}</main><TabBar /></div>
	);

	return (
		<div className="app has-tabs">
			<NavBar />
			<main>
				<h1 className="large-title">Account</h1>

				<form onSubmit={save} noValidate>
					<div className="profile" style={{ marginBottom: 12 }}>
						<img className="avatar" src={avatarUrl(form.photo)} alt="" />
						<div className="who"><div className="hello">This is how others see you</div><div className="name">{form.username || acc.username}</div></div>
					</div>

					<div className="section-title">Avatar</div>
					<div className="avatar-grid" role="radiogroup" aria-label="Choose your avatar">
						{AVATARS.map(a => (
							<label key={a} className={form.photo === a ? 'on' : ''}>
								<input type="radio" name="photo" value={a} checked={form.photo === a} onChange={() => setForm(f => ({ ...f, photo: a }))} />
								<img src={avatarUrl(a)} alt="" />
								<span className="sr-only">Avatar {a}</span>
							</label>
						))}
					</div>

					<div className="section-title">Profile</div>
					<div className="fields">
						<div className="field"><label htmlFor="username">Username</label>
							<input id="username" value={form.username} onChange={set('username')} maxLength={20} autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="username" /></div>
						<div className="field"><label htmlFor="fullname">Full name</label>
							<input id="fullname" value={form.fullname} onChange={set('fullname')} autoComplete="name" /></div>
						<div className="field"><label htmlFor="email">Email (optional)</label>
							<input id="email" type="email" value={form.email} onChange={set('email')} inputMode="email" autoCapitalize="none" autoComplete="email" /></div>
						<div className="field"><label htmlFor="phone">Phone (optional)</label>
							<input id="phone" type="tel" value={form.phone} onChange={set('phone')} inputMode="numeric" maxLength={13} autoComplete="tel" /></div>
					</div>
					<p className="hint">Your username is what other players see. You sign in with the new one after changing it.</p>
					<div style={{ marginTop: 16 }}>
						<button className="btn btn-primary" type="submit" disabled={!dirty || busy}>{busy ? 'Saving…' : 'Save Changes'}</button>
					</div>
					{msg && <div className="ok-banner" role="status">{msg}</div>}
					<ErrorBanner>{error}</ErrorBanner>
				</form>

				<div className="section-title">Alerts</div>
				<AlertsSwitch />

				<div className="section-title">Sound</div>
				<div className="switch-row" style={{ marginTop: 0 }}>
					<label htmlFor="snd">Game sounds</label>
					<span className="switch"><input id="snd" type="checkbox" role="switch" checked={sound} onChange={e => { setSound(e.target.checked); setSoundOn(e.target.checked); }} /><span /></span>
				</div>
				<div className="volume-row">
					<label htmlFor="vol">Volume</label>
					<input id="vol" type="range" min={0} max={100} step={5} value={volume} disabled={!sound}
						onChange={e => { const v = Number(e.target.value); setVolume(v); setSoundVolume(v / 100); }}
						onPointerUp={() => playSound('play', true)} onKeyUp={() => playSound('play', true)} aria-valuetext={`${volume}%`} />
					<span className="vol-val">{volume}%</span>
				</div>
				<p className="hint">You’ll hear your turn, cards being played and drawn, penalties, cuts and wins. This only changes this device. You can also mute from the 🔔 at the table.</p>

				<form onSubmit={changePw} noValidate>
					<div className="section-title">Change password</div>
					<div className="fields">
						<div className="field"><label htmlFor="cur">Current password</label>
							<input id="cur" type="password" value={pw.current} onChange={e => setPw(p => ({ ...p, current: e.target.value }))} autoComplete="current-password" /></div>
						<div className="field"><label htmlFor="new">New password</label>
							<input id="new" type="password" value={pw.next} onChange={e => setPw(p => ({ ...p, next: e.target.value }))} placeholder="At least 6 characters" autoComplete="new-password" /></div>
						<div className="field"><label htmlFor="rep">Repeat new password</label>
							<input id="rep" type="password" value={pw.repeat} onChange={e => setPw(p => ({ ...p, repeat: e.target.value }))} autoComplete="new-password" /></div>
					</div>
					<div style={{ marginTop: 16 }}>
						<button className="btn btn-secondary" type="submit" disabled={!pw.current || !pw.next}>Change Password</button>
					</div>
					{pwMsg && <div className="ok-banner" role="status">{pwMsg}</div>}
					<ErrorBanner>{pwError}</ErrorBanner>
				</form>

				<div className="section-title">Help</div>
				<nav className="group">
					<Link className="row-link" href="/how-to-play">
						<span className="row-ico"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5v-15Z" /><path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20v3H6.5" /></svg></span>
						<span className="row-text"><span className="row-title">How to Play</span><span className="row-sub">Matching, special cards, cutting and scoring</span></span>
						<Chevron />
					</Link>
					<Link className="row-link" href="/privacy">
						<span className="row-ico"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 4 6v6c0 4.4 3.4 8.3 8 9 4.6-.7 8-4.6 8-9V6l-8-3Z" /><path d="M9.5 12l1.8 1.8 3.4-3.6" /></svg></span>
						<span className="row-text"><span className="row-title">Privacy Policy</span><span className="row-sub">What we keep, who sees it, deleting your account</span></span>
						<Chevron />
					</Link>
				</nav>

				{(acc.role === 'admin' || acc.role === 'superadmin') && (
					<>
						<div className="section-title">Admin</div>
						<nav className="group">
							<Link className="row-link" href="/admin">
								<span className="row-ico"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 4 6v6c0 4.4 3.4 8.3 8 9 4.6-.7 8-4.6 8-9V6l-8-3Z" /></svg></span>
								<span className="row-text"><span className="row-title">Admin</span><span className="row-sub">Tables, players, Virtual Friends, voice chat</span></span>
								<Chevron />
							</Link>
						</nav>
					</>
				)}

				<div style={{ marginTop: 24 }}>
					<button className="btn btn-plain" type="button" onClick={async () => { await api('/api/auth/signout', {}); window.location.href = '/signin'; }}>Sign Out</button>
				</div>

				<div className="section-title danger-zone">Delete account</div>
				<p className="hint" style={{ marginTop: 0 }}>Permanently delete your PicknPlay account and your personal data.</p>
				<DeleteAccount superAdmin={acc.role === 'superadmin'} />
			</main>
			<TabBar />
		</div>
	);
}
