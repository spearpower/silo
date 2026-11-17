import { describe, expect, it } from 'vitest';
import { receiptOf } from '@/lib/receipts';
import { duration, initials, lastSeenText, listStamp } from '@/lib/format';

const me = 'me', bob = 'bob', carol = 'carol';
const msg = { created_at: '2026-11-17T10:00:00.500000+00:00' };
const member = (id: string, delivered: string | null, read: string | null, joined = '2026-11-01T00:00:00Z') =>
	({ id, joined_at: joined, last_delivered_at: delivered, receipt_read_at: read });

describe('receipts', () => {
	it('sent -> delivered -> read for a direct chat', () => {
		expect(receiptOf(msg, [member(me, null, null), member(bob, null, null)], me)).toBe('sent');
		expect(receiptOf(msg, [member(bob, '2026-11-17T10:00:01Z', null)], me)).toBe('delivered');
		expect(receiptOf(msg, [member(bob, '2026-11-17T10:00:01Z', '2026-11-17T10:00:02Z')], me)).toBe('read');
	});

	it('compares times, not strings (mixed Z / +00:00 formats)', () => {
		// 10:00:00.9Z is AFTER 10:00:00.5+00:00 even though the strings would sort the other way
		expect(receiptOf(msg, [member(bob, null, '2026-11-17T10:00:00.9Z')], me)).toBe('read');
		expect(receiptOf(msg, [member(bob, null, '2026-11-17T10:00:00.1Z')], me)).toBe('sent');
	});

	it('groups: read only when everyone has read; later joiners are ignored', () => {
		const later = member(carol, null, null, '2026-11-17T11:00:00Z');
		expect(receiptOf(msg, [member(bob, null, '2026-11-17T10:01:00Z'), later], me)).toBe('read');
		expect(receiptOf(msg, [member(bob, null, '2026-11-17T10:01:00Z'), member(carol, '2026-11-17T10:01:00Z', null)], me)).toBe('delivered');
	});

	it('receipts switched off: delivered at most', () => {
		expect(receiptOf(msg, [member(bob, '2026-11-17T10:05:00Z', null)], me)).toBe('delivered');
	});

	it('local states win', () => {
		expect(receiptOf({ ...msg, pending: true }, [], me)).toBe('pending');
		expect(receiptOf({ ...msg, failed: 'offline' }, [], me)).toBe('failed');
	});
});

describe('format', () => {
	it('durations', () => {
		expect(duration(5)).toBe('0:05');
		expect(duration(75)).toBe('1:15');
		expect(duration(3725)).toBe('1:02:05');
	});
	it('initials', () => {
		expect(initials('Gerald Kisangala')).toBe('GK');
		expect(initials('bob')).toBe('BO');
		expect(initials('')).toBe('?');
	});
	it('last seen', () => {
		const now = Date.parse('2026-11-17T12:00:00Z');
		expect(lastSeenText('2026-11-17T11:59:30Z', now)).toBe('last seen just now');
		expect(lastSeenText('2026-11-17T11:30:00Z', now)).toBe('last seen 30 min ago');
		expect(lastSeenText(null, now)).toBe('');
	});
	it('list stamps', () => {
		const now = new Date('2026-11-17T12:00:00');
		expect(listStamp('2026-11-16T09:00:00', now)).toBe('Yesterday');
		expect(listStamp(null, now)).toBe('');
	});
});
