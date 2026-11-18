'use client';
// Voice and video calls on the device. One call at a time, kept outside React so it survives page changes.
// Server is the authority for who may join (tokens are minted only after the DB says yes); this module only
// drives the LiveKit room, the ringing UI and the keep-alive pings that let the server settle calls.
//
// Video is data-friendly by default (LiveKit free plan, mobile data): capture at most 540p, publish
// simulcast layers (180p / 360p / 540p) so each viewer only downloads the size of its tile (adaptiveStream),
// pause layers nobody watches (dynacast), and pause the own camera when the connection stays poor.
import { useSelector } from './external';
import type { LocalVideoTrack, Room, Track } from 'livekit-client';
import { supabase } from '../supabase/browser';
import { api, ApiError } from './api';
import { getState, onCallChange, onResync } from './store';
import { haptic, startRingback, startRinging, stopRinging, unlockAudio } from './sound';
import { setKeepAliveMuted, startKeepAlive, stopKeepAlive } from './callKeepAlive';
import { canSwitchSpeaker, nativeSetSpeaker, nativeSpeakerOn, onNativeSpeaker } from './native';

export type CallPhase = 'idle' | 'outgoing' | 'incoming' | 'connecting' | 'active' | 'reconnecting' | 'ended';
export type Media = 'audio' | 'video';
export interface CallMember {
	id: string; name: string; speaking: boolean; muted: boolean; me: boolean; connected: boolean;
	video: boolean;            // camera on and a track we can show
	videoKey: string | null;   // changes when the video track changes (re-attach)
	poor: boolean;             // weak connection
}
export interface CallState {
	phase: CallPhase;
	callId: string | null;
	conversationId: string | null;
	kind: 'direct' | 'group';
	media: Media;           // how the call was started ("video call" / "voice call")
	title: string;          // person (direct) or group name
	callerName: string;     // who started it
	answeredAt: number | null;
	muted: boolean;
	camera: boolean;        // my camera is on
	facing: 'user' | 'environment';
	canFlip: boolean;       // more than one camera
	members: CallMember[];
	speaker: boolean | null; // loudspeaker on/off; null = this device can't switch (browsers)
	poor: boolean;          // my connection is weak
	tip: string;            // short in-call message ("Camera paused: weak connection")
	notice: string;         // "No answer", "Call declined", mic problems...
	minimized: boolean;
}

const idle: CallState = {
	phase: 'idle', callId: null, conversationId: null, kind: 'direct', media: 'audio', title: '', callerName: '', answeredAt: null,
	muted: false, camera: false, facing: 'user', canFlip: false, speaker: null, members: [], poor: false, tip: '', notice: '', minimized: false,
};
let state: CallState = idle;
const listeners = new Set<() => void>();
function set(p: Partial<CallState>) { state = { ...state, ...p }; listeners.forEach(l => l()); }
export const callState = () => state;
const subscribeCall = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export function useCall<T>(sel: (s: CallState) => T): T {
	return useSelector(subscribeCall, callState, sel);
}

let room: Room | null = null;
let lkMod: typeof import('livekit-client') | null = null;
let audioBox: HTMLDivElement | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let ringTimer: ReturnType<typeof setTimeout> | null = null;
let poorTimer: ReturnType<typeof setTimeout> | null = null;
let tipTimer: ReturnType<typeof setTimeout> | null = null;
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

function showTip(tip: string) {
	if (tipTimer) clearTimeout(tipTimer);
	set({ tip });
	tipTimer = setTimeout(() => set({ tip: '' }), 4000);
}

async function titleFor(conversationId: string): Promise<{ title: string; kind: 'direct' | 'group' }> {
	const c = getState().convs?.find(x => x.id === conversationId);
	if (c) return { title: c.kind === 'group' ? c.title || 'Group' : c.other_display_name || 'Silo user', kind: c.kind };
	return { title: 'Call', kind: 'direct' };
}

/** The camera track of a participant ('me' = the local one), for <video> tiles. */
export function videoTrack(identity: string): Track | null {
	const r = room, lk = lkMod;
	if (!r || !lk) return null;
	const p = identity === r.localParticipant.identity ? r.localParticipant : r.remoteParticipants.get(identity);
	const pub = p?.getTrackPublication(lk.Track.Source.Camera);
	return pub && !pub.isMuted && pub.track ? pub.track : null;
}

function readMembers(r: Room): CallMember[] {
	const lk = lkMod!;
	const speaking = new Set(r.activeSpeakers.map(p => p.identity));
	const vid = (p: { getTrackPublication: (s: Track.Source) => { isMuted: boolean; track?: unknown; trackSid: string } | undefined }) => {
		const pub = p.getTrackPublication(lk.Track.Source.Camera);
		return pub && !pub.isMuted && pub.track ? pub.trackSid : null;
	};
	const poor = (q: string) => q === lk.ConnectionQuality.Poor || q === lk.ConnectionQuality.Lost;
	const lp = r.localParticipant;
	const lv = vid(lp);
	return [
		{ id: lp.identity, name: 'You', speaking: speaking.has(lp.identity), muted: !lp.isMicrophoneEnabled, me: true, connected: true, video: !!lv, videoKey: lv, poor: poor(lp.connectionQuality) },
		...Array.from(r.remoteParticipants.values()).map(p => {
			const v = vid(p);
			return { id: p.identity, name: p.name || 'Silo user', speaking: speaking.has(p.identity), muted: !p.isMicrophoneEnabled, me: false, connected: true, video: !!v, videoKey: v, poor: poor(p.connectionQuality) };
		}),
	];
}

function mediaError(e: unknown): string {
	const msg = (e as Error)?.message || '';
	const name = (e as Error)?.name || '';
	if (/NotAllowed|Permission|denied/i.test(name + msg)) return 'Silo can’t use your microphone or camera. Allow access for Silo in your settings, then try again.';
	if (/NotFound|Requested device not found/i.test(name + msg)) return 'No microphone or camera was found on this device.';
	if (/NotReadable|in use|Could not start/i.test(name + msg)) return 'Your microphone or camera is being used by another app.';
	return '';
}

/** Ask for the microphone (and camera) up front, so a refusal is explained instead of silently failing. */
async function checkDevices(video: boolean) {
	if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser can’t make calls. Try a recent Chrome, Safari, Edge or Firefox.');
	const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: video ? { facingMode: 'user' } : false });
	stream.getTracks().forEach(t => t.stop());
}

async function updateCanFlip() {
	try {
		const cams = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
		set({ canFlip: cams.length > 1 });
	} catch { /* unsupported */ }
}

async function connect(url: string, token: string) {
	const lk = lkMod ?? (lkMod = await import('livekit-client'));
	const r = new lk.Room({
		adaptiveStream: true, // download only the size each tile needs, nothing for hidden tiles
		dynacast: true,       // stop sending layers nobody watches
		audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
		videoCaptureDefaults: { resolution: lk.VideoPresets.h540.resolution, facingMode: 'user' },
		publishDefaults: {
			simulcast: true,
			videoSimulcastLayers: [lk.VideoPresets.h180, lk.VideoPresets.h360],
			videoEncoding: { maxBitrate: 800_000, maxFramerate: 24 },
		},
	});
	const refresh = () => {
		if (room !== r) return;
		set({ members: readMembers(r), muted: !r.localParticipant.isMicrophoneEnabled, camera: r.localParticipant.isCameraEnabled });
	};
	r.on(lk.RoomEvent.TrackSubscribed, track => {
		if (track.kind === lk.Track.Kind.Audio) {
			const el = track.attach();
			el.setAttribute('playsinline', 'true');
			box().appendChild(el);
		}
		refresh(); // video tiles attach themselves (CallScreen)
	});
	r.on(lk.RoomEvent.TrackUnsubscribed, track => {
		if (track.kind === lk.Track.Kind.Audio) track.detach().forEach(el => el.remove());
		refresh();
	});
	r.on(lk.RoomEvent.ActiveSpeakersChanged, refresh);
	r.on(lk.RoomEvent.TrackMuted, refresh);
	r.on(lk.RoomEvent.TrackUnmuted, refresh);
	r.on(lk.RoomEvent.TrackPublished, refresh);
	r.on(lk.RoomEvent.TrackUnpublished, refresh);
	r.on(lk.RoomEvent.LocalTrackPublished, refresh);
	r.on(lk.RoomEvent.LocalTrackUnpublished, refresh);
	r.on(lk.RoomEvent.ConnectionQualityChanged, (quality, participant) => {
		refresh();
		if (participant !== r.localParticipant) return;
		const poor = quality === lk.ConnectionQuality.Poor || quality === lk.ConnectionQuality.Lost;
		set({ poor });
		if (poorTimer) { clearTimeout(poorTimer); poorTimer = null; }
		// Weak for 8 s with the camera on: pause my camera so the voice keeps going.
		if (poor && r.localParticipant.isCameraEnabled) {
			poorTimer = setTimeout(async () => {
				if (room !== r || !state.poor || !r.localParticipant.isCameraEnabled) return;
				await r.localParticipant.setCameraEnabled(false).catch(() => {});
				refresh();
				showTip('Camera paused: weak connection. Voice continues.');
			}, 8000);
		}
	});
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
	startKeepAlive(state.title || 'Call', { hangUp: () => void hangUp(), toggleMute: () => void toggleMute() });
	if (canSwitchSpeaker()) {
		onNativeSpeaker(on => set({ speaker: on }));
		set({ speaker: nativeSpeakerOn() ?? true });
	}
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
	if (poorTimer) { clearTimeout(poorTimer); poorTimer = null; }
	const r = room;
	room = null;
	if (r) { try { await r.disconnect(); } catch { /* gone */ } } // also stops the camera
	if (audioBox) audioBox.innerHTML = '';
	set({ phase: 'ended', notice, members: [], camera: false, poor: false, tip: '' });
	const id = state.callId;
	setTimeout(() => {
		if (state.phase !== 'ended' || state.callId !== id) return;
		state = { ...idle };
		listeners.forEach(l => l());
	}, 1800);
}

async function cameraOn(on: boolean) {
	const r = room;
	if (!r) return;
	await r.localParticipant.setCameraEnabled(on, { facingMode: state.facing, resolution: lkMod!.VideoPresets.h540.resolution });
	set({ camera: r.localParticipant.isCameraEnabled, members: readMembers(r) });
	if (on) void updateCanFlip();
}

// ---------------------------------------------------------------- actions (call from taps)

export async function startCall(conversationId: string, media: Media = 'audio') {
	if (state.phase !== 'idle' && state.phase !== 'ended') return;
	unlockAudio();
	const { title, kind } = await titleFor(conversationId);
	set({ ...idle, phase: 'connecting', conversationId, title, kind, media, callerName: 'You' });
	try {
		await checkDevices(media === 'video');
		const r = await api<{ call: { id: string; status: string; kind: 'direct' | 'group'; created: boolean; media?: Media }; url: string; token: string }>('/api/calls', { conversationId, media });
		set({ callId: r.call.id, kind: r.call.kind, media: r.call.media ?? media });
		await connect(r.url, r.token);
		if (media === 'video') await cameraOn(true).catch(e => showTip(mediaError(e) || 'Couldn’t start your camera'));
		if (r.call.created) {
			set({ phase: 'outgoing' }); // ringing the others; becomes active when someone answers
			startRingback();
		} else {
			set({ phase: 'active', answeredAt: Date.now() }); // joined a group call already in progress
		}
		startPings();
		haptic(10);
	} catch (e) {
		const why = mediaError(e);
		if (state.callId) void api(`/api/calls/${state.callId}/leave`, {}).catch(() => {});
		await finish(why || (e as Error).message || 'Couldn’t start the call');
	}
}

/** Answer the ringing call: with my camera on (withVideo) or audio only. */
export async function acceptCall(withVideo = false) {
	const id = state.callId;
	if (!id || state.phase !== 'incoming') return;
	stopRinging();
	unlockAudio();
	set({ phase: 'connecting' });
	try {
		await checkDevices(withVideo);
		const r = await api<{ url: string; token: string }>(`/api/calls/${id}/join`, {});
		await connect(r.url, r.token);
		if (withVideo) await cameraOn(true).catch(e => showTip(mediaError(e) || 'Couldn’t start your camera'));
		set({ phase: 'active', answeredAt: Date.now() });
		startPings();
	} catch (e) {
		const why = mediaError(e);
		if (why) void api(`/api/calls/${id}/leave`, {}).catch(() => {});
		await finish(why || (e as Error).message || 'Couldn’t join the call');
	}
}

/** Join a group call that is already running (from the banner in the chat). Camera starts off. */
export async function joinGroupCall(callId: string, conversationId: string) {
	if (state.phase !== 'idle' && state.phase !== 'ended') return;
	const { title } = await titleFor(conversationId);
	set({ ...idle, phase: 'incoming', callId, conversationId, kind: 'group', title });
	await acceptCall(false);
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

/** Camera on/off in any call (a voice call can become a video call and back). */
export async function toggleCamera() {
	if (!room) return;
	haptic(8);
	try { await cameraOn(!state.camera); } catch (e) { showTip(mediaError(e) || 'Couldn’t start your camera'); }
}

/** Front ↔ back camera (phones). */
export async function flipCamera() {
	const r = room, lk = lkMod;
	if (!r || !lk || !state.camera) return;
	const next = state.facing === 'user' ? 'environment' : 'user';
	const track = r.localParticipant.getTrackPublication(lk.Track.Source.Camera)?.track as LocalVideoTrack | undefined;
	try {
		await track?.restartTrack({ facingMode: next, resolution: lk.VideoPresets.h540.resolution });
		set({ facing: next, members: readMembers(r) });
		haptic(8);
	} catch { showTip('Couldn’t switch camera'); }
}

export const setMinimized = (minimized: boolean) => set({ minimized });

/** Loudspeaker on/off (Android app). The app confirms the new route through onNativeSpeaker. */
export function toggleSpeaker() {
	if (state.speaker === null) return;
	const next = !state.speaker;
	nativeSetSpeaker(next);
	set({ speaker: next });
	haptic(8);
}

// ---------------------------------------------------------------- incoming calls

/** Show the ringing sheet for a call I'm invited to (from Realtime, a push tap, or a resync). */
export async function presentIncoming(callId: string) {
	if (declinedHere.has(callId) || state.callId === callId) return;
	if (state.phase !== 'idle' && state.phase !== 'ended') return; // busy: the server marks it missed
	const db = supabase();
	const meId = getState().meId;
	const [{ data: call }, { data: mine }] = await Promise.all([
		db.from('call_sessions').select('id, conversation_id, kind, status, started_by, media').eq('id', callId).maybeSingle(),
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
	set({ ...idle, phase: 'incoming', callId, conversationId: call.conversation_id, kind: call.kind, media: call.media, title, callerName });
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
