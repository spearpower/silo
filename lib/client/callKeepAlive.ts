'use client';
// Helps a web call survive on phones while it is running:
//  - Screen Wake Lock: the screen doesn't dim/auto-lock mid-call (the most common reason audio stopped).
//    Browsers drop the lock whenever the page is hidden, so it is re-requested when Silo is visible again.
//  - Media Session: tells the phone this page is in an active call (lock-screen / notification controls on
//    Android Chrome, including hang up and mute where supported).
// A browser still can't keep the microphone running if the person presses the power button; that needs the
// native Android app (planned). Everything here is best effort and silently skipped where unsupported.

interface WakeLockSentinelLike { release: () => Promise<void>; released: boolean; addEventListener: (t: 'release', f: () => void) => void }

let active = false;
let lock: WakeLockSentinelLike | null = null;
let handlers: { hangUp: () => void; toggleMute: () => void } | null = null;

async function requestLock() {
	if (!active || document.visibilityState !== 'visible' || (lock && !lock.released)) return;
	try {
		const wl = (navigator as unknown as { wakeLock?: { request: (t: 'screen') => Promise<WakeLockSentinelLike> } }).wakeLock;
		if (!wl) return;
		lock = await wl.request('screen');
		lock.addEventListener('release', () => { lock = null; });
	} catch { /* denied (battery saver) or unsupported */ }
}

const onVisible = () => { if (document.visibilityState === 'visible') void requestLock(); };

type Action = 'hangup' | 'togglemicrophone';
function setAction(action: Action, fn: (() => void) | null) {
	try { navigator.mediaSession?.setActionHandler(action as MediaSessionAction, fn); } catch { /* action not supported */ }
}

export function startKeepAlive(title: string, h: { hangUp: () => void; toggleMute: () => void }) {
	handlers = h;
	if (!active) {
		active = true;
		document.addEventListener('visibilitychange', onVisible);
	}
	void requestLock();
	try {
		if ('mediaSession' in navigator) {
			navigator.mediaSession.metadata = new MediaMetadata({
				title, artist: 'Silo voice call', artwork: [{ src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' }],
			});
			navigator.mediaSession.playbackState = 'playing';
			setAction('hangup', () => handlers?.hangUp());
			setAction('togglemicrophone', () => handlers?.toggleMute());
		}
	} catch { /* unsupported */ }
}

export function setKeepAliveMuted(muted: boolean) {
	try {
		const ms = navigator.mediaSession as MediaSession & { setMicrophoneActive?: (a: boolean) => void };
		ms?.setMicrophoneActive?.(!muted);
	} catch { /* unsupported */ }
}

export function stopKeepAlive() {
	if (!active) return;
	active = false;
	handlers = null;
	document.removeEventListener('visibilitychange', onVisible);
	const l = lock;
	lock = null;
	if (l && !l.released) void l.release().catch(() => {});
	try {
		if ('mediaSession' in navigator) {
			setAction('hangup', null);
			setAction('togglemicrophone', null);
			navigator.mediaSession.metadata = null;
			navigator.mediaSession.playbackState = 'none';
		}
	} catch { /* unsupported */ }
}
