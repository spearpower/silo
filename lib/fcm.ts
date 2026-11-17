import 'server-only';
// Firebase Cloud Messaging (HTTP v1) for the Silo Android app, without extra dependencies.
// Auth: a Firebase service account (Project settings → Service accounts → Generate new private key), given to
// the server as FIREBASE_SERVICE_ACCOUNT (the JSON file's contents, or the same base64-encoded). Server only.
import { createSign } from 'crypto';

interface ServiceAccount { project_id: string; client_email: string; private_key: string }

let account: ServiceAccount | null | undefined;
function serviceAccount(): ServiceAccount | null {
	if (account !== undefined) return account;
	const raw = (process.env.FIREBASE_SERVICE_ACCOUNT || '').trim();
	account = null;
	if (!raw) return null;
	try {
		const json = JSON.parse(raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8')) as ServiceAccount;
		if (json.project_id && json.client_email && json.private_key) account = { ...json, private_key: json.private_key.replace(/\\n/g, '\n') };
	} catch { console.error('[fcm] FIREBASE_SERVICE_ACCOUNT is not valid JSON'); }
	return account;
}

export const fcmConfigured = () => !!serviceAccount();

const b64url = (s: string | Buffer) => Buffer.from(s).toString('base64url');

/** Short-lived OAuth token for FCM, cached per server instance until shortly before it expires. */
let cached: { token: string; until: number } | null = null;
async function accessToken(sa: ServiceAccount): Promise<string> {
	if (cached && cached.until > Date.now()) return cached.token;
	const now = Math.floor(Date.now() / 1000);
	const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify({
		iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging',
		aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
	}))}`;
	const signature = createSign('RSA-SHA256').update(unsigned).sign(sa.private_key);
	const res = await fetch('https://oauth2.googleapis.com/token', {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${b64url(signature)}` }),
		signal: AbortSignal.timeout(8000),
	});
	const data = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
	if (!res.ok || !data.access_token) throw new Error(`token request failed (${res.status} ${data.error || ''})`);
	cached = { token: data.access_token, until: Date.now() + Math.max(60, (data.expires_in || 3600) - 120) * 1000 };
	return cached.token;
}

export type FcmResult = 'sent' | 'gone' | 'failed';

/** Data-only, high-priority message (the app decides how to show it). 'gone' = token no longer valid. */
export async function sendFcm(token: string, data: Record<string, string>, ttlSeconds: number): Promise<FcmResult> {
	const sa = serviceAccount();
	if (!sa) return 'failed';
	try {
		const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${await accessToken(sa)}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({ message: { token, data, android: { priority: 'HIGH', ttl: `${Math.max(0, Math.round(ttlSeconds))}s` } } }),
			signal: AbortSignal.timeout(8000),
		});
		if (res.ok) return 'sent';
		const body = await res.text().catch(() => '');
		if (res.status === 404 || /UNREGISTERED|registration-token-not-registered/.test(body)) return 'gone';
		if (res.status === 400 && /INVALID_ARGUMENT/.test(body) && /token/i.test(body)) return 'gone';
		console.error('[fcm] send', res.status, body.slice(0, 300));
		return 'failed';
	} catch (e) {
		console.error('[fcm] send', (e as Error).message);
		return 'failed';
	}
}
