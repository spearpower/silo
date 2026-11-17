import { json, must, withUser, HttpError } from '@/lib/api';
import { isUuid } from '@/lib/validate';
import { passFor } from '@/lib/calls';
import { livekitConfigured } from '@/lib/livekit';

// Answer a ringing call, or join a running group call.
export const POST = withUser<{ id: string }>(async ({ db, userId }, { id }) => {
	if (!isUuid(id)) throw new HttpError('Call not found', 404);
	if (!livekitConfigured()) throw new HttpError('Voice calls aren’t set up on this server yet', 503);
	const [call] = must(await db.rpc('join_call', { p_call: id }), 'join_call') ?? [];
	if (!call) throw new HttpError('Call not found', 404);
	const pass = await passFor(db, userId, id);
	return json({ call: { id: call.call_id, status: call.status, kind: call.kind }, ...pass });
});
