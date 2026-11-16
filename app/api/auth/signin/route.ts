import { NextResponse } from 'next/server';
import { body, crossSite, fail, rateLimited } from '@/lib/http';
import { signIn } from '@/lib/users';
import { COOKIE, cookieOptions, signSession } from '@/lib/session';
import { GameError } from '@/lib/engine';

export async function POST(req: Request) {
	if (crossSite(req)) return fail('This request came from another site', 403);
	const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'local';
	if (rateLimited(`signin:${ip}`, 10, 60000)) return fail('Too many attempts. Wait a minute and try again.', 429);
	const b = await body<{ username: string; password: string }>(req);
	try {
		const user = await signIn(b.username || '', b.password || '');
		const res = NextResponse.json({ ok: true, user });
		res.cookies.set(COOKIE, await signSession(user), cookieOptions);
		return res;
	} catch (e) {
		if (e instanceof GameError) return fail(e.message, e.status);
		console.error(e);
		return fail('Can’t sign in right now. Please try again.', 500);
	}
}
