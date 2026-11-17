import { json, limit, must, readJson, withUser, HttpError } from '@/lib/api';
import { adminConfigured, adminSupabase } from '@/lib/supabase/admin';

interface Body { subscription: { endpoint?: string; keys?: { p256dh?: string; auth?: string } }; remove: string; fcm: string; removeFcm: string; appVersion: string }

const FCM_TOKEN = /^[A-Za-z0-9_:-]{20,4096}$/;

// Save or remove this device's push subscription (always for the signed-in person only).
// Browsers send a Web Push subscription; the Silo Android app sends its Firebase token (fcm).
export const POST = withUser(async ({ db, userId, req }) => {
	const b = await readJson<Body>(req);
	if (typeof b.removeFcm === 'string') {
		must(await db.from('device_tokens').delete().eq('token', b.removeFcm).eq('user_id', userId), 'fcm remove');
		return json({ ok: true });
	}
	if (typeof b.fcm === 'string') {
		if (!FCM_TOKEN.test(b.fcm)) throw new HttpError('That app token isn’t valid');
		// A phone previously signed in as someone else: the server moves the token to the current person.
		if (adminConfigured()) await adminSupabase().from('device_tokens').delete().eq('token', b.fcm).neq('user_id', userId);
		const { data: existing } = await db.from('device_tokens').select('id').eq('token', b.fcm).eq('user_id', userId).maybeSingle();
		if (!existing) {
			await limit(db, 'push_subscribe', 10, 3600); // only new tokens count (the app re-sends its token on every launch)
			must(await db.from('device_tokens').insert({
				user_id: userId, token: b.fcm, platform: 'android',
				app_version: typeof b.appVersion === 'string' ? b.appVersion.slice(0, 40) : null,
			}), 'fcm save');
		}
		return json({ ok: true });
	}
	if (typeof b.remove === 'string') {
		must(await db.from('push_subscriptions').delete().eq('endpoint', b.remove).eq('user_id', userId), 'push remove');
		return json({ ok: true });
	}
	const s = b.subscription;
	if (!s?.endpoint || !/^https:\/\//.test(s.endpoint) || s.endpoint.length > 1000 || !s.keys?.p256dh || !s.keys?.auth
		|| s.keys.p256dh.length > 200 || s.keys.auth.length > 100) {
		throw new HttpError('That notification subscription isn’t valid');
	}
	await limit(db, 'push_subscribe', 10, 3600);
	// A device that was used by someone else before: its old subscription row belongs to them, so the server
	// (not the browser) clears it before saving it for the current person.
	if (adminConfigured()) await adminSupabase().from('push_subscriptions').delete().eq('endpoint', s.endpoint).neq('user_id', userId);
	await db.from('push_subscriptions').delete().eq('endpoint', s.endpoint).eq('user_id', userId);
	must(await db.from('push_subscriptions').insert({
		user_id: userId, endpoint: s.endpoint, p256dh: s.keys.p256dh, auth: s.keys.auth,
		user_agent: (req.headers.get('user-agent') || '').slice(0, 200),
	}), 'push save');
	return json({ ok: true });
});
