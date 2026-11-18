import { after } from 'next/server';
import { json, must, readJson, withUser, HttpError } from '@/lib/api';
import { isUuid } from '@/lib/validate';
import { passFor } from '@/lib/calls';
import { livekitConfigured } from '@/lib/livekit';
import { alertIncomingCall, sweepCalls } from '@/lib/push';

// Start a voice call in a chat (or join the group call already running there) and get a LiveKit pass.
export const POST = withUser(async ({ db, userId, req }) => {
	const b = await readJson<{ conversationId: string; media: string }>(req);
	const media = b.media === 'video' ? 'video' : 'audio';
	if (!isUuid(b.conversationId)) throw new HttpError('Unknown chat');
	if (!livekitConfigured()) throw new HttpError('Voice calls aren’t set up on this server yet', 503);
	await sweepCalls(b.conversationId); // settle any stale call first (and alert anyone who missed it)
	const [call] = must(await db.rpc('start_call', { p_conv: b.conversationId, p_media: media }), 'start_call') ?? [];
	if (!call) throw new HttpError('Couldn’t start the call', 500);
	const pass = await passFor(db, userId, call.call_id);
	if (call.created) after(() => alertIncomingCall(call.call_id, userId));
	return json({ call: { id: call.call_id, status: call.status, kind: call.kind, created: call.created, media: call.media }, ...pass });
});
