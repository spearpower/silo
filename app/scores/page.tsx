'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, avatar } from '@/lib/client';
import { Chevron, ErrorBanner, NavBar, Skeleton, TabBar } from '@/components/ui';

interface Row { id: number; username: string; photo: string; points: number; games: number; titles: number }
interface Champion { month: string; userId: number; username: string; photo: string; points: number; games: number }
const monthName = (m: string) => new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(m + '-15T00:00:00Z'));
interface Stats {
	user: { id: number; username: string; photo: string };
	titles: number;
	games: number; wins: number; winRate: number; avgPlace: number | null; bestStreak: number; streak: number; points: number;
	practiceGames: number; practiceWins: number;
	headToHead: { id: number; username: string; photo: string; games: number; wins: number; losses: number }[];
}
interface HistoryGame {
	id: number; status: 'finished' | 'ended'; at: string | null; variant: string; moves: number; how: string | null; practice: boolean;
	endReason: string | null; endedBy: string | null; myRank: number | null; myLeft: string | null;
	players: { id: number; username: string; photo: string; isBot: boolean; rank: number | null; points: number; cut: boolean; left: string | null }[];
	log: string[];
}
type Tab = 'board' | 'stats' | 'recent';
const TAB_KEY = 'picknplay.scoresTab';
const ordinal = (n: number) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;
const when = (iso: string | null) => (iso ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Kampala' }).format(new Date(iso)) : '');

export default function ScoresPage() {
	const [tab, setTabState] = useState<Tab>('board');
	useEffect(() => { try { const t = localStorage.getItem(TAB_KEY); if (t === 'board' || t === 'stats' || t === 'recent') setTabState(t); } catch { /* ignore */ } }, []);
	const setTab = (t: Tab) => { setTabState(t); try { localStorage.setItem(TAB_KEY, t); } catch { /* ignore */ } };
	const [player, setPlayer] = useState<number | null>(null);

	return (
		<div className="app has-tabs">
			<NavBar />
			<main>
				<h1 className="large-title">Scores</h1>
				<div className="segmented" role="tablist" aria-label="Scores" style={{ marginBottom: 16 }}>
					{([['board', 'Leaderboard'], ['stats', 'My Stats'], ['recent', 'Recent']] as const).map(([k, l]) => (
						<label key={k}><input type="radio" name="scores-tab" role="tab" aria-selected={tab === k} checked={tab === k} onChange={() => setTab(k)} /><span>{l}</span></label>
					))}
				</div>
				{tab === 'board' && <Leaderboard onPick={setPlayer} />}
				{tab === 'stats' && <StatsView />}
				{tab === 'recent' && <Recent />}
			</main>
			{player !== null && (
				<div className="sheet-backdrop" onClick={() => setPlayer(null)}>
					<div className="sheet" role="dialog" aria-modal="true" aria-label="Player stats" onClick={e => e.stopPropagation()}>
						<div className="grabber" />
						<div className="sheet-scroll"><StatsView userId={player} /></div>
						<button className="btn btn-plain" type="button" onClick={() => setPlayer(null)} style={{ marginTop: 10 }}>Close</button>
					</div>
				</div>
			)}
			<TabBar />
		</div>
	);
}

function Leaderboard({ onPick }: { onPick: (id: number) => void }) {
	const [rows, setRows] = useState<Row[] | null>(null);
	const [fame, setFame] = useState<Champion[]>([]);
	const [error, setError] = useState('');
	const month = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'Africa/Kampala' }).format(new Date());
	useEffect(() => {
		const load = () => api<{ rows: Row[]; hallOfFame: Champion[] }>('/api/scores').then(d => { setRows(d.rows); setFame(d.hallOfFame || []); }).catch(e => setError(e.message));
		load();
		const t = setInterval(load, 60000);
		return () => clearInterval(t);
	}, []);
	return (
		<>
			<p className="subtitle">{month} · tap a player to see their stats</p>
			{rows === null ? (error ? null : <Skeleton rows={4} label="Loading leaderboard" />) : rows.length === 0 ? (
				<div className="empty"><strong>No points yet this month</strong>Finish a game to get on the board.</div>
			) : (
				<div className="list">
					{rows.map((r, i) => (
						<button key={r.id} type="button" className="list-row" onClick={() => onPick(r.id)} aria-label={`${r.username}, ${r.points} points. Show stats`}>
							<span className="rank">{i + 1}</span>
							<img className="av" src={avatar(r.photo)} alt="" />
							<span className="main"><span className="title">{r.username}{r.titles > 0 && <span className="champ" title={`${r.titles}× monthly champion`}> 👑{r.titles > 1 ? `×${r.titles}` : ''}</span>}</span><span className="sub">{r.games} {r.games === 1 ? 'game' : 'games'}</span></span>
							<span className="meta"><b>{r.points}</b> pts</span>
						</button>
					))}
				</div>
			)}
			<ErrorBanner>{error}</ErrorBanner>
			<div className="section-title">Hall of Fame</div>
			{fame.length === 0 ? (
				<div className="empty"><strong>No champions yet</strong>The player with the most points at the end of each month is crowned here.</div>
			) : (
				<div className="list fame">
					{fame.map(c => (
						<button key={c.month} type="button" className="list-row" onClick={() => onPick(c.userId)} aria-label={`${monthName(c.month)} champion ${c.username}. Show stats`}>
							<span className="fame-crown" aria-hidden="true">👑</span>
							<img className="av" src={avatar(c.photo)} alt="" />
							<span className="main"><span className="title">{c.username}</span><span className="sub">{monthName(c.month)} champion</span></span>
							<span className="meta"><b>{c.points}</b> pts<br /><span className="sub">{c.games} {c.games === 1 ? 'game' : 'games'}</span></span>
						</button>
					))}
				</div>
			)}
		</>
	);
}

function StatsView({ userId }: { userId?: number }) {
	const [s, setS] = useState<Stats | null>(null);
	const [error, setError] = useState('');
	const load = useCallback(() => {
		setError('');
		api<Stats>(`/api/stats${userId ? `?user=${userId}` : ''}`).then(setS).catch(e => setError(e.message));
	}, [userId]);
	useEffect(() => { load(); }, [load]);
	if (error) return <><ErrorBanner>{error}</ErrorBanner><button className="btn btn-plain" type="button" onClick={load}>Try Again</button></>;
	if (!s) return <Skeleton rows={3} label="Loading stats" />;
	return (
		<>
			<div className="stats-head">
				<img className="avatar" src={avatar(s.user.photo)} alt="" />
				<div><div className="name">{s.user.username}{s.titles > 0 && <span className="champ"> 👑</span>}</div><div className="sub">{s.titles > 0 ? `${s.titles}× monthly champion · ` : ''}{s.points} leaderboard points all time</div></div>
			</div>
			{s.games === 0 && s.practiceGames === 0 ? (
				<div className="empty"><strong>No finished games yet</strong>Stats appear after the first game is played to the end.</div>
			) : (
				<>
					<div className="stat-grid">
						<div className="stat"><div className="v">{s.games}</div><div className="k">Games</div></div>
						<div className="stat"><div className="v">{s.wins}</div><div className="k">Wins</div></div>
						<div className="stat"><div className="v">{s.winRate}%</div><div className="k">Win rate</div></div>
						<div className="stat"><div className="v">{s.avgPlace ?? '—'}</div><div className="k">Average place</div></div>
						<div className="stat"><div className="v">{s.bestStreak}</div><div className="k">Best win streak</div></div>
						<div className="stat"><div className="v">{s.streak}</div><div className="k">Current streak</div></div>
					</div>
					<p className="hint">Games with people only. Practice with Virtual Friends: {s.practiceGames} {s.practiceGames === 1 ? 'game' : 'games'}, {s.practiceWins} {s.practiceWins === 1 ? 'win' : 'wins'}.</p>
					<div className="section-title">Head to head</div>
					{s.headToHead.length === 0 ? (
						<div className="empty"><strong>No opponents yet</strong>Finish a game with friends to compare.</div>
					) : (
						<div className="list">
							{s.headToHead.map(o => (
								<div key={o.id} className="list-row">
									<img className="av" src={avatar(o.photo)} alt="" />
									<span className="main"><span className="title">vs {o.username}</span><span className="sub">{o.games} {o.games === 1 ? 'game' : 'games'} together</span></span>
									<span className="meta h2h" aria-label={`${o.wins} ahead, ${o.losses} behind`}><b className="w">{o.wins}</b>–<b className="l">{o.losses}</b></span>
								</div>
							))}
						</div>
					)}
					<p className="hint">Ahead–behind: how often {userId ? 'they' : 'you'} finished above or below each player.</p>
				</>
			)}
		</>
	);
}

function Recent() {
	const [games, setGames] = useState<HistoryGame[] | null>(null);
	const [error, setError] = useState('');
	const [open, setOpen] = useState<number | null>(null);
	useEffect(() => { api<{ games: HistoryGame[] }>('/api/history').then(d => setGames(d.games)).catch(e => setError(e.message)); }, []);
	if (error) return <ErrorBanner>{error}</ErrorBanner>;
	if (!games) return <Skeleton rows={4} label="Loading recent games" />;
	if (!games.length) return <div className="empty"><strong>No games yet</strong>Finished and ended games show up here.</div>;
	return (
		<div className="list">
			{games.map(g => {
				const winner = g.status === 'finished' ? g.players.find(p => p.rank === 1) : null;
				const result = g.myLeft ? 'You left' : g.status === 'ended' ? 'Ended' : g.myRank === 1 ? 'You won' : g.myRank ? `${ordinal(g.myRank)} place` : '—';
				const isOpen = open === g.id;
				return (
					<div key={g.id} className={`history${isOpen ? ' open' : ''}`}>
						<button type="button" className="list-row" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : g.id)}>
							<span className={`result-dot${g.myRank === 1 && !g.myLeft ? ' win' : g.status === 'ended' || g.myLeft ? ' off' : ''}`} aria-hidden="true">{g.myRank === 1 && !g.myLeft ? '👑' : g.myRank && !g.myLeft ? g.myRank : '–'}</span>
							<span className="main">
								<span className="title">{result} · Game {g.id}</span>
								<span className="sub">{when(g.at)} · {g.players.length} players{g.practice ? ' · practice' : ''}{winner ? ` · ${winner.username} won` : ''}</span>
							</span>
							<Chevron />
						</button>
						{isOpen && (
							<div className="history-detail">
								{g.status === 'ended' && <p className="footnote">Ended{g.endedBy ? ` by ${g.endedBy}` : ''} · {g.endReason || 'no reason given'}. No leaderboard points.</p>}
								<table className="standings"><thead><tr><th>#</th><th>Player</th><th>Hand</th></tr></thead><tbody>
									{g.players.map(p => (
										<tr key={p.id}>
											<td>{p.rank ?? '–'}</td>
											<td>{p.username}{p.isBot ? ' 🤖' : ''}{p.cut ? ' ✂️' : ''}{p.left ? <span className="left-note"> · left ({p.left})</span> : null}</td>
											<td>{p.points} pts</td>
										</tr>
									))}
								</tbody></table>
								{g.log.length > 0 && <>
									<div className="section-title" style={{ marginTop: 10 }}>Last moves</div>
									<ul className="log">{g.log.map((l, i) => <li key={i}>{l}</li>)}</ul>
								</>}
								<p className="hint">{g.variant === 'super' ? 'PicknPlay Super' : 'PicknPlay Classic'} · {g.moves} cards played{g.how === 'cut' ? ' · ended by a cut' : g.how === 'out' ? ' · won by going out' : ''}</p>
							</div>
						)}
					</div>
				);
			})}
		</div>
	);
}
