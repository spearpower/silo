'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/client';
import { ErrorBanner, NavBar } from '@/components/ui';
import { LEVELS } from '@/lib/levels';
import VariantPicker from '@/components/VariantPicker';
import type { Variant } from '@/lib/card-codes';

const TIMERS = [0, 15, 30, 60];

export default function PracticePage() {
	const router = useRouter();
	const [friends, setFriends] = useState(3);
	const [timer, setTimer] = useState(0);
	const [level, setLevel] = useState<'easy' | 'normal' | 'smart'>('normal');
	const [variant, setVariant] = useState<Variant>('classic');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');

	async function start() {
		setBusy(true); setError('');
		try {
			const { id } = await api<{ id: number }>('/api/games/practice', { friends, timer, level, variant });
			router.replace(`/game/${id}`);
		} catch (e) { setError((e as Error).message); setBusy(false); }
	}

	return (
		<div className="app has-dock">
			<NavBar title="Virtual Friends" back="/" backLabel="Play" />
			<main>
				<h1 className="large-title">Practice game</h1>
				<p className="subtitle">Play right now against computer players. They follow the same rules as everyone else. Practice games don’t count towards Scores.</p>

				<div className="section-title">How many Virtual Friends?</div>
				<div className="segmented" role="radiogroup" aria-label="Number of Virtual Friends">
					{[1, 2, 3, 4, 5].map(n => (
						<label key={n}><input type="radio" name="friends" checked={friends === n} onChange={() => setFriends(n)} /><span>{n}</span></label>
					))}
				</div>
				<p className="hint">{friends + 1} players at the table, including you.</p>

				<div className="section-title">Game</div>
				<VariantPicker value={variant} onChange={setVariant} />

				<div className="section-title">How well they play</div>
				<div className="segmented" role="radiogroup" aria-label="How well Virtual Friends play">
					{LEVELS.map(l => (
						<label key={l.v}><input type="radio" name="level" checked={level === l.v} onChange={() => setLevel(l.v)} /><span>{l.label}</span></label>
					))}
				</div>
				<p className="hint">{LEVELS.find(l => l.v === level)!.note}</p>

				<div className="section-title">Your turn timer</div>
				<div className="segmented" role="radiogroup" aria-label="Turn timer">
					{TIMERS.map(t => (
						<label key={t}><input type="radio" name="timer" checked={timer === t} onChange={() => setTimer(t)} /><span>{t ? `${t}s` : 'Off'}</span></label>
					))}
				</div>
				<p className="hint">Virtual Friends take a second or two to think on each turn.</p>

				<div className="dock"><div>
					<button className="btn btn-primary" type="button" disabled={busy} onClick={start}>{busy ? 'Dealing…' : 'Start Practice Game'}</button>
					<ErrorBanner>{error}</ErrorBanner>
				</div></div>
			</main>
		</div>
	);
}
