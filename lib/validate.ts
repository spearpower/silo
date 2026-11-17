// Small, dependency-free input checks shared by API routes (and unit-tested).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

export const MAX_MESSAGE = 4000;

/** Trimmed message text, or null when empty / too long / not a string. Control characters (except newlines/tabs) are removed. */
export function cleanMessage(v: unknown): string | null {
	if (typeof v !== 'string') return null;
	// eslint-disable-next-line no-control-regex
	const t = v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\r\n?/g, '\n').trim();
	if (!t || t.length > MAX_MESSAGE) return null;
	return t;
}

export const USERNAME = /^[a-z0-9_]{3,20}$/;
export const normalUsername = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : '');

export function cleanName(v: unknown, max = 50): string | null {
	if (typeof v !== 'string') return null;
	const t = v.replace(/\s+/g, ' ').trim();
	return t && t.length <= max ? t : null;
}

export const isEmail = (v: unknown): v is string => typeof v === 'string' && v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

/** Same-site relative path for post-sign-in redirects (blocks //evil.com and absolute URLs). */
export function safeNext(v: unknown, fallback = '/'): string {
	if (typeof v !== 'string' || !v.startsWith('/') || v.startsWith('//') || v.startsWith('/\\')) return fallback;
	return v;
}
