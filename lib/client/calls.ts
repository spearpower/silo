'use client';
// Voice calls on the device. One call at a time, kept outside React so it survives page changes.
// Server is the authority for who may join (tokens are minted only after the DB says yes); this module only
// drives the LiveKit room, the ringing UI and the keep-alive pings that let the server settle calls.
import { useSelector } from './external';
import type { Room } from 'livekit-client';
import { supabase } from '../supabase/browser';
import { api, ApiError } from './api';
import { getState, onCallChange, onResync } from './store';
import { haptic, startRingback, startRinging, stopRinging, unlockAudio } from './sound';
import { setKeepAliveMuted, startKeepAlive, stopKeepAlive } from './callKeepAlive';

export type CallPhase = 'idle' | 'outgoing' | 'incoming' | 'connecting' | 'active' | 'reconnecting' | 'ended';
export interface CallMember { id: string; name: string; speaking: boolean; muted: boolean; me: boolean; connected: boolean }
export interface CallState {
	phase: CallPhase;
	callId: string | null;
	conversationId: string | null;
	kind: 'direct' | 'group';
	title: string;          // person (direct) or group name
	callerName: string;     // who started it
	answeredAt: number | null;
	muted: boolean;
	members: CallMember[];
	notice: string;         // "No answer", "Call declined", mic problems...
	minimized: boolean;
}

const idle: CallState = { phase: 'idle', callId: null, conversationId: null, kind: 'direct', title: '', callerName: '', answeredAt: null, muted: false, members: [], notice: '', minimized: false };
let state: CallState = idle;
const listeners = new Set<() => void>();
function set(p: Partial<CallState>) { state = { ...state, ...p }; listeners.forEach(l => l()); }
export const callState = () => state;
const subscribeCall = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export function useCall<T>(sel: (s: CallState) => T): T {
	return useSelector(subscribeCall, callState, sel);
}

let room: Room | null = null;
let audioBox: HTMLDivElement | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let ringTimer: ReturnType<typeof setTimeout> | null = null;
const declinedHere = new Set<string>();

function box() {
	if (!audioBox) {
		audioBox = document.createElement('div');
		audioBox.hidden = true;
		audioBox.setAttribute('aria-hidden', 'true');
		document.body.appendChild(audioBox);
	}
	return audioBox;
}

async function titleFor(conversationId: string): Promise<{ title: string; kind: 'direct' | 'group' }> {
	const c = getState().convs?.find(x => x.id === conversationId);
	if (c) return { title: c.kind === 'group' ? c.title || 'Group' : c.other_display_name || 'Silo user', kind: c.kind };
	return { title: 'Voice call', kind: 'direct' };
}

function readMembers(r: Room): CallMember[] {
	const speaking = new Set(r.activeSpeakers.map(p => p.identity));
	const lp = r.localParticipant;
	return [
		{ id: lp.identity, name: 'You', speaking: speaking.has(lp.identity), muted: !lp.isMicrophoneEnabled, me: true, connected: true },
		...Array.from(r.remoteParticipants.values()).map(p => ({
			id: p.identity, name: p.name || 'Silo user', speaking: speaking.has(p.identity), muted: !p.isMicrophoneEnabled, me: false, connected: true,
		})),
	];
}

function micError(e: unknown): string {
	const msg = (e as Error)?.message || '';
	const name = (e as Error)?.name || '';
	if (/NotAllowed|Permission|denied/i.test(name + msg)) return 'Silo can’t use your microphone. Allow microphone access for this site in your browser settings, then try again.';
	if (/NotFound|Requested device not found/i.test(name + msg)) return 'No microphone was found on this device.';
	if (/NotReadable|in use/i.test(name + msg)) return 'Your microphone is being used by another app.';
	return '';
}

/** Ask for the microphone before calling, so a refusal is explained instead of silently failing. */
async function checkMic() {
	if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser can’t make voice calls. Try a recent Chrome, Safari, Edge or Firefox.');
	const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
	stream.getTracks().forEach(t => t.stop());
}

async function connect(url: string, token: string) {
	const lk = await import('livekit-client');
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
	r.on(lk.RoomEvent.ParticipantConnected, () => {
		refresh();
		if (state.phase === 'outgoing') { stopRinging(); set({ phase: 'active', answeredAt: state.answeredAt ?? Date.now() }); }
	});
	r.on(lk.RoomEvent.ParticipantDisconnected, () => {
		refresh();
		// direct call: the other person left -> the call is over
		if (state.kind === 'direct' && state.phase === 'active' && r.remoteParticipants.size === 0) void hangUp('Call ended');
	});
	r.on(lk.RoomEvent.Reconnecting, () => { if (room === r) set({ phase: 'reconnecting' }); });
	r.on(lk.RoomEvent.Reconnected, () => { if (room === r) { set({ phase: state.answeredAt ? 'active' : 'outgoing' }); refresh(); } });
	r.on(lk.RoomEvent.Disconnected, () => { if (room === r) void hangUp('Disconnected'); });
	await r.connect(url, token);
	room = r;
	await r.startAudio().catch(() => {});
	await r.localParticipant.setMicrophoneEnabled(true);
	refresh();
	// keep the screen awake and tell the phone a call is running (until finish())
	startKeepAlive(state.title || 'Voice call', { hangUp: () => void hangUp(), toggleMute: () => void toggleMute() });
}

function startPings() {
	stopPings();
	pingTimer = setInterval(async () => {
		const id = state.callId;
		if (!id) return;
		try {
			const r = await api<{ status: string; answeredAt: string | null }>(`/api/calls/${id}/ping`, {});
			if (state.callId !== id) return;
			if (r.status === 'missed' || r.status === 'cancelled') await finish(state.phase === 'outgoing' ? 'No answer' : 'Call ended');
			else if (r.status === 'declined') await finish('Call declined');
			else if (r.status === 'ended') await finish('Call ended');
			else if (r.status === 'active' && state.phase === 'outgoing') { stopRinging(); set({ phase: 'active', answeredAt: r.answeredAt ? new Date(r.answeredAt).getTime() : Date.now() }); }
		} catch (e) {
			if (e instanceof ApiError && (e.status === 403 || e.status === 404)) await finish('Call ended');
		}
	}, 20_000);
}
function stopPings() { if (pingTimer) { clearInterval(pingTimer); pingTimer = null; } }

/** Local tear-down (no server call). Shows the reason briefly, then returns to idle. */
async function finish(notice: string) {
	stopRinging();
	stopKeepAlive();
	stopPings();
	if (ringTimer) { clearTimeout(ringTimer); ringTimer = null; }
	const r = room;
	room = null;
	if (r) { try { await r.disconnect(); } catch { /* gone */ } }
	if (audioBox) audioBox.innerHTML = '';
	set({ phase: 'ended', notice, members: [] });
	const id = state.callId;
	setTimeout(() => {
		if (state.phase !== 'ended' || state.callId !== id) return;
		state = { ...idle };
		listeners.forEach(l => l());
	}, 1800);
}

// ---------------------------------------------------------------- actions (call from taps)

export async function startCall(conversationId: string) {
	if (state.phase !== 'idle' && state.phase !== 'ended') return;
	unlockAudio();
	const { title, kind } = await titleFor(conversationId);
	set({ ...idle, phase: 'connecting', conversationId, title, kind, callerName: 'You' });
	try {
		await checkMic();
		const r = await api<{ call: { id: string; status: string; kind: 'direct' | 'group'; created: boolean }; url: string; token: string }>('/api/calls', { conversationId });
		set({ callId: r.call.id, kind: r.call.kind });
		await connect(r.url, r.token);
		if (r.call.created) {
			set({ phase: 'outgoing' }); // ringing the others; becomes active when someone answers
			startRingback();
		} else {
			set({ phase: 'active', answeredAt: Date.now() }); // joined a group call already in progress
		}
		startPings();
		haptic(10);
	} catch (e) {
		const mic = micError(e);
		if (state.callId) void api(`/api/calls/${state.callId}/leave`, {}).catch(() => {});
		await finish(mic || (e as Error).message || 'Couldn’t start the call');
	}
}

export async function acceptCall() {
	const id = state.callId;
	if (!id || state.phase !== 'incoming') return;
	stopRinging();
	unlockAudio();
	set({ phase: 'connecting' });
	try {
		await checkMic();
		const r = await api<{ url: string; token: string }>(`/api/calls/${id}/join`, {});
		await connect(r.url, r.token);
		set({ phase: 'active', answeredAt: Date.now() });
		startPings();
	} catch (e) {
		const mic = micError(e);
		if (mic) void api(`/api/calls/${id}/leave`, {}).catch(() => {});
		await finish(mic || (e as Error).message || 'Couldn’t join the call');
	}
}

/** Join a group call that is already running (from the banner in the chat). */
export async function joinGroupCall(callId: string, conversationId: string) {
	if (state.phase !== 'idle' && state.phase !== 'ended') return;
	const { title } = await titleFor(conversationId);
	set({ ...idle, phase: 'incoming', callId, conversationId, kind: 'group', title });
	await acceptCall();
}

export async function declineCall() {
	const id = state.callId;
	if (!id) return;
	declinedHere.add(id);
	stopRinging();
	state = { ...idle };
	listeners.forEach(l => l());
	await api(`/api/calls/${id}/decline`, {}).catch(() => {});
}

export async function hangUp(notice = 'Call ended') {
	const id = state.callId;
	if (id) void api(`/api/calls/${id}/leave`, {}).catch(() => {});
	await finish(notice);
}

export async function toggleMute() {
	const r = room;
	if (!r) return;
	const next = !state.muted;
	await r.localParticipant.setMicrophoneEnabled(!next);
	setKeepAliveMuted(next);
	haptic(8);
	set({ muted: next, members: readMembers(r) });
}

export const setMinimized = (minimized: boolean) => set({ minimized });

// ---------------------------------------------------------------- incoming calls

/** Show the ringing sheet for a call I'm invited to (from Realtime, a push tap, or a resync). */
export async function presentIncoming(callId: string) {
	if (declinedHere.has(callId) || state.callId === callId) return;
	if (state.phase !== 'idle' && state.phase !== 'ended') return; // busy: the server marks it missed
	const db = supabase();
	const meId = getState().meId;
	const [{ data: call }, { data: mine }] = await Promise.all([
		db.from('call_sessions').select('id, conversation_id, kind, status, started_by').eq('id', callId).maybeSingle(),
		db.from('call_participants').select('state').eq('call_id', callId).eq('user_id', meId ?? '').maybeSingle(),
	]);
	if (!call || !mine) return;
	const live = call.status === 'ringing' || (call.kind === 'group' && call.status === 'active');
	if (!live || mine.state !== 'invited' || call.started_by === meId) return;
	const { title } = await titleFor(call.conversation_id);
	let callerName = 'Someone';
	if (call.started_by) {
		const { data: p } = await db.from('profiles').select('display_name').eq('id', call.started_by).maybeSingle();
		callerName = p?.display_name || callerName;
	}
	if (state.phase !== 'idle' && state.phase !== 'ended') return;
	set({ ...idle, phase: 'incoming', callId, conversationId: call.conversation_id, kind: call.kind, title, callerName });
	startRinging();
	haptic([200, 100, 200]);
	if (ringTimer) clearTimeout(ringTimer);
	ringTimer = setTimeout(() => { if (state.phase === 'incoming' && state.callId === callId) void finish('Missed call'); }, 45_000);
}

async function checkForRinging() {
	const meId = getState().meId;
	if (!meId) return;
	const { data } = await supabase().from('call_participants').select('call_id, invited_at').eq('user_id', meId).eq('state', 'invited')
		.gte('invited_at', new Date(Date.now() - 60_000).toISOString()).order('invited_at', { ascending: false }).limit(1);
	if (data?.[0]) await presentIncoming(data[0].call_id);
}

let wired = false;
/** Hook calls into Realtime (once, after the chat store booted). */
export function wireCalls() {
	if (wired) return;
	wired = true;
	onCallChange((p, table) => {
		const row = p.new as Record<string, unknown>;
		const meId = getState().meId;
		if (table === 'call_participants' && p.eventType === 'INSERT' && row.user_id === meId && row.state === 'invited') {
			void presentIncoming(String(row.call_id));
		}
		if (table === 'call_sessions' && row.id === state.callId) {
			const status = String(row.status);
			if (state.phase === 'incoming' && status !== 'ringing' && !(state.kind === 'group' && status === 'active')) void finish(status === 'missed' ? 'Missed call' : 'Call ended');
			else if (state.phase === 'outgoing' && status === 'active') { stopRinging(); set({ phase: 'active', answeredAt: Date.now() }); }
			else if (['ended', 'missed', 'declined', 'cancelled'].includes(status) && (state.phase === 'active' || state.phase === 'outgoing' || state.phase === 'reconnecting')) {
				void finish(status === 'declined' ? 'Call declined' : status === 'missed' ? 'No answer' : 'Call ended');
			}
		}
	});
	onResync(() => { void checkForRinging(); });
	void checkForRinging();
	window.addEventListener('pagehide', () => { if (state.callId && room) navigator.sendBeacon?.(`/api/calls/${state.callId}/leave`, new Blob(['{}'], { type: 'application/json' })); });
}
