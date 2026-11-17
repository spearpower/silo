// Wording of notifications (pure functions, unit-tested). Message text only appears when the recipient
// switched "Show message text in notifications" on; otherwise notifications say only who wrote.

export interface PushPayload { title: string; body: string; url: string; tag: string; kind: 'message' | 'call' | 'missed' | 'test'; callId?: string }

export function messageNotification(o: {
	conversationId: string; kind: 'direct' | 'group'; groupTitle: string | null; senderName: string; text: string; previews: boolean;
}): PushPayload {
	const text = o.text.length > 140 ? o.text.slice(0, 139) + '…' : o.text;
	const title = o.kind === 'group' ? (o.groupTitle || 'Group') : o.senderName;
	const body = o.previews
		? (o.kind === 'group' ? `${o.senderName}: ${text}` : text)
		: (o.kind === 'group' ? `${o.senderName} sent a message` : 'New message');
	return { title, body, url: `/c/${o.conversationId}`, tag: `conv-${o.conversationId}`, kind: 'message' };
}

export function incomingCallNotification(o: { conversationId: string; callId: string; kind: 'direct' | 'group'; groupTitle: string | null; callerName: string }): PushPayload {
	return o.kind === 'group'
		? { title: o.groupTitle || 'Group call', body: `${o.callerName} started a voice call. Tap to join.`, url: `/c/${o.conversationId}?call=${o.callId}`, tag: `call-${o.callId}`, kind: 'call', callId: o.callId }
		: { title: `${o.callerName} is calling`, body: 'Incoming voice call. Tap to answer.', url: `/c/${o.conversationId}?call=${o.callId}`, tag: `call-${o.callId}`, kind: 'call', callId: o.callId };
}

export function missedCallNotification(o: { conversationId: string; callId: string; kind: 'direct' | 'group'; groupTitle: string | null; callerName: string }): PushPayload {
	return {
		title: 'Missed voice call',
		body: o.kind === 'group' ? `${o.callerName} called ${o.groupTitle || 'the group'}` : `${o.callerName} called you`,
		url: `/c/${o.conversationId}`, tag: `call-${o.callId}`, kind: 'missed', callId: o.callId,
	};
}
