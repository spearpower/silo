'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, avatar } from '@/lib/client';
import { ErrorBanner, NavBar, Skeleton, Chevron } from '@/components/ui';

interface MyGame { id: number; variant: string; moves: number; host: string; photo: string; players: number; my_turn: boolean }

export default function ContinuePage() {
	const [games, setGames] = useState<MyGame[] | null>(null);
	const [error, setError] = useState('');
	useEffect(() => {
		const load = () => api<{ games: MyGame[] }>('/api/games/mine').then(d => setGames(d.games)).catch(e => setError(e.message));
		load();
		const t = setInterval(load, 10000);
		return () => clearInterval(t);
	}, []);

	return (
		<div className="app">
			<NavBar title="Continue a Game" back="/" backLabel="Play" />
			<main>
				<div className="section-title">Your games in progress</div>
				{games === null ? <Skeleton rows={2} label="Loading your games" /> : games.length === 0 ? (
					<div className="empty">
						<strong>No games in progress</strong>
						Games you’re playing show up here so you can jump back in.
						<Link className="btn btn-primary" href="/join">Join a Game</Link>
					</div>
				) : (
					<div className="list">
						{games.map(g => (
							<Link key={g.id} className="list-row" href={`/game/${g.id}`}>
								<img className="av" src={avatar(g.photo)} alt="" />
								<span className="main">
									<span className="title">{g.host}’s table · Game {g.id}</span>
									<span className="sub">{g.variant === 'super' ? 'Super' : 'Classic'} · {g.players} players {g.my_turn && <span className="pill mint">Your turn</span>}</span>
								</span>
								<Chevron />
							</Link>
						))}
					</div>
				)}
				<ErrorBanner>{error}</ErrorBanner>
			</main>
		</div>
	);
}
