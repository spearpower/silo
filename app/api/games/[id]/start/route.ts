import { after } from 'next/server';
import { body, json, withUser } from '@/lib/http';
import { alertStarted } from '@/lib/push';
import { asBotLevel, asTimer, startGame } from '@/lib/games';

type Ctx = { params: Promise<{ id: string }> };

export const POST = withUser(async (user, req: Request, ctx: Ctx) => {
	const { id } = await ctx.params;
	const b = await body<{ timer: number; level: string }>(req);
	await startGame(user, Number(id), asTimer(b.timer), asBotLevel(b.level));
	after(() => alertStarted(Number(id), user.id, user.username));
	return json({ ok: true });
});
