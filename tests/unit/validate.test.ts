import { describe, expect, it } from 'vitest';
import { cleanMessage, cleanName, isEmail, isUuid, safeNext, USERNAME } from '@/lib/validate';

describe('validate', () => {
	it('accepts real UUIDs only', () => {
		expect(isUuid('7c9e6679-7425-40de-944b-e07fc1f90ae7')).toBe(true);
		expect(isUuid('7c9e6679-7425-40de-944b-e07fc1f90ae')).toBe(false);
		expect(isUuid("1' or '1'='1")).toBe(false);
		expect(isUuid(42)).toBe(false);
	});

	it('cleans message text', () => {
		expect(cleanMessage('  hi  ')).toBe('hi');
		expect(cleanMessage('a\r\nb')).toBe('a\nb');
		expect(cleanMessage('x\u0000y\u0007')).toBe('xy');
		expect(cleanMessage('   ')).toBeNull();
		expect(cleanMessage('a'.repeat(4001))).toBeNull();
		expect(cleanMessage('a'.repeat(4000))).toHaveLength(4000);
		expect(cleanMessage({ body: 'x' })).toBeNull();
		// HTML is stored as plain text; React escapes it when rendering (no XSS through messages)
		expect(cleanMessage('<img src=x onerror=alert(1)>')).toBe('<img src=x onerror=alert(1)>');
	});

	it('checks usernames, names and emails', () => {
		expect(USERNAME.test('gerald_k')).toBe(true);
		expect(USERNAME.test('Gerald')).toBe(false);
		expect(USERNAME.test('ab')).toBe(false);
		expect(cleanName('  Jane   Doe ')).toBe('Jane Doe');
		expect(cleanName('x'.repeat(51))).toBeNull();
		expect(isEmail('a@b.co')).toBe(true);
		expect(isEmail('nope')).toBe(false);
	});

	it('only allows same-site redirects after sign-in', () => {
		expect(safeNext('/c/abc')).toBe('/c/abc');
		expect(safeNext('//evil.com')).toBe('/');
		expect(safeNext('/\\evil.com')).toBe('/');
		expect(safeNext('https://evil.com')).toBe('/');
		expect(safeNext(null)).toBe('/');
	});
});
