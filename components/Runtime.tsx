'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import Avatar from './Avatar';
import Icon from './Icon';
import { hideToast, useStore } from '@/lib/client/store';
import { acceptCall, declineCall, hangUp, setMinimized, toggleMute, toggleSpeaker, useCall, type CallState } from '@/lib/client/calls';
import { duration } from '@/lib/format';

/** Everything that floats above the pages: call screens, the incoming-call banner, toasts, connection state. */
export default function Runtime() {
	return (<><CallLayer /><Toast /><Connection /></>);
}

function Connection() {
	const { connection, ready } = useStore(s => ({ connection: s.connection, ready: s.ready }));
	const [show, setShow] = useState(false);
	useEffect(() => {
		if (connection !== 'offline' || !ready) { setShow(false); return; }
		const t = setTimeout(() => setShow(true), 2500); // ignore short blips
		return () => clearTimeout(t);
	}, [connection, ready]);
	return show ? <div className="conn-pill" role="status">Reconnecting…</div> : null;
}

function Toast() {
	const toast = useStore(s => s.toast);
	if (!toast) return null;
	const body = <><span className="bar" /><span className="ellipsis">{toast.text}</span></>;
	return toast.href
		? <Link className="toast" href={toast.href} onClick={hideToast} role="status">{body}</Link>
		: <div className="toast" role="status">{body}</div>;
}

function useTicker(on: boolean) {
	const [, set] = useState(0);
	useEffect(() => {
		if (!on) return;
		const t = setInterval(() => set(x => x + 1), 1000);
		return () => clearInterval(t);
	}, [on]);
}

function stateText(c: CallState): string {
	switch (c.phase) {
		case 'connecting': return 'Connecting…';
		case 'outgoing': return c.kind === 'group' ? 'Calling the group…' : 'Ringing…';
		case 'reconnecting': return 'Connection lost. Reconnecting…';
		case 'ended': return c.notice || 'Call ended';
		case 'active': return c.answeredAt ? duration((Date.now() - c.answeredAt) / 1000) : 'Connected';
		default: return '';
	}
}

function CallLayer() {
	const c = useCall(s => s);
	useTicker(c.phase === 'active');

	if (c.phase === 'idle') return null;

	if (c.phase === 'incoming') {
		return (
			<div className="incoming" role="alertdialog" aria-label={`Incoming call from ${c.callerName}`}>
				<Avatar id={c.conversationId} name={c.kind === 'group' ? c.title : c.callerName} size={52} group={c.kind === 'group'} />
				<div className="who">
					<b className="ellipsis">{c.kind === 'group' ? c.title : c.callerName}</b>
					<span>{c.kind === 'group' ? `${c.callerName} started a voice call` : 'Incoming voice call'}</span>
				</div>
				<button className="round no" type="button" onClick={() => void declineCall()} aria-label="Decline"><Icon name="phoneDown" /></button>
				<button className="round yes" type="button" onClick={() => void acceptCall()} aria-label="Answer"><Icon name="phone" /></button>
			</div>
		);
	}

	if (c.minimized && c.phase !== 'ended') {
		return (
			<button className="call-mini" type="button" onClick={() => setMinimized(false)} aria-label="Return to call">
				<span className="live-dot" />
				<span className="grow"><b className="ellipsis" style={{ display: 'block' }}>{c.title}</b><span className="small" style={{ color: '#B9CDE0' }}>{stateText(c)}</span></span>
				<Icon name={c.muted ? 'micOff' : 'mic'} />
			</button>
		);
	}

	const others = c.members.filter(m => !m.me);
	const waiting = c.phase === 'outgoing' || c.phase === 'connecting';
	return (
		<div className="call-screen" role="dialog" aria-modal="true" aria-label={`Voice call with ${c.title}`}>
			{c.phase !== 'ended' && (
				<button className="icon-btn minimize" type="button" onClick={() => setMinimized(true)} aria-label="Minimise call"><Icon name="minimize" /></button>
			)}
			<div className="top">
				<span className={waiting ? 'ring' : ''}><Avatar id={c.conversationId} name={c.title} size={112} group={c.kind === 'group'} /></span>
				<h2>{c.title}</h2>
				<div className={`state${c.phase === 'reconnecting' || (c.phase === 'ended' && /microphone|blocked|can’t|Couldn/i.test(c.notice)) ? ' warn' : ''}`} aria-live="polite">{stateText(c)}</div>
				<span className="chip" style={{ background: 'rgba(255,255,255,.12)', color: '#DCE7F1' }}><Icon name="lock" className="icon sm" /> Voice only</span>
			</div>

			{(c.kind === 'group' || others.length > 1) && c.members.length > 0 && (
				<div className="participants" aria-label="People in the call">
					{c.members.map(m => (
						<div key={m.id} className={`participant${m.speaking && !m.muted ? ' speaking' : ''}`}>
							<Avatar id={m.id} name={m.me ? 'You' : m.name} size={64} />
							<span className="ellipsis" style={{ maxWidth: '100%' }}>{m.me ? 'You' : m.name}</span>
							{m.muted ? <Icon name="micOff" className="icon sm mic-off" label="Muted" /> : m.speaking ? <span className="small">Speaking</span> : null}
						</div>
					))}
				</div>
			)}
			{c.kind === 'direct' && others[0] && (
				<div className="small" style={{ color: '#B9CDE0' }}>{others[0].muted ? `${others[0].name} is muted` : others[0].speaking ? `${others[0].name} is speaking` : ''}</div>
			)}

			<div className="call-controls">
				<button className={`call-ctl${c.muted ? ' on' : ''}`} type="button" onClick={() => void toggleMute()} disabled={c.phase === 'ended' || c.phase === 'connecting'} aria-pressed={c.muted}>
					<span className="disc"><Icon name={c.muted ? 'micOff' : 'mic'} /></span>{c.muted ? 'Unmute' : 'Mute'}
				</button>
				{c.speaker !== null && (
					<button className={`call-ctl${c.speaker ? ' on' : ''}`} type="button" onClick={toggleSpeaker} disabled={c.phase === 'ended'} aria-pressed={c.speaker}>
						<span className="disc"><Icon name="speaker" /></span>{c.speaker ? 'Speaker on' : 'Speaker'}
					</button>
				)}
				<button className="call-ctl end" type="button" onClick={() => void hangUp()} disabled={c.phase === 'ended'}>
					<span className="disc"><Icon name="phoneDown" /></span>{c.phase === 'outgoing' ? 'Cancel' : 'End'}
				</button>
			</div>
		</div>
	);
}
