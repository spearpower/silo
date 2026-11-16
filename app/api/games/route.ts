import { body, json, withUser } from '@/lib/http';
import { asTimer, createGame, listOpenGames } from '@/lib/games';
import { asVariant } from '@/lib/rules';

export const GET = withUser(async (user, req: Request) => {
	const url = new URL(req.url);
	const games = await listOpenGames(user, url.searchParams.get('public') === '1', url.searchParams.get('q') || '');
	return json({ games });
});

export const POST = withUser(async (user, req: Request) => {
	const b = await body<{ pin: string; timer: number; variant: string }>(req);
	const pin = (b.pin || '').trim() || null;
	const id = await createGame(user, pin, asTimer(b.timer), asVariant(b.variant));
	return json({ id });
});
