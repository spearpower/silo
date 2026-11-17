'use client';
// Tiny synthesized sounds (no audio files): message blip, incoming ring, outgoing ringback.
// Browsers only allow audio after the person has interacted with the page; failures are silent.

let ctx: AudioContext | null = null;
function audio(): AudioContext | null {
	try {
		if (!ctx) ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
		if (ctx.state === 'suspended') void ctx.resume();
		return ctx;
	} catch { return null; }
}

function tone(freqs: number[], start: number, length: number, gain = 0.08) {
	const a = audio();
	if (!a) return;
	const g = a.createGain();
	g.gain.setValueAtTime(0, a.currentTime + start);
	g.gain.linearRampToValueAtTime(gain, a.currentTime + start + 0.02);
	g.gain.setValueAtTime(gain, a.currentTime + start + length - 0.05);
	g.gain.linearRampToValueAtTime(0, a.currentTime + start + length);
	g.connect(a.destination);
	for (const f of freqs) {
		const o = a.createOscillator();
		o.type = 'sine';
		o.frequency.value = f;
		o.connect(g);
		o.start(a.currentTime + start);
		o.stop(a.currentTime + start + length + 0.02);
	}
}

export function messageBlip() {
	tone([880], 0, 0.09, 0.05);
	tone([1320], 0.08, 0.12, 0.04);
}

let loop: ReturnType<typeof setInterval> | null = null;
function startLoop(play: () => void, every: number) {
	stopRinging();
	play();
	loop = setInterval(play, every);
}
export function stopRinging() { if (loop) { clearInterval(loop); loop = null; } }

/** Incoming call: two-note chime, repeating. */
export const startRinging = () => startLoop(() => { tone([659, 988], 0, 0.35, 0.07); tone([784, 1175], 0.45, 0.35, 0.07); }, 2200);
/** Outgoing call: soft ringback tone. */
export const startRingback = () => startLoop(() => tone([440, 480], 0, 1.2, 0.03), 3500);

export function haptic(ms: number | number[] = 12) { try { navigator.vibrate?.(ms); } catch { /* iPhone */ } }

/** Call this from a tap early on so later sounds are allowed. */
export function unlockAudio() { audio(); }
