'use client';
// Game sounds (public/sounds/*.wav, made by tools/gen_ding.py and tools/gen_sounds.py).
// Phones only allow sound after the person has tapped once, so the first tap anywhere unlocks them.
// One switch (Account page or the bell on the table) mutes them all.
export type SoundName = 'turn' | 'discard' | 'phase' | 'round' | 'win' | 'skip' | 'chat';
const FILES: Record<SoundName, string> = {
	turn: '/sounds/turn.wav', discard: '/sounds/discard.wav', phase: '/sounds/phase.wav',
	round: '/sounds/round.wav', win: '/sounds/win.wav', skip: '/sounds/skip.wav', chat: '/sounds/chat.wav',
};
const VOLUME: Record<SoundName, number> = { turn: 0.8, discard: 0.55, phase: 0.75, round: 0.8, win: 0.85, skip: 0.7, chat: 0.6 };
const KEY = 'picknplay.sound';
const players: Partial<Record<SoundName, HTMLAudioElement>> = {};
let armed = false;

export function soundOn(): boolean {
	try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; }
}

export function setSoundOn(on: boolean) {
	try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* storage blocked: stays on for this visit */ }
	if (on) playSound('turn', true);
}

/** Call once on pages that play sounds (the game board, the Account page). */
export function initSound() {
	if (typeof window === 'undefined') return;
	for (const name of Object.keys(FILES) as SoundName[]) {
		if (players[name]) continue;
		const a = new Audio(FILES[name]);
		a.preload = 'auto';
		a.volume = VOLUME[name];
		players[name] = a;
	}
	if (armed) return;
	armed = true;
	const unlock = () => {
		for (const a of Object.values(players)) {
			if (!a) continue;
			a.muted = true;
			a.play().then(() => { a.pause(); a.currentTime = 0; a.muted = false; }).catch(() => { a.muted = false; });
		}
		window.removeEventListener('pointerdown', unlock);
		window.removeEventListener('keydown', unlock);
	};
	window.addEventListener('pointerdown', unlock, { once: true });
	window.addEventListener('keydown', unlock, { once: true });
}

export function playSound(name: SoundName, force = false) {
	const a = players[name];
	if (!a || (!force && !soundOn())) return;
	try { a.currentTime = 0; a.play().catch(() => { /* not unlocked yet */ }); } catch { /* ignore */ }
}

/** Back-compat for the turn chime. */
export const playTurnSound = (force = false) => playSound('turn', force);
