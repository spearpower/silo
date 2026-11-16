'use client';
// Table voice chat (LiveKit), kept in one place for the whole app: the connection survives moving from the
// waiting room to the table (client-side navigation), and is closed when you open another game or leave.
// Nobody is heard unless they tap the mic and allow it. The LiveKit library loads only when someone joins.
import type { Room } from 'livekit-client';
import { api, haptic } from './client';
import { playSound } from './sound';

export type VoicePhase = 'off' | 'joining' | 'on' | 'reconnecting' | 'error';
export interface VoiceMember { id: string; name: string; speaking: boolean; muted: boolean; me: boolean }
export interface VoiceState { phase: VoicePhase; gameId: number | null; muted: boolean; members: VoiceMember[]; error: string }

let state: VoiceState = { phase: 'off', gameId: null, muted: false, members: [], error: '' };
const listeners = new Set<(s: VoiceState) => void>();
let room: Room | null = null;
let audioBox: HTMLDivElement | null = null;

function set(patch: Partial<VoiceState>) {
	state = { ...state, ...patch };
	for (const l of listeners) l(state);
	paintSeats();
}
export const voiceState = () => state;
export function onVoice(fn: (s: VoiceState) => void): () => void { listeners.add(fn); fn(state); return () => { listeners.delete(fn); }; }

/** Speaking rings / headphones / muted marks on the player boxes ([data-seat]), without re-rendering the board. */
export function paintSeats() {
	if (typeof document === 'undefined') return;
	const by = new Map(state.members.map(m => [m.id, m]));
	document.querySelectorAll<HTMLElement>('[data-seat]').forEach(el => {
		const m = by.get(el.dataset.seat || '');
		el.classList.toggle('in-voice', !!m);
		el.classList.toggle('speaking', !!m?.speaking && !m.muted);
		el.classList.toggle('voice-muted', !!m?.muted);
	});
}

function box(): HTMLDivElement {
	if (!audioBox) {
		audioBox = document.createElement('div');
		audioBox.hidden = true;
		audioBox.setAttribute('aria-hidden', 'true');
		document.body.appendChild(audioBox);
	}
	return audioBox;
}

function readMembers(r: Room): VoiceMember[] {
	const speaking = new Set(r.activeSpeakers.map(p => p.identity));
	const lp = r.localParticipant;
	return [
		{ id: lp.identity, name: lp.name || 'You', speaking: speaking.has(lp.identity), muted: !lp.isMicrophoneEnabled, me: true },
		...Array.from(r.remoteParticipants.values()).map(p => ({ id: p.identity, name: p.name || p.identity, speaking: speaking.has(p.identity), muted: !p.isMicrophoneEnabled, me: false })),
	];
}

export async function leaveVoice() {
	const r = room;
	room = null;
	if (r) { try { await r.disconnect(); } catch { /* already gone */ } }
	if (audioBox) audioBox.innerHTML = '';
	set({ phase: 'off', gameId: null, muted: false, members: [] });
}

/** Must be called from a tap (browsers allow audio and the microphone prompt only after a user gesture). */
export async function joinVoice(gameId: number) {
	if (room && state.gameId === gameId && state.phase !== 'error') return;
	if (room) await leaveVoice();
	set({ phase: 'joining', gameId, error: '' });
	haptic(10);
	try {
		const [{ url, token }, lk] = await Promise.all([
			api<{ url: string; token: string }>(`/api/games/${gameId}/voice`, {}),
			import('livekit-client'),
		]);
		const r = new lk.Room({ adaptiveStream: false, dynacast: false, audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
		const refresh = () => { if (room === r) set({ members: readMembers(r), muted: !r.localParticipant.isMicrophoneEnabled }); };
		r.on(lk.RoomEvent.TrackSubscribed, track => {
			if (track.kind !== lk.Track.Kind.Audio) return;
			const el = track.attach();
			el.setAttribute('playsinline', 'true');
			box().appendChild(el);
		});
		r.on(lk.RoomEvent.TrackUnsubscribed, track => { track.detach().forEach(el => el.remove()); });
		r.on(lk.RoomEvent.ActiveSpeakersChanged, refresh);
		r.on(lk.RoomEvent.TrackMuted, refresh);
		r.on(lk.RoomEvent.TrackUnmuted, refresh);
		r.on(lk.RoomEvent.LocalTrackPublished, refresh);
		r.on(lk.RoomEvent.ParticipantConnected, () => { refresh(); playSound('chat'); });
		r.on(lk.RoomEvent.ParticipantDisconnected, refresh);
		r.on(lk.RoomEvent.Reconnecting, () => { if (room === r) set({ phase: 'reconnecting' }); });
		r.on(lk.RoomEvent.Reconnected, () => { if (room === r) { set({ phase: 'on' }); refresh(); } });
		r.on(lk.RoomEvent.Disconnected, () => { if (room === r) void leaveVoice(); });
		r.on(lk.RoomEvent.AudioPlaybackStatusChanged, () => { if (!r.canPlaybackAudio) set({ error: 'Tap the voice button to hear the others' }); });
		await r.connect(url, token);
		room = r;
		await r.startAudio().catch(() => {}); // we're inside the tap, so this is allowed
		await r.localParticipant.setMicrophoneEnabled(true);
		set({ phase: 'on' });
		refresh();
	} catch (e) {
		const msg = (e as Error).message || '';
		await leaveVoice();
		set({
			phase: 'error', gameId,
			error: /permission|denied|notallowed/i.test(msg) ? 'Microphone access was blocked. Allow it in your browser settings to talk.'
				: /not set up|switched off|Only players|over/i.test(msg) ? msg
				: 'Couldn’t connect to voice chat. Check your connection and try again.',
		});
	}
}

export async function toggleMute() {
	const r = room;
	if (!r) return;
	const next = !state.muted;
	await r.localParticipant.setMicrophoneEnabled(!next);
	haptic(8);
	set({ muted: next, members: readMembers(r) });
}

/** Resume audio after the browser blocked autoplay (call from a tap). */
export async function resumeVoiceAudio() {
	if (room) { await room.startAudio().catch(() => {}); set({ error: '' }); }
}
