import { json, must, withUser, HttpError } from '@/lib/api';
import { isUuid } from '@/lib/validate';

export const POST = withUser<{ id: string }>(async ({ db }, { id }) => {
	if (!isUuid(id)) throw new HttpError('Call not found', 404);
	must(await db.rpc('decline_call', { p_call: id }), 'decline_call');
	return json({ ok: true });
});
