import { after } from 'next/server';
import { body, fail, json, rateLimited, withUser } from '@/lib/http';
import { move } from '@/lib/games';
import { notifyGame } from '@/lib/realtime';
import { alertTurn } from '@/lib/push';
import { Action } from '@/lib/engine';
import { isSuit } from '@/lib/card-codes';

type Ctx = { params: Promise<{ id: string }> };
const CARD = /^(?:(?:A|[2-9]|10|J|Q|K)[SHDC]|X[RB])$/;

/** Only well-formed actions reach the engine (which then checks the move against the rules). */
function parse(a: Record<string, unknown>): Action | null {
	switch (a.type) {
		case 'play': {
			if (typeof a.card !== 'string' || !CARD.test(a.card)) return null;
			if (a.suit !== undefined && a.suit !== null && !isSuit(a.suit)) return null;
			return { type: 'play', card: a.card, ...(isSuit(a.suit) ? { suit: a.suit } : {}), ...(a.cut === true ? { cut: true } : {}) };
		}
		case 'draw': return { type: 'draw' };
		case 'pass': return { type: 'pass' };
		case 'timeout': return { type: 'timeout' };
		default: return null;
	}
}

export const POST = withUser(async (user, req: Request, ctx: Ctx) => {
	if (rateLimited(`move:${user.id}`, 20, 5000)) return fail('Too many moves at once — slow down a little', 429);
	const { id } = await ctx.params;
	const gameId = Number(id);
	if (!Number.isInteger(gameId) || gameId <= 0) return fail('Game not found', 404);
	const action = parse(await body<Record<string, unknown>>(req) as Record<string, unknown>);
	if (!action) return fail('That move isn’t valid');
	const r = await move(user, gameId, action);
	// Tell the other players after we've answered: the mover never waits for the broadcast
	if (r.changed) after(async () => {
		await notifyGame(gameId, r.version);
		// the turn may have passed to someone who isn't looking: buzz their phone
		await alertTurn(gameId);
	});
	return json(r);
});
