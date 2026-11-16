import { json, withUser } from '@/lib/http';
import { getRules, getSettings, voiceConfigured } from '@/lib/settings';

export const GET = withUser(async () => {
	const s = await getSettings();
	return json({ ...s, voiceChat: s.voiceChat && voiceConfigured(), rules: await getRules() });
});
