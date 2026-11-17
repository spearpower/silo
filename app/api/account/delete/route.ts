import { json, limit, readJson, withUser, HttpError } from '@/lib/api';
import { adminConfigured, adminSupabase } from '@/lib/supabase/admin';

// Delete my account. Removes the Supabase Auth user; the profile, memberships, settings and push subscriptions
// go with it (ON DELETE CASCADE). Messages already sent stay in the chats, shown as "Deleted account".
export const POST = withUser(async ({ db, userId, req }) => {
	const b = await readJson<{ confirm: string }>(req);
	if (b.confirm !== 'DELETE') throw new HttpError('Type DELETE to confirm');
	if (!adminConfigured()) throw new HttpError('Account deletion isn’t set up on this server yet', 503);
	await limit(db, 'delete_account', 3, 3600);
	const { error } = await adminSupabase().auth.admin.deleteUser(userId);
	if (error) { console.error('[account] delete', error.message); throw new HttpError('Couldn’t delete the account. Try again.', 500); }
	await db.auth.signOut().catch(() => {});
	return json({ ok: true });
});
