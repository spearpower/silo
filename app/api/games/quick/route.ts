import { body, json, withUser } from '@/lib/http';
import { quickGame } from '@/lib/games';
import { asVariant } from '@/lib/rules';

// POST { variant? }: find a seat (or open a table) right now
export const POST = withUser(async (user, req: Request) => {
	const b = await body<{ variant: string }>(req);
	return json(await quickGame(user, asVariant(b.variant)));
});
