import { describe, expect, it } from 'vitest';
import { incomingCallNotification, messageNotification, missedCallNotification } from '@/lib/notify';

const conv = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

describe('notification wording', () => {
	it('hides message text unless the recipient allowed previews', () => {
		const n = messageNotification({ conversationId: conv, kind: 'direct', groupTitle: null, senderName: 'Bob', text: 'my secret', previews: false });
		expect(n.title).toBe('Bob');
		expect(n.body).toBe('New message');
		expect(JSON.stringify(n)).not.toContain('my secret');
		expect(n.url).toBe(`/c/${conv}`);
	});

	it('shows text with previews on, and names the sender in groups', () => {
		const n = messageNotification({ conversationId: conv, kind: 'group', groupTitle: 'Weekend', senderName: 'Bob', text: 'hi all', previews: true });
		expect(n.title).toBe('Weekend');
		expect(n.body).toBe('Bob: hi all');
		const hidden = messageNotification({ conversationId: conv, kind: 'group', groupTitle: 'Weekend', senderName: 'Bob', text: 'hi all', previews: false });
		expect(hidden.body).toBe('Bob sent a message');
	});

	it('shortens long previews', () => {
		const n = messageNotification({ conversationId: conv, kind: 'direct', groupTitle: null, senderName: 'Bob', text: 'x'.repeat(500), previews: true });
		expect(n.body.length).toBeLessThanOrEqual(140);
	});

	it('call alerts link to the call and share a tag with the missed-call alert', () => {
		const ring = incomingCallNotification({ conversationId: conv, callId: 'c1', kind: 'direct', groupTitle: null, callerName: 'Alice' });
		expect(ring.title).toBe('Alice is calling');
		expect(ring.url).toBe(`/c/${conv}?call=c1`);
		const missed = missedCallNotification({ conversationId: conv, callId: 'c1', kind: 'direct', groupTitle: null, callerName: 'Alice' });
		expect(missed.tag).toBe(ring.tag); // the missed alert replaces the ringing one
		expect(missed.body).toBe('Alice called you');
	});

	it('says "video call" for video calls', () => {
		const ring = incomingCallNotification({ conversationId: conv, callId: 'c2', kind: 'direct', groupTitle: null, callerName: 'Alice', media: 'video' });
		expect(ring.title).toBe('Alice is video calling');
		expect(ring.media).toBe('video');
		expect(missedCallNotification({ conversationId: conv, callId: 'c2', kind: 'direct', groupTitle: null, callerName: 'Alice', media: 'video' }).title).toBe('Missed video call');
	});
});
