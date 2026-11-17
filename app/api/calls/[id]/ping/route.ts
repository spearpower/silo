import { json, must, withUser, HttpError } from '@/lib/api';
import { isUuid } from '@/lib/validate';
import { sweepCalls } from '@/lib/push';

// Keep-alive from a device in a call (every ~20 s). Also drives the time rules (no answer -> missed,
// silent device -> left) without any long-running server process.
export const POST = withUser<{ id: string }>(async ({ db }, { id }) => {
	if (!isUuid(id)) throw new HttpError('Call not found', 404);
	must(await db.rpc('call_ping', { p_call: id }), 'call_ping');
	const { data: call } = await db.from('call_sessions').select('conversation_id').eq('id', id).maybeSingle();
	if (!call) throw new HttpError('Call not found', 404);
	await sweepCalls(call.conversation_id);
	const { data: fresh } = await db.from('call_sessions').select('status, answered_at').eq('id', id).single();
	return json({ status: fresh?.status ?? 'ended', answeredAt: fresh?.answered_at ?? null });
});
