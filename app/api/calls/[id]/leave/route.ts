import { after } from 'next/server';
import { json, must, withUser, HttpError } from '@/lib/api';
import { isUuid } from '@/lib/validate';
import { alertMissed } from '@/lib/push';

// Hang up. If the caller hangs up before anyone answered, the others get a "missed call" alert.
export const POST = withUser<{ id: string }>(async ({ db }, { id }) => {
	if (!isUuid(id)) throw new HttpError('Call not found', 404);
	const missed = must(await db.rpc('leave_call', { p_call: id }), 'leave_call');
	if (missed?.length) after(() => alertMissed(missed));
	return json({ ok: true });
});
