import { after } from 'next/server';
import { json, limit, must, readJson, withUser, HttpError } from '@/lib/api';
import { cleanMessage, isUuid } from '@/lib/validate';
import { alertMessage } from '@/lib/push';

// Send a text message. The insert runs as the signed-in person (send_message is security invoker), so RLS decides
// whether they may post here; the server adds validation, rate limiting and the push alert.
export const POST = withUser(async ({ db, req }) => {
	const b = await readJson<{ conversationId: string; body: string; clientId: string; replyTo: string }>(req);
	if (!isUuid(b.conversationId)) throw new HttpError('Unknown chat');
	const text = cleanMessage(b.body);
	if (!text) throw new HttpError('Messages must be 1 to 4000 characters');
	const clientId = isUuid(b.clientId) ? b.clientId : null;
	const replyTo = isUuid(b.replyTo) ? b.replyTo : null; // the database drops it unless it's in the same chat
	await limit(db, 'send', 30, 10);
	const msg = must(await db.rpc('send_message', { p_conv: b.conversationId, p_body: text, p_client_id: clientId, p_reply_to: replyTo }), 'send_message');
	if (!msg) throw new HttpError('Couldn’t send the message', 500);
	after(() => alertMessage(msg));
	return json({ message: msg });
});
