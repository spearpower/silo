'use client';
// Table voice chat button / control pill. The connection itself lives in lib/voiceClient.ts, so it keeps
// running from the waiting room to the table. Shown in the waiting room and at the table when voice is on.
import { useEffect, useState } from 'react';
import { joinVoice, leaveVoice, onVoice, paintSeats, resumeVoiceAudio, toggleMute, voiceState, type VoiceState } from '@/lib/voiceClient';

export default function VoiceChat({ gameId, enabled }: { gameId: number; enabled: boolean }) {
	const [s, setS] = useState<VoiceState>(voiceState());
	const [open, setOpen] = useState(false);
	useEffect(() => onVoice(setS), []);
	// Another game, or voice switched off / game over: hang up
	useEffect(() => { if ((!enabled || (s.gameId !== null && s.gameId !== gameId)) && s.phase !== 'off') void leaveVoice(); }, [enabled, gameId, s.gameId, s.phase]);
	// The board re-renders player boxes: keep the speaking rings painted
	useEffect(() => { const t = setInterval(paintSeats, 1000); return () => clearInterval(t); }, []);

	if (!enabled) return null;
	const here = s.gameId === gameId;
	const on = here && (s.phase === 'on' || s.phase === 'reconnecting');
	return (
		<>
			{on ? (
				<div className={`voice-pill${s.phase === 'reconnecting' ? ' reconnecting' : ''}`} role="group" aria-label="Voice chat">
					<button type="button" className="lbl-btn" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-label={`Voice chat, ${s.members.length} connected. Show who is in voice`}>
						<span className="dot" aria-hidden="true" />
						<span className="lbl">{s.phase === 'reconnecting' ? 'Reconnecting…' : `Voice · ${s.members.length}`}</span>
					</button>
					<button type="button" onClick={() => void toggleMute()} aria-pressed={s.muted} aria-label={s.muted ? 'Unmute microphone' : 'Mute microphone'}>{s.muted ? '🔇' : '🎙'}</button>
					<button type="button" onClick={() => void leaveVoice()} aria-label="Leave voice chat">✕</button>
				</div>
			) : (
				<button type="button" className={`voice-fab${here && s.phase === 'joining' ? ' busy' : ''}`} onClick={() => void joinVoice(gameId)} disabled={here && s.phase === 'joining'}
					aria-label={here && s.phase === 'joining' ? 'Joining voice chat…' : 'Join voice chat'} title="Talk to the table">
					{here && s.phase === 'joining' ? '…' : '🎙'}
				</button>
			)}
			{on && open && (
				<div className="voice-list" role="list" aria-label="In voice chat">
					{s.members.map(m => (
						<div key={m.id} role="listitem" className={`vm${m.speaking && !m.muted ? ' talking' : ''}`}>
							<span aria-hidden="true">{m.muted ? '🔇' : m.speaking ? '🔊' : '🎧'}</span>
							<span>{m.me ? 'You' : m.name}</span>
						</div>
					))}
				</div>
			)}
			{here && s.error && (
				<div className="voice-error" role="alert" onClick={() => void (s.phase === 'on' ? resumeVoiceAudio() : leaveVoice())}>{s.error}</div>
			)}
		</>
	);
}
