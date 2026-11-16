import { body, json, withUser } from '@/lib/http';
import { asBotLevel, asTimer, startPractice } from '@/lib/games';
import { asVariant } from '@/lib/rules';

export const POST = withUser(async (user, req: Request) => {
	const b = await body<{ friends: number; timer: number; level: string; variant: string }>(req);
	return json({ id: await startPractice(user, Number(b.friends) || 1, asTimer(b.timer ?? 0), asBotLevel(b.level), asVariant(b.variant)) });
});
