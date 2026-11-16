'use client';
// Admin: live games and open tables, with people and/or Virtual Friends. Watch any of them; the super admin can also manage.
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, avatar } from '@/lib/client';
import { ErrorBanner, NavBar, Skeleton } from '@/components/ui';
import { variantInfo } from '@/lib/rules';

interface Table {
	id: number; status: 'lobby' | 'playing'; private: boolean; variant: string; host: string; moves: number; timer_sec: number;
	updated_at: string; created_at: string; with_bots: boolean; people: number; stale: boolean;
	players: { id: number; username: string; photo: string; isBot: boolean }[]; turn: string | null;
}
interface Live { superAdmin: boolean; staleHours: number; serverNow: string; tables: Table[] }
type Tab = 'playing' | 'lobby';
type Filter = 'all' | 'people' | 'bots';

const ago = (iso: string, now: string) => {
	const m = Math.max(0, Math.round((new Date(now).getTime() - new Date(iso).getTime()) / 60000));
	return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};

export default function TablesPage() {
	const [live, setLive] = useState<Live | null>(null);
	const [tab, setTab] = useState<Tab>('playing');
	const [filter, setFilter] = useState<Filter>('all');
	const [error, setError] = useState('');
	const [note, setNote] = useState('');
	const [busy, setBusy] = useState(false);
	const load = useCallback(() => api<Live>('/api/admin/games').then(d => { setLive(d); setError(''); }).catch(e => setError(e.message)), []);
	useEffect(() => { load(); const t = setInterval(load, 10000); return () => clearInterval(t); }, [load]);

	const all = live?.tables || [];
	const count = (s: Tab) => all.filter(t => t.status === s).length;
	const shown = all.filter(t => t.status === tab && (filter === 'all' || (filter === 'bots' ? t.with_bots : !t.with_bots)));
	const stale = all.filter(t => t.stale).length;

	return (
		<div className="app">
			<NavBar title="Tables" back="/admin" backLabel="Admin" />
			<main>
				<h1 className="large-title">Tables</h1>
				<div className="segmented" role="tablist" aria-label="Tables" style={{ marginBottom: 8 }}>
					<label><input type="radio" name="tab" checked={tab === 'playing'} onChange={() => setTab('playing')} /><span>Live games · {count('playing')}</span></label>
					<label><input type="radio" name="tab" checked={tab === 'lobby'} onChange={() => setTab('lobby')} /><span>Open tables · {count('lobby')}</span></label>
				</div>
				<div className="chips" role="radiogroup" aria-label="Who is playing">
					{([['all', 'All'], ['people', 'People only'], ['bots', 'With Virtual Friends']] as const).map(([k, l]) => (
						<label key={k} className={filter === k ? 'on' : ''}><input type="radio" name="filter" checked={filter === k} onChange={() => setFilter(k)} /><span>{l}</span></label>
					))}
				</div>

				{!live && !error ? <Skeleton rows={3} label="Loading tables" /> : live && shown.length === 0 ? (
					<div className="empty"><strong>{tab === 'playing' ? 'No games being played' : 'No open tables'}</strong>{filter === 'all' ? 'They appear here as soon as someone starts one.' : 'Try another filter.'}</div>
				) : live && (
					<div className="list">
						{shown.map(t => (
							<div key={t.id} className="list-row live-row">
								<span className="main">
									<span className="title">
										Game {t.id}{t.status === 'playing' ? ` · ${t.moves} cards played` : ''}
										{t.with_bots && <span className="badge pill vf">Virtual Friends</span>}
										{t.private && <span className="badge pill">PIN</span>}
										{t.stale && <span className="badge pill orange">Stuck</span>}
									</span>
									<span className="sub">
										{variantInfo(t.variant).name} · host {t.host} · {t.people} {t.people === 1 ? 'person' : 'people'} · {t.status === 'playing' ? `last move ${ago(t.updated_at, live.serverNow)}` : `opened ${ago(t.created_at, live.serverNow)}`}
										{t.turn ? ` · ${t.turn}’s turn` : ''}
									</span>
									<span className="avs">{t.players.map(p => <img key={p.id} src={avatar(p.photo)} alt={p.username} title={p.username + (p.isBot ? ' (Virtual Friend)' : '')} className={p.isBot ? 'bot' : ''} />)}</span>
								</span>
								<Link className="icon-btn" href={t.status === 'playing' ? `/game/${t.id}` : `/lobby/${t.id}`}>{t.status === 'playing' ? (live.superAdmin ? 'Watch · Manage' : 'Watch') : 'View'}</Link>
							</div>
						))}
					</div>
				)}
				<p className="hint">Watching shows the table as the players see it, never anyone’s hand.{live?.superAdmin ? ' As super admin you can also remove players or end a game from there.' : ''}</p>

				<div className="section-title">Stuck games</div>
				<p className="hint" style={{ marginTop: 0 }}>Games with no moves for {live?.staleHours ?? 24} hours are closed automatically every day: waiting rooms are cancelled, and games are ended with no leaderboard points. {stale ? `${stale} ${stale === 1 ? 'game is' : 'games are'} stuck right now.` : 'Nothing is stuck right now.'}</p>
				<button className="btn btn-plain" type="button" disabled={busy} onClick={async () => {
					setBusy(true); setNote(''); setError('');
					try {
						const r = await api<{ lobbies: number; games: number }>('/api/admin/games', { cleanup: true });
						setNote(r.lobbies + r.games ? `Closed ${r.games} ${r.games === 1 ? 'game' : 'games'} and ${r.lobbies} waiting ${r.lobbies === 1 ? 'room' : 'rooms'}.` : 'Nothing needed closing.');
						await load();
					} catch (e) { setError((e as Error).message); } finally { setBusy(false); }
				}}>{busy ? 'Checking…' : 'Close Stuck Games Now'}</button>
				{note && <div className="ok-banner" role="status">{note}</div>}
				<ErrorBanner>{error}</ErrorBanner>
			</main>
		</div>
	);
}
