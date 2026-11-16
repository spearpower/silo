import { fail, json, rateLimited, withUser } from '@/lib/http';
import { alertTest, pushConfigured } from '@/lib/push';

// POST: send a test alert to my own phones
export const POST = withUser(async user => {
	if (!pushConfigured()) return fail('Phone alerts aren’t set up on this server yet', 503);
	if (rateLimited(`pushtest:${user.id}`, 3, 60000)) return fail('Wait a minute before sending another test', 429);
	const sent = await alertTest(user.id);
	if (!sent) return fail('Alerts aren’t on for any of your phones yet. Switch them on first.', 404);
	return json({ sent });
});
