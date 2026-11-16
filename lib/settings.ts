// App-wide settings stored in app_settings (changed by admins): feature switches and the game-rule options.
import { sql } from './db';
import { cleanRules, DEFAULT_RULES, RuleOptions } from './rules';

export interface AppSettings { virtualFriends: boolean; voiceChat: boolean }
type Key = 'virtual_friends' | 'voice_chat';

let cache: { at: number; value: AppSettings; rules: RuleOptions } | null = null;

async function load() {
	if (cache && Date.now() - cache.at < 15000) return cache;
	let value: AppSettings = { virtualFriends: true, voiceChat: false };
	let rules: RuleOptions = DEFAULT_RULES;
	try {
		const rows = await sql<{ key: string; value: Record<string, unknown> }[]>`select key, value from app_settings`;
		const on = (k: Key, dflt: boolean) => { const r = rows.find(x => x.key === k); return r ? r.value?.enabled === true || (dflt && r.value?.enabled !== false) : dflt; };
		value = { virtualFriends: on('virtual_friends', true), voiceChat: on('voice_chat', false) };
		rules = cleanRules(rows.find(x => x.key === 'rules')?.value);
	} catch {
		// app_settings missing (migration 001 not run yet): keep defaults, but Virtual Friends need the migration
		value = { virtualFriends: false, voiceChat: false };
	}
	cache = { at: Date.now(), value, rules };
	return cache;
}

export async function getSettings(): Promise<AppSettings> { return (await load()).value; }

/** The rule options new games start with (each game keeps a snapshot, so changes never affect games in progress). */
export async function getRules(): Promise<RuleOptions> { return (await load()).rules; }

async function put(key: string, value: unknown, adminId: number) {
	await sql`
		insert into app_settings (key, value, updated_at, updated_by) values (${key}, ${sql.json(value as never)}, now(), ${adminId})
		on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by`;
	cache = null;
}

export const setVirtualFriends = (enabled: boolean, adminId: number) => put('virtual_friends', { enabled }, adminId);
export const setVoiceChat = (enabled: boolean, adminId: number) => put('voice_chat', { enabled }, adminId);
export async function setRules(raw: unknown, adminId: number): Promise<RuleOptions> {
	const rules = cleanRules({ ...(await getRules()), ...(raw && typeof raw === 'object' ? raw : {}) });
	await put('rules', rules, adminId);
	console.log('[admin]', JSON.stringify({ by: adminId, action: 'rules', rules }));
	return rules;
}

export const voiceConfigured = () => !!(process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET);

/** Names (never values) of server settings that are missing, grouped by feature — shown to admins. */
export function missingServerSettings(): Record<'voice' | 'alerts' | 'dailyJob', string[]> {
	const miss = (names: string[]) => names.filter(n => !(process.env[n] || '').trim());
	return {
		voice: miss(['LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET']),
		alerts: miss(['NEXT_PUBLIC_VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY']),
		dailyJob: miss(['CRON_SECRET']),
	};
}
