'use client';
// Bridge to the Silo Android app (silomob). Inside the app, the page has window.SiloAndroid; in a normal
// browser it doesn't, and every helper here does nothing.

export interface SiloAndroidBridge {
	version(): string;
	callStarted(title: string): void;
	callEnded(): void;
	batteryUnrestricted(): boolean;
	openBatterySettings(): void;
	pushToken?(): string; // app 1.0.0+ with notifications
	setSpeaker?(on: boolean): void; // app 1.0.1+
	isSpeakerOn?(): boolean;
}

export function nativeApp(): SiloAndroidBridge | null {
	if (typeof window === 'undefined') return null;
	return (window as unknown as { SiloAndroid?: SiloAndroidBridge }).SiloAndroid ?? null;
}

export const inAndroidApp = () => !!nativeApp();

/** Call connected: the app starts its "call in progress" service so the call survives the screen locking. */
export function nativeCallStarted(title: string, hangUp: () => void) {
	const app = nativeApp();
	if (!app) return;
	(window as unknown as { siloNativeHangUp?: () => void }).siloNativeHangUp = hangUp; // "End call" in the notification
	try { app.callStarted(title); } catch { /* older app */ }
}

export function nativeCallEnded() {
	const app = nativeApp();
	if (!app) return;
	delete (window as unknown as { siloNativeHangUp?: () => void }).siloNativeHangUp;
	try { app.callEnded(); } catch { /* older app */ }
}

// ---------------------------------------------------------------- app notifications (Firebase)

let registered = '';

async function registerToken(token: string) {
	if (!token || token === registered) return;
	registered = token;
	try {
		const { api } = await import('./api');
		await api('/api/push', { fcm: token, appVersion: nativeApp()?.version() });
	} catch { registered = ''; } // try again next time
}

/** Inside the app: send this phone's notification token to the server (now, and whenever it changes). */
export function registerAppPush() {
	const app = nativeApp();
	if (!app) return;
	(window as unknown as { siloOnPushToken?: (t: string) => void }).siloOnPushToken = t => { void registerToken(t); };
	try { const t = app.pushToken?.(); if (t) void registerToken(t); } catch { /* older app */ }
}

/** On sign-out: stop alerts to this phone for the account that is leaving. */
export async function unregisterAppPush() {
	const app = nativeApp();
	if (!app) return;
	try {
		const t = app.pushToken?.() || registered;
		if (t) { const { api } = await import('./api'); await api('/api/push', { removeFcm: t }); }
	} catch { /* best effort */ }
	registered = '';
}

// ---------------------------------------------------------------- loudspeaker (app 1.0.1+)

/** True when the phone's audio route can be switched (only inside the Android app; browsers can't). */
export const canSwitchSpeaker = () => typeof nativeApp()?.setSpeaker === 'function';

export function nativeSpeakerOn(): boolean | null {
	try { const v = nativeApp()?.isSpeakerOn?.(); return typeof v === 'boolean' ? v : null; } catch { return null; }
}

export function nativeSetSpeaker(on: boolean) {
	try { nativeApp()?.setSpeaker?.(on); } catch { /* older app */ }
}

/** The app reports route changes (also from the notification's Speaker/Earpiece button). */
export function onNativeSpeaker(fn: (on: boolean) => void) {
	(window as unknown as { siloOnSpeaker?: (on: boolean) => void }).siloOnSpeaker = fn;
}
