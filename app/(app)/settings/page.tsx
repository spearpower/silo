'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import Avatar from '@/components/Avatar';
import Icon from '@/components/Icon';
import Sheet from '@/components/Sheet';
import { patchMe, patchSettings, setOnlineVisible, useStore } from '@/lib/client/store';
import { supabase } from '@/lib/supabase/browser';
import { api, dbMessage } from '@/lib/client/api';
import { uploadPicture } from '@/lib/client/images';
import { detachDevice, disablePush, enablePush, pushState, type PushState } from '@/lib/client/push';
import { USERNAME } from '@/lib/validate';
import { nativeApp } from '@/lib/client/native';
import type { SettingsRow } from '@/lib/database.types';

export default function SettingsPage() {
	const { me, settings } = useStore(s => ({ me: s.me, settings: s.settings }));
	const [inApp, setInApp] = useState(false);
	useEffect(() => { setInApp(!!nativeApp()); }, []);
	if (!me || !settings) return <div className="empty"><div className="spinner" aria-label="Loading settings" /></div>;
	return (
		<div className="page" style={{ paddingTop: 0 }}>
			<div className="page-head" style={{ paddingLeft: 0, paddingRight: 0 }}><h1>Settings</h1></div>
			<ProfileCard />
			<PrivacyCard settings={settings} />
			{inApp ? <AndroidAppCard settings={settings} /> : <NotificationsCard settings={settings} />}
			<AppearanceCard />
			<AccountCard />
			<p className="muted small" style={{ textAlign: 'center', marginTop: 18 }}><Link href="/privacy">Privacy &amp; security</Link> · Silo</p>
		</div>
	);
}

function ProfileCard() {
	const me = useStore(s => s.me)!;
	const [name, setName] = useState(me.display_name);
	const [username, setUsername] = useState(me.username);
	const [bio, setBio] = useState(me.bio);
	const [busy, setBusy] = useState(false);
	const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
	const dirty = name !== me.display_name || username !== me.username || bio !== me.bio;

	const save = async () => {
		const u = username.trim().toLowerCase();
		if (!USERNAME.test(u)) { setMsg({ ok: false, text: 'Usernames are 3–20 lowercase letters, numbers or _' }); return; }
		setBusy(true); setMsg(null);
		const { error } = await supabase().from('profiles').update({ display_name: name.trim(), username: u, bio: bio.trim() }).eq('id', me.id);
		setBusy(false);
		if (error) { setMsg({ ok: false, text: error.code === '23505' ? 'That username is taken' : error.code === '23514' ? 'Check the name, username and bio lengths' : dbMessage(error) }); return; }
		patchMe({ display_name: name.trim(), username: u, bio: bio.trim() });
		setUsername(u);
		setMsg({ ok: true, text: 'Saved' });
	};
	const onPhoto = async (file?: File) => {
		if (!file) return;
		setBusy(true); setMsg(null);
		try {
			const url = await uploadPicture('avatars', me.id, file);
			const { error } = await supabase().from('profiles').update({ avatar_url: url }).eq('id', me.id);
			if (error) throw new Error(dbMessage(error));
			patchMe({ avatar_url: url });
		} catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
	};
	const removePhoto = async () => {
		setBusy(true);
		const { error } = await supabase().from('profiles').update({ avatar_url: null }).eq('id', me.id);
		setBusy(false);
		if (!error) patchMe({ avatar_url: null });
	};

	return (
		<section className="card stack" aria-label="Profile">
			<h2>Profile</h2>
			<div className="row" style={{ gap: 16 }}>
				<Avatar id={me.id} name={me.display_name} url={me.avatar_url} size={76} />
				<div className="stack" style={{ gap: 6 }}>
					<label className="btn btn-sm btn-outline" style={{ cursor: 'pointer' }}>
						<Icon name="camera" className="icon sm" />{me.avatar_url ? 'Change photo' : 'Add photo'}
						<input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={e => void onPhoto(e.target.files?.[0])} />
					</label>
					{me.avatar_url && <button className="link-btn small" type="button" onClick={() => void removePhoto()}>Remove photo</button>}
				</div>
			</div>
			<form className="stack" onSubmit={e => { e.preventDefault(); void save(); }}>
				<div className="field"><label htmlFor="dn">Display name</label><input id="dn" className="input" value={name} maxLength={50} onChange={e => setName(e.target.value)} required /></div>
				<div className="field">
					<label htmlFor="un">Username</label>
					<input id="un" className="input" value={username} maxLength={20} onChange={e => setUsername(e.target.value.toLowerCase())} autoCapitalize="none" spellCheck={false} required />
					<span className="hint">Friends find you by this. 3–20 lowercase letters, numbers or _.</span>
				</div>
				<div className="field"><label htmlFor="bio">About</label><textarea id="bio" className="textarea" value={bio} maxLength={160} onChange={e => setBio(e.target.value)} placeholder="A line about you" style={{ minHeight: 70 }} /></div>
				{msg && <div className={`banner ${msg.ok ? 'ok' : 'error'}`} role="status">{msg.text}</div>}
				<button className="btn btn-primary" type="submit" disabled={busy || !dirty || !name.trim()}>{busy ? 'Saving…' : 'Save profile'}</button>
			</form>
		</section>
	);
}

function Toggle({ label, hint, checked, onChange, disabled }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
	return (
		<label className="switch">
			<span><span style={{ fontWeight: 600 }}>{label}</span>{hint && <span className="hint" style={{ display: 'block' }}>{hint}</span>}</span>
			<input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} />
		</label>
	);
}

function useSettingSaver() {
	const meId = useStore(s => s.meId);
	const [error, setError] = useState('');
	const save = async (p: Partial<SettingsRow>) => {
		patchSettings(p);
		const { error: e } = await supabase().from('user_settings').update(p).eq('user_id', meId!);
		if (e) { setError(dbMessage(e, 'Couldn’t save that setting.')); patchSettings(Object.fromEntries(Object.entries(p).map(([k, v]) => [k, typeof v === 'boolean' ? !v : v]))); }
		else setError('');
	};
	return { save, error };
}

function PrivacyCard({ settings }: { settings: SettingsRow }) {
	const { save, error } = useSettingSaver();
	return (
		<section className="card" aria-label="Privacy">
			<h2>Privacy</h2>
			<Toggle label="Show when I’m online" hint="Others see a dot on your picture while Silo is open." checked={settings.show_online}
				onChange={v => { void save({ show_online: v }); void setOnlineVisible(v); }} />
			<Toggle label="Show my last seen" hint="Only friends and people you chat with can ever see it." checked={settings.show_last_seen} onChange={v => void save({ show_last_seen: v })} />
			<Toggle label="Read receipts" hint="If off, others won’t see when you’ve read their messages." checked={settings.read_receipts} onChange={v => void save({ read_receipts: v })} />
			<div className="switch">
				<span><span style={{ fontWeight: 600 }}>Who can start a chat with me</span><span className="hint" style={{ display: 'block' }}>Groups only ever include friends.</span></span>
				<select className="select" style={{ width: 'auto', minHeight: 40 }} value={settings.allow_messages_from}
					onChange={e => void save({ allow_messages_from: e.target.value as SettingsRow['allow_messages_from'] })} aria-label="Who can start a chat with me">
					<option value="friends">Friends only</option>
					<option value="everyone">Anyone on Silo</option>
				</select>
			</div>
			{error && <div className="error-text" role="alert">{error}</div>}
		</section>
	);
}

const PUSH_TEXT: Record<PushState, string> = {
	'on': 'On for this device.',
	'off': 'Off for this device.',
	'blocked': 'Blocked in your browser settings. Allow notifications for this site to turn them on.',
	'unsupported': 'This browser can’t show notifications.',
	'ios-install': 'On iPhone and iPad: tap Share, then “Add to Home Screen”, and open Silo from there to allow notifications.',
	'not-configured': 'Notifications aren’t set up on this server yet.',
};

function AppAlertsRow() {
	const [busy, setBusy] = useState(false);
	const [note, setNote] = useState('');
	const test = async () => {
		setBusy(true); setNote('');
		try {
			const r = await api<{ sent: number }>('/api/push/test');
			setNote(r.sent ? 'Sent. Close or minimise Silo and it should arrive in a moment.' : 'This phone isn’t registered for alerts yet. Allow notifications for Silo, then reopen the app.');
		} catch (e) { setNote((e as Error).message); } finally { setBusy(false); }
	};
	return (
		<>
			<div className="switch">
				<span>
					<span style={{ fontWeight: 600 }}>Message and call alerts</span>
					<span className="hint" style={{ display: 'block' }}>Incoming calls ring even when Silo is closed. Turn alerts on or off in Android Settings → Apps → Silo → Notifications.</span>
				</span>
				<button className="btn btn-sm btn-outline" type="button" disabled={busy} onClick={() => void test()}>Test</button>
			</div>
			{note && <p className="hint" role="status">{note}</p>}
		</>
	);
}

/** Inside the Android app: battery shortcut (keeps calls alive). Phone alerts for the app come in a later update. */
function AndroidAppCard({ settings }: { settings: SettingsRow }) {
	const { save } = useSettingSaver();
	const [unrestricted, setUnrestricted] = useState<boolean | null>(null);
	useEffect(() => {
		const check = () => { try { setUnrestricted(!!nativeApp()?.batteryUnrestricted()); } catch { setUnrestricted(null); } };
		check();
		document.addEventListener('visibilitychange', check);
		return () => document.removeEventListener('visibilitychange', check);
	}, []);
	return (
		<section className="card" aria-label="Calls on this phone">
			<h2>Calls on this phone</h2>
			<div className="switch">
				<span>
					<span style={{ fontWeight: 600 }}>Keep calls running</span>
					<span className="hint" style={{ display: 'block' }}>
						{unrestricted ? 'Battery set to no restrictions. Calls keep going when the screen locks.' : 'Set Silo’s battery usage to “No restrictions” so calls don’t cut off when the screen locks.'}
					</span>
				</span>
				<button className="btn btn-sm btn-outline" type="button" onClick={() => nativeApp()?.openBatterySettings()}>Settings</button>
			</div>
			<AppAlertsRow />
			<Toggle label="Show message text in alerts" hint="Off: alerts only say who wrote, not what." checked={settings.push_previews} onChange={v => void save({ push_previews: v })} />
		</section>
	);
}

function NotificationsCard({ settings }: { settings: SettingsRow }) {
	const { save } = useSettingSaver();
	const [state, setState] = useState<PushState | null>(null);
	const [busy, setBusy] = useState(false);
	const [note, setNote] = useState('');
	useEffect(() => { void pushState().then(setState); }, []);
	const toggle = async (on: boolean) => {
		setBusy(true); setNote('');
		try { setState(on ? await enablePush() : await disablePush()); } catch (e) { setNote((e as Error).message || 'Couldn’t change notifications.'); } finally { setBusy(false); }
	};
	const test = async () => {
		setBusy(true); setNote('');
		try { const r = await api<{ sent: number }>('/api/push/test'); setNote(r.sent ? 'Sent. It should appear in a moment.' : 'No devices are subscribed yet.'); }
		catch (e) { setNote((e as Error).message); } finally { setBusy(false); }
	};
	return (
		<section className="card" aria-label="Notifications">
			<h2>Notifications</h2>
			<Toggle label="Message and call alerts" hint={state ? PUSH_TEXT[state] : 'Checking…'} checked={state === 'on'}
				disabled={busy || !state || !['on', 'off'].includes(state)} onChange={v => void toggle(v)} />
			<Toggle label="Show message text in alerts" hint="Off: alerts only say who wrote, not what." checked={settings.push_previews} onChange={v => void save({ push_previews: v })} />
			{state === 'on' && <button className="btn btn-sm btn-outline" type="button" disabled={busy} onClick={() => void test()} style={{ marginTop: 10 }}>Send a test alert</button>}
			{note && <p className="hint" role="status">{note}</p>}
		</section>
	);
}

function AppearanceCard() {
	const [theme, setTheme] = useState<'system' | 'light' | 'dark'>('system');
	useEffect(() => {
		try { const t = localStorage.getItem('silo.theme'); if (t === 'light' || t === 'dark') setTheme(t); } catch { /* blocked */ }
	}, []);
	const pick = (t: 'system' | 'light' | 'dark') => {
		setTheme(t);
		try { if (t === 'system') localStorage.removeItem('silo.theme'); else localStorage.setItem('silo.theme', t); } catch { /* blocked */ }
		if (t === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
	};
	return (
		<section className="card" aria-label="Appearance">
			<h2>Appearance</h2>
			<div className="row" role="radiogroup" aria-label="Theme">
				{(['system', 'light', 'dark'] as const).map(t => (
					<button key={t} type="button" role="radio" aria-checked={theme === t} className={`btn btn-sm grow ${theme === t ? 'btn-primary' : 'btn-outline'}`} onClick={() => pick(t)}>
						{t === 'system' ? 'Device' : t === 'light' ? 'Light' : 'Dark'}
					</button>
				))}
			</div>
		</section>
	);
}

function AccountCard() {
	const [email, setEmail] = useState('');
	const [sheet, setSheet] = useState<null | 'password' | 'delete'>(null);
	useEffect(() => { void supabase().auth.getUser().then(({ data }) => setEmail(data.user?.email || '')); }, []);
	const signOut = async () => {
		await detachDevice();
		await fetch('/auth/signout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {});
		await supabase().auth.signOut().catch(() => {});
		location.href = '/signin';
	};
	return (
		<section className="card stack" style={{ gap: 6 }} aria-label="Account">
			<h2>Account</h2>
			<div className="muted small">Signed in as {email}</div>
			<button className="btn btn-ghost" style={{ justifyContent: 'flex-start' }} type="button" onClick={() => setSheet('password')}><Icon name="lock" />Change password</button>
			<button className="btn btn-ghost" style={{ justifyContent: 'flex-start' }} type="button" onClick={() => void signOut()}><Icon name="logout" />Sign out</button>
			<button className="btn btn-ghost" style={{ justifyContent: 'flex-start', color: 'var(--danger-ink)' }} type="button" onClick={() => setSheet('delete')}><Icon name="close" />Delete my account</button>
			{sheet === 'password' && <PasswordSheet onClose={() => setSheet(null)} />}
			{sheet === 'delete' && <DeleteSheet onClose={() => setSheet(null)} />}
		</section>
	);
}

function PasswordSheet({ onClose }: { onClose: () => void }) {
	const [pw, setPw] = useState(''); const [pw2, setPw2] = useState('');
	const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
	const save = async () => {
		if (pw.length < 8) { setMsg({ ok: false, text: 'Use at least 8 characters' }); return; }
		if (pw !== pw2) { setMsg({ ok: false, text: 'The passwords don’t match' }); return; }
		setBusy(true);
		const { error } = await supabase().auth.updateUser({ password: pw });
		setBusy(false);
		setMsg(error ? { ok: false, text: error.message || 'Couldn’t change the password' } : { ok: true, text: 'Password changed' });
	};
	return (
		<Sheet title="Change password" onClose={onClose}>
			<form className="stack" onSubmit={e => { e.preventDefault(); void save(); }}>
				<div className="field"><label htmlFor="np">New password</label><input id="np" className="input" type="password" autoComplete="new-password" value={pw} onChange={e => setPw(e.target.value)} minLength={8} required /></div>
				<div className="field"><label htmlFor="np2">Repeat it</label><input id="np2" className="input" type="password" autoComplete="new-password" value={pw2} onChange={e => setPw2(e.target.value)} required /></div>
				{msg && <div className={`banner ${msg.ok ? 'ok' : 'error'}`} role="status">{msg.text}</div>}
				<div className="row"><button className="btn btn-outline grow" type="button" onClick={onClose}>Close</button><button className="btn btn-primary grow" type="submit" disabled={busy}>Save</button></div>
			</form>
		</Sheet>
	);
}

function DeleteSheet({ onClose }: { onClose: () => void }) {
	const [confirm, setConfirm] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
	const del = async () => {
		setBusy(true); setError('');
		try { await detachDevice(); await api('/api/account/delete', { confirm }); location.href = '/signin?deleted=1'; }
		catch (e) { setError((e as Error).message); setBusy(false); }
	};
	return (
		<Sheet title="Delete your account?" onClose={onClose}>
			<p className="muted">Your profile, friends, group memberships, settings and devices are removed for good. Messages you already sent stay in their chats, shown as from a deleted account.</p>
			<div className="field"><label htmlFor="del">Type DELETE to confirm</label><input id="del" className="input" value={confirm} onChange={e => setConfirm(e.target.value)} autoCapitalize="characters" /></div>
			{error && <div className="banner error" role="alert" style={{ marginTop: 10 }}>{error}</div>}
			<div className="row" style={{ marginTop: 12 }}>
				<button className="btn btn-outline grow" type="button" onClick={onClose}>Cancel</button>
				<button className="btn btn-danger grow" type="button" disabled={busy || confirm !== 'DELETE'} onClick={() => void del()}>{busy ? 'Deleting…' : 'Delete account'}</button>
			</div>
		</Sheet>
	);
}
