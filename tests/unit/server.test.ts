import { describe, expect, it, beforeAll } from 'vitest';
import { crossSite, dbError } from '@/lib/api';
import { callToken, TOKEN_TTL } from '@/lib/livekit';

const req = (method: string, headers: Record<string, string>) => new Request('https://silo.example.com/api/messages', { method, headers });

describe('CSRF guard', () => {
	it('allows same-site JSON writes', () => {
		expect(crossSite(req('POST', { origin: 'https://silo.example.com', host: 'silo.example.com', 'content-type': 'application/json' }))).toBe(false);
	});
	it('blocks other origins', () => {
		expect(crossSite(req('POST', { origin: 'https://evil.example', host: 'silo.example.com', 'content-type': 'application/json' }))).toBe(true);
	});
	it('blocks form posts (no JSON body) even without Origin', () => {
		expect(crossSite(req('POST', { host: 'silo.example.com', 'content-type': 'application/x-www-form-urlencoded' }))).toBe(true);
		expect(crossSite(req('POST', { host: 'silo.example.com', 'content-type': 'text/plain' }))).toBe(true);
	});
	it('ignores reads', () => {
		expect(crossSite(req('GET', { origin: 'https://evil.example' }))).toBe(false);
	});
});

describe('database error mapping', () => {
	it('passes through messages we wrote for people', () => {
		const e = dbError({ code: 'P0001', message: 'You can only add your friends to a group', details: '', hint: '', name: 'PostgrestError' } as never, 't');
		expect(e?.status).toBe(400);
		expect(e?.message).toBe('You can only add your friends to a group');
	});
	it('hides internal errors', () => {
		const e = dbError({ code: '42P01', message: 'relation "secret_table" does not exist', details: '', hint: '', name: 'PostgrestError' } as never, 't');
		expect(e?.status).toBe(500);
		expect(e?.message).not.toContain('secret_table');
	});
	it('maps permission errors to 403', () => {
		expect(dbError({ code: '42501', message: 'permission denied for table messages' } as never, 't')?.status).toBe(403);
	});
});

describe('LiveKit tokens', () => {
	beforeAll(() => {
		process.env.LIVEKIT_URL = 'wss://test.livekit.cloud';
		process.env.LIVEKIT_API_KEY = 'APItest';
		process.env.LIVEKIT_API_SECRET = 'secret-secret-secret-secret-secret-secret';
	});
	it('is short-lived, room-bound, microphone + camera only (no screen share, no data)', async () => {
		const { url, token } = await callToken({ identity: 'user-1', name: 'Alice', room: 'silo-call-abc', media: 'audio' });
		expect(url).toBe('wss://test.livekit.cloud');
		const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
		expect(claims.sub).toBe('user-1');
		expect(claims.video.room).toBe('silo-call-abc');
		expect(claims.video.roomJoin).toBe(true);
		expect(claims.video.roomAdmin).toBeFalsy();
		expect(claims.video.canPublishData).toBe(false);
		expect(claims.video.canPublishSources).toEqual(['microphone', 'camera']);
		expect(claims.exp - claims.nbf).toBeLessThanOrEqual(600);
		expect(TOKEN_TTL).toBe('10m');
	});
	it('never allows screen sharing (a later release)', async () => {
		const { token } = await callToken({ identity: 'u', name: 'n', room: 'r', media: 'video' });
		const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
		expect(claims.video.canPublishSources).not.toContain('screen_share');
		expect(claims.video.canPublishSources).not.toContain('screen_share_audio');
	});
});
