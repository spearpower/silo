'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/client';
import { ErrorBanner, NavBar } from '@/components/ui';
import VariantPicker from '@/components/VariantPicker';
import type { Variant } from '@/lib/card-codes';

export default function HostPage() {
	const router = useRouter();
	const [pin, setPin] = useState('');
	const [variant, setVariant] = useState<Variant>('classic');
	const [timer, setTimer] = useState(30);
	const [error, setError] = useState('');
	const [busy, setBusy] = useState(false);

	async function create(e: React.FormEvent) {
		e.preventDefault();
		if (pin && !/^\d{4}$/.test(pin)) { setError('The PIN must be 4 digits, or leave it empty.'); return; }
		setBusy(true); setError('');
		try {
			const { id } = await api<{ id: number }>('/api/games', { pin, timer, variant });
			router.replace(`/lobby/${id}`);
		} catch (err) { setError((err as Error).message); setBusy(false); }
	}

	return (
		<div className="app has-dock">
			<NavBar title="Host a Game" back="/" backLabel="Play" />
			<main>
				<form onSubmit={create} noValidate>
					<h1 className="large-title">New table</h1>
					<p className="subtitle">You’ll get a game number and a link to share with friends.</p>
					<div className="section-title">Who can join</div>
					<div className="fields">
						<div className="field">
							<label htmlFor="pin">PIN (optional)</label>
							<input id="pin" value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="No PIN — anyone can join" inputMode="numeric" pattern="[0-9]*" maxLength={4} autoComplete="off" />
						</div>
					</div>
					<p className="hint">Add a 4-digit PIN to make the game private.</p>
					<div className="section-title">Game</div>
					<VariantPicker value={variant} onChange={setVariant} />
					<p className="hint"><a href="/how-to-play" style={{ color: 'var(--gold)' }}>How to play Classic and Super</a></p>
					<div className="section-title">Turn timer</div>
					<div className="segmented" role="radiogroup" aria-label="Turn timer">
						{[15, 30, 60, 0].map(t => <label key={t}><input type="radio" name="timer" checked={timer === t} onChange={() => setTimer(t)} /><span>{t ? `${t} s` : 'None'}</span></label>)}
					</div>
					<p className="hint">When time runs out, a card is drawn for that player and play moves on. You can change it in the waiting room.</p>
					<div className="dock"><div>
						<button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create Game'}</button>
						<ErrorBanner>{error}</ErrorBanner>
					</div></div>
				</form>
			</main>
		</div>
	);
}
