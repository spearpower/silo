import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createVerify, generateKeyPairSync } from 'crypto';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

beforeAll(() => {
	process.env.FIREBASE_SERVICE_ACCOUNT = Buffer.from(JSON.stringify({
		project_id: 'silo-test', client_email: 'push@silo-test.iam.gserviceaccount.com',
		private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
	})).toString('base64');
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('Firebase Cloud Messaging sender', () => {
	it('signs a valid service-account JWT and sends a data-only high-priority message', async () => {
		const calls: { url: string; init: RequestInit }[] = [];
		vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
			calls.push({ url, init });
			if (url.includes('oauth2')) return new Response(JSON.stringify({ access_token: 'ya29.test', expires_in: 3600 }), { status: 200 });
			return new Response('{}', { status: 200 });
		}));
		const { sendFcm, fcmConfigured } = await import('@/lib/fcm');
		expect(fcmConfigured()).toBe(true);
		const r = await sendFcm('device-token-1234567890', { kind: 'call', title: 'Alice is calling', url: '/c/x?call=y' }, 45);
		expect(r).toBe('sent');

		const assertion = new URLSearchParams(String(calls[0].init.body)).get('assertion')!;
		const [h, p, sig] = assertion.split('.');
		const ok = createVerify('RSA-SHA256').update(`${h}.${p}`).verify(publicKey, Buffer.from(sig, 'base64url'));
		expect(ok).toBe(true);
		const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
		expect(claims.scope).toBe('https://www.googleapis.com/auth/firebase.messaging');
		expect(claims.exp - claims.iat).toBe(3600);

		expect(calls[1].url).toBe('https://fcm.googleapis.com/v1/projects/silo-test/messages:send');
		expect((calls[1].init.headers as Record<string, string>).Authorization).toBe('Bearer ya29.test');
		const msg = JSON.parse(String(calls[1].init.body)).message;
		expect(msg.notification).toBeUndefined(); // data-only: the app decides how to show it
		expect(msg.data.kind).toBe('call');
		expect(msg.android).toEqual({ priority: 'HIGH', ttl: '45s' });
	});

	it('reports uninstalled / replaced tokens as gone', async () => {
		vi.stubGlobal('fetch', vi.fn(async (url: string) => (url.includes('oauth2')
			? new Response(JSON.stringify({ access_token: 'ya29.test', expires_in: 3600 }), { status: 200 })
			: new Response(JSON.stringify({ error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } }), { status: 404 }))));
		const { sendFcm } = await import('@/lib/fcm');
		expect(await sendFcm('old-token-1234567890', { kind: 'message' }, 3600)).toBe('gone');
	});
});
