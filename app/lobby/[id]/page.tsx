'use client';
import Link from 'next/link';
import { use, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, avatar, useGame } from '@/lib/client';
import { ErrorBanner, NavBar, Skeleton } from '@/components/ui';
import PinSheet from '@/components/PinSheet';
import { LEVELS } from '@/lib/levels';
import { variantInfo } from '@/lib/rules';
import InviteFriends from '@/components/InviteFriends';
import VoiceChat from '@/components/VoiceChat';

const TIMERS = [0, 15, 20, 30, 40, 60];

export default function LobbyPage({ params }: { params: Promise<{ id: string }> }) {
	const id = Number(use(params).id);
	const router = useRouter();
	const { data, error: loadError, refresh } = useGame(id);
	const [timer, setTimer] = useState(-1);
	const [level, setLevel] = useState<'easy' | 'normal' | 'smart'>('normal');
	const [error, setError] = useState('');
	const [busy, setBusy] = useState(false);
	const [pinOpen, setPinOpen] = useState(false);
	const [inviteOpen, setInviteOpen] = useState(false);
	const [copied, setCopied] = useState(false);
	const [vfOn, setVfOn] = useState(false);
	const [voiceOn, setVoiceOn] = useState(false);
	useEffect(() => { api<{ virtualFriends: boolean; voiceChat: boolean }>('/api/settings').then(s => { setVfOn(s.virtualFriends); setVoiceOn(!!s.voiceChat); }).catch(() => {}); }, []);

	// Quick Game: if nobody joins within 30 s, fill the empty seats with Virtual Friends and start
	const [quick, setQuick] = useState(false);
	const [countdown, setCountdown] = useState<number | null>(null);
	const quickAt = useRef<number | null>(null);
	const quickFired = useRef(false);
	useEffect(() => { setQuick(new URLSearchParams(location.search).get('quick') === '1'); }, []);
	const someoneJoined = !!data && data.players.some(p => p.id !== data.me && !p.isBot);
	const quickOn = quick && vfOn && !!data && data.status === 'lobby' && data.me === data.hostId && !someoneJoined;
	useEffect(() => {
		if (!quickOn) { setCountdown(null); return; }
		if (quickAt.current === null) quickAt.current = Date.now() + 30000;
		const tick = () => {
			const left = Math.max(0, Math.ceil((quickAt.current! - Date.now()) / 1000));
			setCountdown(left);
			if (left === 0 && !quickFired.current) {
				quickFired.current = true;
				api(`/api/games/${id}/quickstart`, {}).then(() => router.replace(`/game/${id}`)).catch(e => { setError((e as Error).message); quickFired.current = false; setQuick(false); });
			}
		};
		tick();
		const t = setInterval(tick, 250);
		return () => clearInterval(t);
	}, [quickOn, id, router]);

	useEffect(() => { if (data?.status === 'playing' && data.isMember) router.replace(`/game/${id}`); }, [data, id, router]);
	useEffect(() => { if (data) setTimer(t => (t === -1 ? data.timerSec : t)); }, [data]);

	if (!data) return (
		<div className="app"><NavBar title="Waiting Room" back="/" backLabel="Play" />
			<main>{loadError ? <ErrorBanner>{loadError}</ErrorBanner> : <Skeleton rows={2} label="Loading table" />}</main></div>
	);

	const myId = data.me;
	const isHost = myId === data.hostId;
	const act = async (fn: () => Promise<unknown>) => { setBusy(true); setError(''); try { await fn(); await refresh(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };

	if (data.status === 'abandoned') return (
		<div className="app"><NavBar title="Waiting Room" back="/" backLabel="Play" />
			<main><div className="empty"><strong>This table was closed</strong>The host cancelled this game.<Link className="btn btn-primary" href="/join">Find Another Table</Link></div></main></div>
	);

	const inviteText = () => `Join my PicknPlay table — game ${id}${data.pin ? `, PIN ${data.pin}` : ''}`;
	const whatsapp = () => {
		const url = `${location.origin}/lobby/${id}`;
		window.open(`https://wa.me/?text=${encodeURIComponent(`${inviteText()}: ${url}`)}`, '_blank', 'noopener');
	};
	const invite = async () => {
		const url = `${location.origin}/lobby/${id}`;
		const text = inviteText();
		try {
			if (navigator.share) await navigator.share({ title: 'PicknPlay', text, url });
			else { await navigator.clipboard.writeText(`${text}: ${url}`); setCopied(true); setTimeout(() => setCopied(false), 2500); }
		} catch { /* share cancelled */ }
	};

	return (
		<div className="app has-dock">
			<NavBar title="Waiting Room" back="/" backLabel="Play" trailing={<button type="button" onClick={invite}>{copied ? 'Copied' : 'Invite'}</button>} />
			<main>
				<div className="lobby-head">
					<div className="stat"><div className="k">Game number</div><div className="v">{id}</div></div>
					<div className="stat"><div className="k">Game</div><div className="v" style={{ fontSize: 20 }}>{variantInfo(data.variant).short}</div></div>
					<div className="stat"><div className="k">PIN</div><div className="v">{data.isMember ? (data.pin || <span className="code-none">None</span>) : (data.private ? '••••' : <span className="code-none">None</span>)}</div></div>
				</div>
				{countdown !== null && (
					<div className="quick-wait" role="status">
						<div className="ring" style={{ ['--p' as string]: `${(countdown / 30) * 100}%` }}><span>{countdown}</span></div>
						<div className="txt"><b>Looking for players…</b><br />Virtual Friends fill the empty seats in {countdown}s and the game starts.</div>
						<button type="button" className="icon-btn" onClick={() => setQuick(false)}>Wait</button>
					</div>
				)}
				<p className="footnote" role="status">
					{!data.isMember ? 'You’re not at this table yet.' : isHost ? 'Share the game number or tap Invite. You need at least 2 players.' : 'You’re in. The game starts when the host taps Start.'}
				</p>

				<div className="section-title">Players · {data.players.length}/6</div>
				<div className="list" aria-live="polite">
					{data.players.map(p => (
						<div className="list-row lobby-seat" key={p.id} data-seat={p.id}>
							<img className="av" src={avatar(p.photo)} alt="" />
							<span className="main">
								<span className="title">{p.username}{p.id === myId ? ' (you)' : ''}</span>
								<span className="sub">{p.isBot ? <span className="vf-badge">Virtual Friend</span> : <>{p.id === data.hostId ? 'Host' : 'Player'} · {p.online ? 'Here' : 'Away'}</>}</span>
							</span>
							<span className={`dot${p.online ? ' on' : ''}`} aria-hidden="true" />
							{(isHost || data.canManage) && p.id !== myId && (
								<button className="icon-btn danger" type="button" disabled={busy} aria-label={`Remove ${p.username}`}
									onClick={() => act(() => api(`/api/games/${id}/kick`, { userId: p.id }))}>Remove</button>
							)}
						</div>
					))}
					{isHost && vfOn && data.players.length < 6 && (
						<button className="list-row" type="button" disabled={busy} onClick={() => act(() => api(`/api/games/${id}/friends`, {}))}>
							<span className="av" style={{ display: 'grid', placeItems: 'center', background: 'rgba(98,227,172,.16)', color: 'var(--mint)', fontSize: 24, fontWeight: 700 }} aria-hidden="true">+</span>
							<span className="main"><span className="title">Add a Virtual Friend</span><span className="sub">A computer player takes this seat</span></span>
						</button>
					)}
					{Array.from({ length: Math.max(0, 6 - data.players.length - (isHost && vfOn ? 1 : 0)) }, (_, i) => (
						<div className="list-row" key={`open-${i}`} style={{ minHeight: 48 }}><span className="main"><span className="open-seat">Open seat</span></span></div>
					))}
				</div>

				{data.isMember && (
					<button type="button" className="btn btn-invite" onClick={() => setInviteOpen(true)}>👥 Invite Friends</button>
				)}
				{data.isMember && (
					<div className="share-row">
						<button type="button" className="btn-share wa" onClick={whatsapp}>
							<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 0 0-7.8 13.5L3 21l4.6-1.2A9 9 0 1 0 12 3Z" /><path d="M8.8 8.6c.2-.5.5-.5.8-.5h.5c.2 0 .4.1.5.4l.7 1.6c.1.2 0 .4-.1.6l-.5.6c-.1.2-.1.3 0 .5.6 1 1.4 1.8 2.5 2.4.2.1.4.1.5-.1l.6-.7c.2-.2.4-.2.6-.1l1.6.8c.2.1.3.3.3.5 0 .8-.6 1.6-1.4 1.8-.7.2-1.7.1-3.4-.8-2-1.1-3.3-3-3.6-3.6-.4-.6-.8-1.8-.2-2.9Z" /></svg>
							Share on WhatsApp
						</button>
						<button type="button" className="btn-share" onClick={invite}>{copied ? 'Link copied' : 'More ways to share'}</button>
					</div>
				)}

				{isHost && data.players.some(p => p.isBot) && (
					<>
						<div className="section-title">Virtual Friends play</div>
						<div className="segmented" role="radiogroup" aria-label="How well Virtual Friends play">
							{LEVELS.map(l => (
								<label key={l.v}><input type="radio" name="level" checked={level === l.v} onChange={() => setLevel(l.v)} /><span>{l.label}</span></label>
							))}
						</div>
						<p className="hint">{LEVELS.find(l => l.v === level)!.note}</p>
					</>
				)}

				{isHost && (
					<>
						<div className="section-title">Turn timer</div>
						<div className="segmented" role="radiogroup" aria-label="Turn timer">
							{TIMERS.map(t => (
								<label key={t}><input type="radio" name="timer" checked={timer === t} onChange={() => setTimer(t)} /><span>{t ? `${t}s` : 'Off'}</span></label>
							))}
						</div>
						<p className="hint">When time runs out, the turn is played automatically.</p>
					</>
				)}

				<div className="dock"><div>
					{!data.isMember ? (
						<button className="btn btn-primary" type="button" disabled={busy}
							onClick={() => (data.private ? setPinOpen(true) : act(() => api(`/api/games/${id}/join`, {})))}>Join This Table</button>
					) : isHost ? (
						<>
							<button className="btn btn-primary" type="button" disabled={busy || data.players.length < 2}
								onClick={() => act(async () => { await api(`/api/games/${id}/start`, { timer: timer < 0 ? data.timerSec : timer, level }); router.replace(`/game/${id}`); })}>
								{data.players.length < 2 ? (vfOn ? 'Invite a friend or add a Virtual Friend' : 'Waiting for players…') : 'Start Game'}
							</button>
							<button className="btn btn-plain" type="button" disabled={busy}
								onClick={() => act(async () => { await api(`/api/games/${id}/leave`, {}); router.replace('/'); })}>Cancel Table</button>
						</>
					) : (
						<button className="btn btn-danger" type="button" disabled={busy}
							onClick={() => act(async () => { await api(`/api/games/${id}/leave`, {}); router.replace('/join'); })}>Leave Table</button>
					)}
					<ErrorBanner>{error || loadError}</ErrorBanner>
				</div></div>
			</main>
			{inviteOpen && <InviteFriends gameId={id} onClose={() => setInviteOpen(false)} />}
			<VoiceChat gameId={id} enabled={voiceOn && data.isMember && (data.status === 'lobby' || data.status === 'playing')} />
			{pinOpen && <PinSheet gameId={id} onClose={() => setPinOpen(false)} onSubmit={async pin => { await api(`/api/games/${id}/join`, { pin }); setPinOpen(false); await refresh(); }} />}
		</div>
	);
}
