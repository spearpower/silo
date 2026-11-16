import { body, fail, json, withUser } from '@/lib/http';
import { getRules, getSettings, missingServerSettings, setRules, setVirtualFriends, setVoiceChat, voiceConfigured } from '@/lib/settings';
import { getAccount } from '@/lib/users';

// Admin rights are checked against the database (not the cookie), so a role change applies at once.
async function isAdmin(id: number) {
	try { const r = (await getAccount(id)).role as string; return r === 'admin' || r === 'superadmin'; } catch { return false; }
}

const everything = async () => ({ ...(await getSettings()), rules: await getRules(), voiceReady: voiceConfigured(), missing: missingServerSettings() });

export const GET = withUser(async user => {
	if (!(await isAdmin(user.id))) return fail('Admins only', 403);
	return json(await everything());
});

// POST { virtualFriends?: boolean, voiceChat?: boolean, rules?: Partial<RuleOptions> }
export const POST = withUser(async (user, req: Request) => {
	if (!(await isAdmin(user.id))) return fail('Admins only', 403);
	const b = await body<{ virtualFriends: boolean; voiceChat: boolean; rules: Record<string, unknown> }>(req);
	if (typeof b.virtualFriends === 'boolean') await setVirtualFriends(b.virtualFriends, user.id);
	if (typeof b.voiceChat === 'boolean') await setVoiceChat(b.voiceChat, user.id);
	if (b.rules && typeof b.rules === 'object') await setRules(b.rules, user.id);
	return json(await everything());
});
