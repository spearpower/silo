// Wording of notifications (pure functions, unit-tested). Message text only appears when the recipient
// switched "Show message text in notifications" on; otherwise notifications say only who wrote.

export interface PushPayload { title: string; body: string; url: string; tag: string; kind: 'message' | 'call' | 'missed' | 'test'; callId?: string; media?: 'audio' | 'video' }

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

export function incomingCallNotification(o: { conversationId: string; callId: string; kind: 'direct' | 'group'; groupTitle: string | null; callerName: string; media?: 'audio' | 'video' }): PushPayload {
	const what = o.media === 'video' ? 'video call' : 'voice call';
	const base = { url: `/c/${o.conversationId}?call=${o.callId}`, tag: `call-${o.callId}`, kind: 'call' as const, callId: o.callId, media: o.media ?? 'audio' };
	return o.kind === 'group'
		? { ...base, title: o.groupTitle || 'Group call', body: `${o.callerName} started a ${what}. Tap to join.` }
		: { ...base, title: o.media === 'video' ? `${o.callerName} is video calling` : `${o.callerName} is calling`, body: `Incoming ${what}. Tap to answer.` };
}

export function missedCallNotification(o: { conversationId: string; callId: string; kind: 'direct' | 'group'; groupTitle: string | null; callerName: string; media?: 'audio' | 'video' }): PushPayload {
	return {
		title: o.media === 'video' ? 'Missed video call' : 'Missed voice call',
		body: o.kind === 'group' ? `${o.callerName} called ${o.groupTitle || 'the group'}` : `${o.callerName} called you`,
		url: `/c/${o.conversationId}`, tag: `call-${o.callId}`, kind: 'missed', callId: o.callId,
	};
}
