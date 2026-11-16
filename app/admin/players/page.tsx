'use client';
// Admin: find players, reset passwords, suspend / reactivate, and (super admin) change roles.
import { useCallback, useEffect, useState } from 'react';
import { api, avatar } from '@/lib/client';
import { ErrorBanner, NavBar, Skeleton } from '@/components/ui';

interface Player {
	id: number; username: string; fullname: string; role: 'player' | 'admin' | 'superadmin'; status: string; photo: string;
	email: string | null; phone: string | null; lastSeen: string | null; joined: string; games: number; mustChange: boolean;
}

const ago = (iso: string | null) => {
	if (!iso) return 'never';
	const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
	return m < 2 ? 'online now' : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};
const ROLE_LABEL = { player: 'Player', admin: 'Admin', superadmin: 'Super admin' };

export default function PlayersPage() {
	const [q, setQ] = useState('');
	const [players, setPlayers] = useState<Player[] | null>(null);
	const [myRole, setMyRole] = useState<Player['role']>('player');
	const [me, setMe] = useState(0);
	const [error, setError] = useState('');
	const [open, setOpen] = useState<Player | null>(null);

	const load = useCallback(async (term: string) => {
		try {
			const d = await api<{ players: Player[]; myRole: Player['role']; me: number }>(`/api/admin/players?q=${encodeURIComponent(term)}`);
			setPlayers(d.players); setMyRole(d.myRole); setMe(d.me); setError('');
		} catch (e) { setError((e as Error).message); }
	}, []);
	useEffect(() => { const t = setTimeout(() => load(q), q ? 250 : 0); return () => clearTimeout(t); }, [q, load]);

	return (
		<div className="app">
			<NavBar title="Players" back="/admin" backLabel="Admin" />
			<main>
				<h1 className="large-title">Players</h1>
				<div className="fields" style={{ marginBottom: 12 }}>
					<div className="field"><label htmlFor="q">Search</label>
						<input id="q" type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Username or name" autoComplete="off" enterKeyHint="search" /></div>
				</div>
				{players === null ? (error ? null : <Skeleton rows={5} label="Loading players" />) : players.length === 0 ? (
					<div className="empty"><strong>No players found</strong>Try another name.</div>
				) : (
					<div className="list">
						{players.map(p => (
							<button key={p.id} type="button" className="list-row" onClick={() => setOpen(p)} aria-label={`${p.username}, ${ROLE_LABEL[p.role]}, ${p.status}. Open`}>
								<img className="av" src={avatar(p.photo)} alt="" />
								<span className="main">
									<span className="title">{p.username}{p.id === me ? ' (you)' : ''}</span>
									<span className="sub">{p.fullname || 'No name'} · {ago(p.lastSeen)} · {p.games} {p.games === 1 ? 'game' : 'games'}</span>
								</span>
								<span className="meta">
									{p.status !== 'active' && <span className="badge pill orange">Suspended</span>}
									{p.role !== 'player' && <span className="badge pill role">{ROLE_LABEL[p.role]}</span>}
									{p.mustChange && <span className="badge pill">Reset</span>}
								</span>
							</button>
						))}
					</div>
				)}
				<ErrorBanner>{error}</ErrorBanner>
			</main>
			{open && <PlayerSheet p={open} myRole={myRole} isMe={open.id === me} onClose={() => setOpen(null)} onChanged={() => load(q)} />}
		</div>
	);
}

function PlayerSheet({ p, myRole, isMe, onClose, onChanged }: { p: Player; myRole: Player['role']; isMe: boolean; onClose: () => void; onChanged: () => void }) {
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const [temp, setTemp] = useState<string | null>(null);
	const [status, setStatus] = useState(p.status);
	const [role, setRole] = useState(p.role);
	const [copied, setCopied] = useState(false);
	const canAct = !isMe && (myRole === 'superadmin' || p.role === 'player');

	const act = async (action: string, extra: Record<string, unknown> = {}) => {
		setBusy(true); setError('');
		try {
			const r = await api<{ temporary?: string }>(`/api/admin/players/${p.id}`, { action, ...extra });
			if (r.temporary) setTemp(r.temporary);
			if (action === 'suspend') setStatus('suspended');
			if (action === 'reactivate') setStatus('active');
			if (action === 'role') setRole(extra.role as Player['role']);
			onChanged();
		} catch (e) { setError((e as Error).message); } finally { setBusy(false); }
	};

	return (
		<div className="sheet-backdrop" onClick={onClose}>
			<div className="sheet" role="dialog" aria-modal="true" aria-label={`Player ${p.username}`} onClick={e => e.stopPropagation()}>
				<div className="grabber" />
				<div className="stats-head">
					<img className="avatar" src={avatar(p.photo)} alt="" />
					<div><div className="name">{p.username}</div><div className="sub">{ROLE_LABEL[role]} · {status === 'active' ? 'Active' : 'Suspended'}</div></div>
				</div>
				<div className="list kv">
					<div className="list-row"><span className="main"><span className="sub">Name</span><span className="title">{p.fullname || 'Not given'}</span></span></div>
					<div className="list-row"><span className="main"><span className="sub">Email · Phone</span><span className="title">{p.email || 'No email'} · {p.phone || 'No phone'}</span></span></div>
					<div className="list-row"><span className="main"><span className="sub">Last seen · Joined</span><span className="title">{ago(p.lastSeen)} · {new Date(p.joined).toLocaleDateString()}</span></span></div>
					<div className="list-row"><span className="main"><span className="sub">Games</span><span className="title">{p.games}</span></span></div>
				</div>

				{temp && (
					<div className="temp-pass" role="status">
						<div>Temporary password for <b>{p.username}</b>:</div>
						<div className="code">{temp}</div>
						<div className="hint" style={{ margin: 0 }}>Send it to them privately. They’ll choose a new password when they sign in. It’s shown only once.</div>
						<button type="button" className="icon-btn" onClick={async () => { try { await navigator.clipboard.writeText(temp); setCopied(true); } catch { /* ignore */ } }}>{copied ? 'Copied' : 'Copy'}</button>
					</div>
				)}

				{canAct ? (
					<div style={{ marginTop: 14 }}>
						<button className="btn btn-primary" type="button" disabled={busy} onClick={() => act('reset')}>Reset Password</button>
						{status === 'active'
							? <button className="btn btn-danger" type="button" disabled={busy} onClick={() => { if (confirm(`Suspend ${p.username}? They’ll be signed out within a minute and can’t sign in.`)) act('suspend'); }}>Suspend</button>
							: <button className="btn btn-plain" type="button" disabled={busy} onClick={() => act('reactivate')}>Reactivate</button>}
						{myRole === 'superadmin' && role !== 'superadmin' && (
							role === 'admin'
								? <button className="btn btn-plain" type="button" disabled={busy} onClick={() => act('role', { role: 'player' })}>Remove Admin Role</button>
								: <button className="btn btn-plain" type="button" disabled={busy} onClick={() => act('role', { role: 'admin' })}>Make Admin</button>
						)}
					</div>
				) : (
					<p className="hint">{isMe ? 'This is you. Use your Account page to change your own details.' : 'Only the super admin can change another admin.'}</p>
				)}
				<ErrorBanner>{error}</ErrorBanner>
				<button className="btn btn-plain" type="button" onClick={onClose} style={{ marginTop: 6 }}>Close</button>
			</div>
		</div>
	);
}
