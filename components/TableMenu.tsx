'use client';
// Table options: leave the game (anyone), remove a player / end the game (host or super admin).
// Every action asks for a reason; "Others" lets people type their own.
import { useState } from 'react';
import { api, avatar } from '@/lib/client';
import HowToPlay from './HowToPlay';

export const LEAVE_REASONS = ['Back to work', 'Family', 'Internet', 'Visitor'];
export const REMOVE_REASONS = ['Not responding', 'Left the table', 'Unfair play'];
export const END_REASONS = ['Time’s up', 'Players left', 'Network problems', 'Starting a new game'];

interface Person { id: number; username: string; photo: string; isBot?: boolean; left?: boolean }
type Step = { kind: 'menu' } | { kind: 'pick' } | { kind: 'rules' } | { kind: 'reason'; action: 'leave' | 'remove' | 'end'; target?: Person };

export default function TableMenu({ gameId, me, canManage, players, inGame, onClose, onDone, variant = 'classic' }: {
	gameId: number; me: number; canManage: boolean; players: Person[]; inGame: boolean; variant?: 'classic' | 'super';
	onClose: () => void; onDone: (what: 'left' | 'removed' | 'ended') => void;
}) {
	const [step, setStep] = useState<Step>({ kind: 'menu' });
	const others = players.filter(p => p.id !== me && !p.left);
	return (
		<div className="sheet-backdrop" onClick={onClose}>
			<div className="sheet" role="dialog" aria-modal="true" aria-label="Table options" onClick={e => e.stopPropagation()}>
				<div className="grabber" />
				{step.kind === 'menu' && (
					<>
						<h2>Table options</h2>
						<div className="list" style={{ marginTop: 12 }}>
							<button type="button" className="list-row" onClick={() => setStep({ kind: 'rules' })}>
								<span className="opt-ico" aria-hidden="true">📖</span>
								<span className="main"><span className="title">How to play</span><span className="sub">Matching, special cards, cutting and scoring</span></span>
							</button>
							{inGame && (
								<button type="button" className="list-row" onClick={() => setStep({ kind: 'reason', action: 'leave' })}>
									<span className="opt-ico" aria-hidden="true">🚪</span>
									<span className="main"><span className="title">Leave game</span><span className="sub">Your cards go back into the draw pile</span></span>
								</button>
							)}
							{canManage && others.length > 0 && (
								<button type="button" className="list-row" onClick={() => setStep({ kind: 'pick' })}>
									<span className="opt-ico" aria-hidden="true">👤</span>
									<span className="main"><span className="title">Remove a player</span><span className="sub">Take someone out of this game</span></span>
								</button>
							)}
							{canManage && (
								<button type="button" className="list-row" onClick={() => setStep({ kind: 'reason', action: 'end' })}>
									<span className="opt-ico" aria-hidden="true">⏹</span>
									<span className="main"><span className="title danger-text">End game for everyone</span><span className="sub">No leaderboard points are given</span></span>
								</button>
							)}
						</div>
						<button className="btn btn-plain" type="button" onClick={onClose} style={{ marginTop: 10 }}>Cancel</button>
					</>
				)}
				{step.kind === 'pick' && (
					<>
						<h2>Remove a player</h2>
						<p className="subtitle center">Who should leave this game?</p>
						<div className="list">
							{others.map(p => (
								<button key={p.id} type="button" className="list-row" onClick={() => setStep({ kind: 'reason', action: 'remove', target: p })}>
									<img className="av" src={avatar(p.photo)} alt="" />
									<span className="main"><span className="title">{p.username}</span>{p.isBot && <span className="sub">Virtual Friend</span>}</span>
								</button>
							))}
						</div>
						<button className="btn btn-plain" type="button" onClick={() => setStep({ kind: 'menu' })} style={{ marginTop: 10 }}>Back</button>
					</>
				)}
				{step.kind === 'rules' && (
					<>
						<h2>How to play</h2>
						<div className="sheet-scroll"><HowToPlay variant={variant} /></div>
						<button className="btn btn-plain" type="button" onClick={() => setStep({ kind: 'menu' })} style={{ marginTop: 10 }}>Back</button>
					</>
				)}
				{step.kind === 'reason' && (
					<ReasonForm gameId={gameId} action={step.action} target={step.target}
						onBack={() => setStep(step.action === 'remove' ? { kind: 'pick' } : { kind: 'menu' })}
						onDone={() => onDone(step.action === 'leave' ? 'left' : step.action === 'remove' ? 'removed' : 'ended')} />
				)}
			</div>
		</div>
	);
}

function ReasonForm({ gameId, action, target, onBack, onDone }: {
	gameId: number; action: 'leave' | 'remove' | 'end'; target?: Person; onBack: () => void; onDone: () => void;
}) {
	const reasons = action === 'leave' ? LEAVE_REASONS : action === 'remove' ? REMOVE_REASONS : END_REASONS;
	const [choice, setChoice] = useState('');
	const [other, setOther] = useState('');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const reason = choice === 'Others' ? other.trim() : choice;
	const title = action === 'leave' ? 'Leave this game?' : action === 'remove' ? `Remove ${target?.username}?` : 'End the game for everyone?';
	const note = action === 'leave' ? 'Your cards go back into the draw pile and the others play on. You can’t rejoin this game.'
		: action === 'remove' ? 'Their cards go back into the deck and the game carries on without them.'
		: 'Everyone goes back to Play. No leaderboard points are given for this game.';
	const confirm = action === 'leave' ? 'Leave Game' : action === 'remove' ? 'Remove Player' : 'End Game';

	async function go() {
		if (!reason) { setError('Choose a reason'); return; }
		setBusy(true); setError('');
		try {
			if (action === 'leave') await api(`/api/games/${gameId}/leave`, { reason });
			else if (action === 'remove') await api(`/api/games/${gameId}/kick`, { userId: target!.id, reason });
			else await api(`/api/games/${gameId}/end`, { reason });
			onDone();
		} catch (e) { setError((e as Error).message); setBusy(false); }
	}

	return (
		<>
			<h2>{title}</h2>
			<p className="subtitle center">{note}</p>
			<div className="section-title" style={{ marginTop: 8 }}>Reason</div>
			<div className="reason-list" role="radiogroup" aria-label="Reason">
				{[...reasons, 'Others'].map(r => (
					<label key={r} className={choice === r ? 'on' : ''}>
						<input type="radio" name="reason" checked={choice === r} onChange={() => setChoice(r)} />
						<span>{r}</span>
					</label>
				))}
			</div>
			{choice === 'Others' && (
				<div className="fields" style={{ marginTop: 10 }}>
					<div className="field"><label htmlFor="other-reason">Your reason</label>
						<input id="other-reason" value={other} onChange={e => setOther(e.target.value)} maxLength={80} placeholder="Type a short reason" autoFocus /></div>
				</div>
			)}
			{error && <div className="error-banner" role="alert">{error}</div>}
			<div style={{ marginTop: 16 }}>
				<button className="btn btn-danger-solid" type="button" disabled={busy || !reason} onClick={go}>{busy ? 'Please wait…' : confirm}</button>
				<button className="btn btn-plain" type="button" onClick={onBack} disabled={busy}>Back</button>
			</div>
		</>
	);
}
