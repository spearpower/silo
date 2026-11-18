'use client';
import { useEffect, useRef, useState } from 'react';
import Avatar from './Avatar';
import Icon from './Icon';
import {
	acceptCall, declineCall, flipCamera, hangUp, setMinimized, toggleCamera, toggleMute, toggleSpeaker, useCall, videoTrack,
	type CallMember, type CallState,
} from '@/lib/client/calls';
import { duration } from '@/lib/format';

const MAX_TILES = 8;

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

/** A participant's camera in a <video> element (attached / detached with the track). */
function VideoView({ member, mirror, className }: { member: CallMember; mirror?: boolean; className?: string }) {
	const ref = useRef<HTMLVideoElement>(null);
	useEffect(() => {
		const el = ref.current;
		const track = videoTrack(member.id);
		if (!el || !track) return;
		track.attach(el);
		return () => { track.detach(el); };
	}, [member.id, member.videoKey]);
	return <video ref={ref} className={`${className || ''}${mirror ? ' mirror' : ''}`} autoPlay playsInline muted aria-label={`${member.name}’s camera`} />;
}

function Tile({ m, facing }: { m: CallMember; facing: CallState['facing'] }) {
	return (
		<div className={`vtile${m.speaking && !m.muted ? ' speaking' : ''}`}>
			{m.video ? <VideoView member={m} mirror={m.me && facing === 'user'} /> : <div className="vtile-av"><Avatar id={m.id} name={m.me ? 'You' : m.name} size={72} /></div>}
			<span className="vtile-name">
				{m.muted && <Icon name="micOff" className="icon sm" label="Muted" />}
				{m.me ? 'You' : m.name}
				{m.poor && <span className="weak" title="Weak connection">weak</span>}
			</span>
		</div>
	);
}

/** Your own camera in a small window you can drag around (one-to-one video). */
function Pip({ me, facing }: { me: CallMember; facing: CallState['facing'] }) {
	const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
	const drag = useRef<{ dx: number; dy: number; id: number } | null>(null);
	const ref = useRef<HTMLDivElement>(null);
	return (
		<div ref={ref} className="pip" style={pos ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' } : undefined}
			onPointerDown={e => {
				const r = ref.current!.getBoundingClientRect();
				drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top, id: e.pointerId };
				ref.current!.setPointerCapture(e.pointerId);
			}}
			onPointerMove={e => {
				const d = drag.current;
				if (!d || d.id !== e.pointerId) return;
				const r = ref.current!.getBoundingClientRect();
				setPos({ x: Math.max(8, Math.min(window.innerWidth - r.width - 8, e.clientX - d.dx)), y: Math.max(8, Math.min(window.innerHeight - r.height - 8, e.clientY - d.dy)) });
			}}
			onPointerUp={() => {
				drag.current = null;
				// snap to the nearest side
				const r = ref.current!.getBoundingClientRect();
				setPos(p => (p ? { x: r.left + r.width / 2 < window.innerWidth / 2 ? 12 : window.innerWidth - r.width - 12, y: p.y } : p));
			}}>
			<VideoView member={me} mirror={facing === 'user'} />
		</div>
	);
}

export default function CallScreen() {
	const c = useCall(s => s);
	useTicker(c.phase === 'active');

	if (c.phase === 'idle') return null;

	if (c.phase === 'incoming') {
		const video = c.media === 'video';
		return (
			<div className="incoming" role="alertdialog" aria-label={`Incoming ${video ? 'video' : 'voice'} call from ${c.callerName}`}>
				<Avatar id={c.conversationId} name={c.kind === 'group' ? c.title : c.callerName} size={52} group={c.kind === 'group'} />
				<div className="who">
					<b className="ellipsis">{c.kind === 'group' ? c.title : c.callerName}</b>
					<span>{c.kind === 'group' ? `${c.callerName} started a ${video ? 'video' : 'voice'} call` : `Incoming ${video ? 'video' : 'voice'} call`}</span>
				</div>
				<button className="round no" type="button" onClick={() => void declineCall()} aria-label="Decline"><Icon name="phoneDown" /></button>
				<button className="round yes" type="button" onClick={() => void acceptCall(false)} aria-label={video ? 'Answer with audio only' : 'Answer'} title={video ? 'Audio only' : 'Answer'}><Icon name="phone" /></button>
				{video && <button className="round yes" type="button" onClick={() => void acceptCall(true)} aria-label="Answer with video" title="Answer with video"><Icon name="camera" /></button>}
			</div>
		);
	}

	if (c.minimized && c.phase !== 'ended') {
		return (
			<button className="call-mini" type="button" onClick={() => setMinimized(false)} aria-label="Return to call">
				<span className="live-dot" />
				<span className="grow"><b className="ellipsis" style={{ display: 'block' }}>{c.title}</b><span className="small" style={{ color: '#B9CDE0' }}>{stateText(c)}</span></span>
				<Icon name={c.camera ? 'camera' : c.muted ? 'micOff' : 'mic'} />
			</button>
		);
	}

	const me = c.members.find(m => m.me);
	const others = c.members.filter(m => !m.me);
	const anyVideo = c.camera || c.members.some(m => m.video);
	const oneToOne = c.kind === 'direct' && others.length <= 1;
	const waiting = c.phase === 'outgoing' || c.phase === 'connecting';
	const warn = c.phase === 'reconnecting' || (c.phase === 'ended' && /microphone|camera|blocked|can’t|Couldn/i.test(c.notice));

	const controls = (
		<div className="call-controls">
			<button className={`call-ctl${c.muted ? ' on' : ''}`} type="button" onClick={() => void toggleMute()} disabled={c.phase === 'ended' || c.phase === 'connecting'} aria-pressed={c.muted}>
				<span className="disc"><Icon name={c.muted ? 'micOff' : 'mic'} /></span>{c.muted ? 'Unmute' : 'Mute'}
			</button>
			<button className={`call-ctl${c.camera ? ' on' : ''}`} type="button" onClick={() => void toggleCamera()} disabled={c.phase === 'ended' || c.phase === 'connecting'} aria-pressed={c.camera}>
				<span className="disc"><Icon name={c.camera ? 'camera' : 'cameraOff'} /></span>{c.camera ? 'Camera on' : 'Camera'}
			</button>
			{c.camera && c.canFlip && (
				<button className="call-ctl" type="button" onClick={() => void flipCamera()} disabled={c.phase === 'ended'}>
					<span className="disc"><Icon name="flip" /></span>Flip
				</button>
			)}
			{c.speaker !== null && (
				<button className={`call-ctl${c.speaker ? ' on' : ''}`} type="button" onClick={toggleSpeaker} disabled={c.phase === 'ended'} aria-pressed={c.speaker}>
					<span className="disc"><Icon name="speaker" /></span>{c.speaker ? 'Speaker on' : 'Speaker'}
				</button>
			)}
			<button className="call-ctl end" type="button" onClick={() => void hangUp()} disabled={c.phase === 'ended'}>
				<span className="disc"><Icon name="phoneDown" /></span>{c.phase === 'outgoing' ? 'Cancel' : 'End'}
			</button>
		</div>
	);

	const top = (
		<div className="vtop">
			{c.phase !== 'ended' && <button className="icon-btn minimize-btn" type="button" onClick={() => setMinimized(true)} aria-label="Minimise call"><Icon name="minimize" /></button>}
			<div className="grow">
				<b className="ellipsis" style={{ display: 'block' }}>{c.title}</b>
				<span className={`state${warn ? ' warn' : ''}`} aria-live="polite">{stateText(c)}</span>
			</div>
			{c.poor && c.phase === 'active' && <span className="weak-badge" role="status">Weak connection</span>}
		</div>
	);

	// ---------- video layouts
	if (anyVideo && c.phase !== 'ended') {
		if (oneToOne) {
			const them = others[0];
			return (
				<div className="call-screen video" role="dialog" aria-modal="true" aria-label={`Video call with ${c.title}`}>
					<div className="stage">
						{them?.video ? <VideoView member={them} className="fill" />
							: <div className={`stage-av${waiting ? ' ring' : ''}`}><Avatar id={them?.id || c.conversationId} name={them?.name || c.title} size={112} /><span>{them && !them.video ? `${them.name}’s camera is off` : ''}</span></div>}
					</div>
					{me?.video && <Pip me={me} facing={c.facing} />}
					{top}
					{c.tip && <div className="call-tip" role="status">{c.tip}</div>}
					<div className="vbottom">{controls}</div>
				</div>
			);
		}
		// group grid: video tiles first, then the active speakers, up to 8 tiles
		const ordered = [...c.members].sort((a, b) => Number(b.video) - Number(a.video) || Number(b.speaking) - Number(a.speaking) || Number(a.me) - Number(b.me));
		const shown = ordered.slice(0, MAX_TILES);
		const extra = ordered.length - shown.length;
		return (
			<div className="call-screen video" role="dialog" aria-modal="true" aria-label={`Video call: ${c.title}`}>
				{top}
				<div className={`vgrid n${Math.min(shown.length + (extra > 0 ? 1 : 0), MAX_TILES)}`}>
					{shown.map(m => <Tile key={m.id} m={m} facing={c.facing} />)}
					{extra > 0 && <div className="vtile more"><b>+{extra}</b><span>more on audio</span></div>}
				</div>
				{c.tip && <div className="call-tip" role="status">{c.tip}</div>}
				<div className="vbottom">{controls}</div>
			</div>
		);
	}

	// ---------- voice layout
	return (
		<div className="call-screen" role="dialog" aria-modal="true" aria-label={`${c.media === 'video' ? 'Video' : 'Voice'} call with ${c.title}`}>
			{c.phase !== 'ended' && (
				<button className="icon-btn minimize" type="button" onClick={() => setMinimized(true)} aria-label="Minimise call"><Icon name="minimize" /></button>
			)}
			<div className="top">
				<span className={waiting ? 'ring' : ''}><Avatar id={c.conversationId} name={c.title} size={112} group={c.kind === 'group'} /></span>
				<h2>{c.title}</h2>
				<div className={`state${warn ? ' warn' : ''}`} aria-live="polite">{stateText(c)}</div>
				<span className="chip" style={{ background: 'rgba(255,255,255,.12)', color: '#DCE7F1' }}><Icon name="lock" className="icon sm" /> {c.media === 'video' ? 'Video call' : 'Voice call'}</span>
				{c.poor && c.phase === 'active' && <span className="weak-badge" role="status">Weak connection</span>}
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
			{c.tip && <div className="call-tip" role="status">{c.tip}</div>}
			{controls}
		</div>
	);
}
