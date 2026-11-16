'use client';
// PicknPlay game sounds (public/sounds/*.wav, synthesized by tools/gen_pnp_sounds.py, gen_ding.py, gen_sounds.py).
// Played through the Web Audio API: low latency, sounds can overlap, one volume for all. Falls back to
// <audio> elements where Web Audio isn't available. Phones only allow sound after a tap, so the first
// tap anywhere unlocks it. Settings (on/off, volume) are per device, in localStorage.
export type SoundName =
	| 'turn' | 'chat' | 'deal' | 'play' | 'draw' | 'shuffle' | 'penalty' | 'hit' | 'cancel' | 'suit'
	| 'skip' | 'reverse' | 'cut' | 'lastcard' | 'win' | 'lose' | 'tick' | 'error';

const NAMES: SoundName[] = ['turn', 'chat', 'deal', 'play', 'draw', 'shuffle', 'penalty', 'hit', 'cancel', 'suit', 'skip', 'reverse', 'cut', 'lastcard', 'win', 'lose', 'tick', 'error'];
/** Relative loudness of each sound (multiplied by the volume setting). */
const LEVEL: Record<SoundName, number> = {
	turn: 0.85, chat: 0.6, deal: 0.6, play: 0.6, draw: 0.55, shuffle: 0.55, penalty: 0.75, hit: 0.85, cancel: 0.75,
	suit: 0.6, skip: 0.7, reverse: 0.65, cut: 0.85, lastcard: 0.7, win: 0.85, lose: 0.7, tick: 0.5, error: 0.5,
};
const KEY = 'picknplay.sound';
const VOL_KEY = 'picknplay.volume';

type Ctx = AudioContext;
let ctx: Ctx | null = null;
let gain: GainNode | null = null;
const buffers: Partial<Record<SoundName, AudioBuffer>> = {};
const fallback: Partial<Record<SoundName, HTMLAudioElement>> = {};
let started = false;
const lastPlayed: Partial<Record<SoundName, number>> = {};

const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } };

export function soundOn(): boolean { return read(KEY) !== 'off'; }
/** 0..1 (default 0.8). */
export function soundVolume(): number { const v = Number(read(VOL_KEY)); return Number.isFinite(v) && read(VOL_KEY) !== null ? Math.min(1, Math.max(0, v)) : 0.8; }

export function setSoundOn(on: boolean) {
	write(KEY, on ? 'on' : 'off');
	if (on) playSound('turn', true);
}
export function setSoundVolume(v: number) {
	write(VOL_KEY, String(Math.min(1, Math.max(0, v))));
	if (gain) gain.gain.value = soundVolume();
	for (const n of NAMES) if (fallback[n]) fallback[n]!.volume = LEVEL[n] * soundVolume();
}

async function load(name: SoundName) {
	if (!ctx || buffers[name]) return;
	try {
		const res = await fetch(`/sounds/${name}.wav`);
		buffers[name] = await ctx.decodeAudioData(await res.arrayBuffer());
	} catch { /* missing or undecodable: that sound stays silent */ }
}

/** Call once on pages that play sounds (the table, the waiting room, the Account page). */
export function initSound() {
	if (typeof window === 'undefined' || started) return;
	started = true;
	const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
	if (AC) {
		ctx = new AC();
		gain = ctx.createGain();
		gain.gain.value = soundVolume();
		gain.connect(ctx.destination);
		for (const n of NAMES) void load(n);
	} else {
		for (const n of NAMES) {
			const a = new Audio(`/sounds/${n}.wav`);
			a.preload = 'auto';
			a.volume = LEVEL[n] * soundVolume();
			fallback[n] = a;
		}
	}
	const unlock = () => {
		if (ctx && ctx.state !== 'running') void ctx.resume();
		for (const a of Object.values(fallback)) {
			if (!a) continue;
			a.muted = true;
			a.play().then(() => { a.pause(); a.currentTime = 0; a.muted = false; }).catch(() => { a.muted = false; });
		}
	};
	window.addEventListener('pointerdown', unlock, { passive: true });
	window.addEventListener('keydown', unlock);
	// Phones suspend audio in the background: wake it when the page comes back
	document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && ctx?.state === 'suspended') void ctx.resume().catch(() => {}); });
}

/**
 * Play a sound (unless sounds are off). `force` plays even when off (the "test" sound when turning it on).
 * The same sound within 60 ms is dropped, so a burst of events doesn't stack into noise.
 */
export function playSound(name: SoundName, force = false) {
	if (typeof window === 'undefined' || (!force && !soundOn())) return;
	const now = performance.now();
	if (now - (lastPlayed[name] || 0) < 60) return;
	lastPlayed[name] = now;
	if (ctx && gain) {
		const buf = buffers[name];
		if (!buf) { void load(name); return; }
		if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
		const src = ctx.createBufferSource();
		src.buffer = buf;
		const g = ctx.createGain();
		g.gain.value = LEVEL[name];
		src.connect(g).connect(gain);
		src.start();
		return;
	}
	const a = fallback[name];
	if (!a) return;
	try { a.currentTime = 0; a.play().catch(() => { /* not unlocked yet */ }); } catch { /* ignore */ }
}

/** Back-compat for the turn chime. */
export const playTurnSound = (force = false) => playSound('turn', force);
