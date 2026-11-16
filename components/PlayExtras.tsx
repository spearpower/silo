'use client';
// Play page extras: table invites from friends, friend-request nudge, and the "turn alerts" offer.
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, avatar } from '@/lib/client';
import { enablePush, pushState, type PushState } from '@/lib/pushClient';

interface Invite { id: number; gameId: number; from: { id: number; username: string; photo: string }; players: number }
interface View { invites: Invite[]; incoming: { id: number }[] }
const DISMISS = 'picknplay.alertsAsked';

export default function PlayExtras() {
	const router = useRouter();
	const [v, setV] = useState<View | null>(null);
	const [busy, setBusy] = useState(0);
	const [error, setError] = useState('');
	const [alerts, setAlerts] = useState<PushState | null>(null);
	const [askAlerts, setAskAlerts] = useState(false);

	const load = useCallback(() => api<View>('/api/friends').then(setV).catch(() => {}), []);
	useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);
	useEffect(() => {
		pushState().then(s => {
			setAlerts(s);
			let played = false, asked = false;
			try { played = localStorage.getItem('picknplay.playedOnce') === '1'; asked = localStorage.getItem(DISMISS) === '1'; } catch { /* ignore */ }
			setAskAlerts(played && !asked && (s === 'off' || s === 'ios-install'));
		}).catch(() => {});
	}, []);

	const answer = async (inv: Invite, accept: boolean) => {
		setBusy(inv.id); setError('');
		try {
			const r = await api<{ gameId: number }>(`/api/invites/${inv.id}`, { accept });
			if (accept) router.push(`/lobby/${r.gameId}`); else { await load(); setBusy(0); }
		} catch (e) { setError((e as Error).message); setBusy(0); await load(); }
	};
	const closeAsk = () => { setAskAlerts(false); try { localStorage.setItem(DISMISS, '1'); } catch { /* ignore */ } };

	return (
		<>
			{v?.invites.map(inv => (
				<div key={inv.id} className="invite-card" role="status">
					<img src={avatar(inv.from.photo)} alt="" />
					<div className="txt"><b>{inv.from.username}</b> invited you to play<br /><span>Table {inv.gameId} · {inv.players} {inv.players === 1 ? 'player' : 'players'} waiting</span></div>
					<div className="btns">
						<button type="button" className="icon-btn gold" disabled={busy === inv.id} onClick={() => answer(inv, true)}>Join</button>
						<button type="button" className="icon-btn" disabled={busy === inv.id} onClick={() => answer(inv, false)} aria-label="Decline">✕</button>
					</div>
				</div>
			))}
			{v && v.incoming.length > 0 && (
				<Link href="/friends" className="nudge">👋 {v.incoming.length} friend {v.incoming.length === 1 ? 'request' : 'requests'} waiting</Link>
			)}
			{askAlerts && (
				<div className="invite-card alerts" role="dialog" aria-label="Turn alerts">
					<span className="big" aria-hidden="true">🔔</span>
					<div className="txt"><b>Get a buzz when it’s your turn</b><br /><span>{alerts === 'ios-install' ? 'On iPhone: tap Share → Add to Home Screen, open PicknPlay from there, then turn alerts on in Account.' : 'Also when a friend invites you or a game starts.'}</span></div>
					<div className="btns">
						{alerts === 'off' && <button type="button" className="icon-btn gold" onClick={async () => { try { setAlerts(await enablePush()); } catch (e) { setError((e as Error).message); } closeAsk(); }}>Turn On</button>}
						<button type="button" className="icon-btn" onClick={closeAsk} aria-label="Not now">✕</button>
					</div>
				</div>
			)}
			{error && <div className="error-banner" role="alert">{error}</div>}
		</>
	);
}
