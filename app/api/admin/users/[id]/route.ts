import { json, must, readJson, withUser, HttpError } from '@/lib/api';
import { isUuid } from '@/lib/validate';
import { adminConfigured, adminSupabase } from '@/lib/supabase/admin';

// Suspend or restore an account (admins only: the database function checks is_admin() first). Suspending also
// bans the Supabase Auth user so their sessions stop refreshing.
export const POST = withUser<{ id: string }>(async ({ db, req }, { id }) => {
	if (!isUuid(id)) throw new HttpError('Unknown account', 404);
	const b = await readJson<{ status: 'active' | 'suspended' }>(req);
	if (b.status !== 'active' && b.status !== 'suspended') throw new HttpError('Unknown status');
	must(await db.rpc('admin_set_user_status', { p_user: id, p_status: b.status }), 'admin_set_user_status');
	if (adminConfigured()) {
		const { error } = await adminSupabase().auth.admin.updateUserById(id, { ban_duration: b.status === 'suspended' ? '876000h' : 'none' });
		if (error) console.error('[admin] ban', error.message);
	}
	return json({ ok: true });
});
