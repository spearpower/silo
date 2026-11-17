'use client';
// Bridge to the Silo Android app (silomob). Inside the app, the page has window.SiloAndroid; in a normal
// browser it doesn't, and every helper here does nothing.

export interface SiloAndroidBridge {
	version(): string;
	callStarted(title: string): void;
	callEnded(): void;
	batteryUnrestricted(): boolean;
	openBatterySettings(): void;
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
