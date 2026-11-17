import { json, limit, withUser, HttpError } from '@/lib/api';
import { pushConfigured, sendTo } from '@/lib/push';

// "Send me a test notification" (Settings). Only ever reaches the signed-in person's own devices.
export const POST = withUser(async ({ db, userId }) => {
	if (!pushConfigured()) throw new HttpError('Notifications aren’t set up on this server yet', 503);
	await limit(db, 'push_test', 5, 600);
	const sent = await sendTo([userId], { title: 'Silo notifications work', body: 'This is how you’ll hear about new messages and calls.', url: '/settings', tag: 'test', kind: 'test' }, { ttl: 120 });
	return json({ sent });
});
