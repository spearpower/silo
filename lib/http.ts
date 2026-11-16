import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { COOKIE, readSession, Session } from './session';
import { GameError } from './engine';
import { sql } from './db';

/** 401 that also clears the sign-in cookie (deleted or suspended accounts), so pages don't bounce back and forth. */
function signedOut(message: string): Response {
	const res = fail(message, 401);
	res.cookies.set(COOKIE, '', { path: '/', maxAge: 0 });
	return res;
}

/** Per-instance cache of "account is fine" (active, no forced password change), refreshed every minute. */
const okUntil = new Map<number, number>();
export const forgetAccountCheck = (id: number) => okUntil.delete(id);

/** Suspended or must-change-password accounts are stopped here. Also records "last seen" (for friends). */
async function accountCheck(user: Session, path: string): Promise<Response | null> {
	const passwordRoute = path.startsWith('/api/account/new-password') || path.startsWith('/api/auth/');
	// signed in with a temporary password: the cookie says so, no database needed
	if (user.mustChange && !passwordRoute) return fail('Choose a new password first', 428);
	if ((okUntil.get(user.id) || 0) > Date.now()) return null;
	let failed = false;
	const [row] = await sql<{ status: string; must_change_password: boolean; username: string }[]>`
		update users set last_seen_at = now() where id = ${user.id} returning status, must_change_password, username`.catch(() => { failed = true; return [] as never[]; });
	if (failed) return null; // database hiccup or column missing: don't lock people out
	if (!row) return signedOut('This account no longer exists');
	if (row.username === `Deleted${user.id}`) return signedOut('This account no longer exists');
	if (row.status !== 'active') return signedOut('This account is suspended. Contact the admin.');
	if (row.must_change_password && !passwordRoute) {
		return fail('Choose a new password first', 428);
	}
	if (!row.must_change_password) okUntil.set(user.id, Date.now() + 15000); // suspend / delete reach other phones within 15 s
	return null;
}

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
export const fail = (message: string, status = 400) => json({ error: message }, status);

export async function currentUser(): Promise<Session | null> {
	const jar = await cookies();
	return readSession(jar.get(COOKIE)?.value);
}

/** Wraps a route handler: requires a signed-in user and turns errors into JSON responses. */
export function withUser<T extends unknown[]>(handler: (user: Session, ...args: T) => Promise<Response>) {
	return async (...args: T): Promise<Response> => {
		const user = await currentUser();
		if (!user) return fail('Please sign in again', 401);
		const req = args.find(a => a instanceof Request) as Request | undefined;
		if (req && crossSite(req)) return fail('This request came from another site', 403);
		const blocked = await accountCheck(user, req ? new URL(req.url).pathname : '');
		if (blocked) return blocked;
		try {
			return await handler(user, ...args);
		} catch (e) {
			if (e instanceof GameError) return fail(e.message, e.status);
			console.error(e);
			return fail('Something went wrong. Please try again.', 500);
		}
	};
}

export async function body<T>(req: Request): Promise<Partial<T>> {
	try { return (await req.json()) as Partial<T>; } catch { return {}; }
}

/**
 * CSRF guard for writes: browsers send Origin on POST/PUT/DELETE; it must be this site.
 * (The session cookie is also SameSite=Lax, and every write needs a JSON body.)
 */
export function crossSite(req: Request): boolean {
	if (req.method === 'GET' || req.method === 'HEAD') return false;
	const origin = req.headers.get('origin');
	if (!origin) return false; // same-origin fetches from older browsers / server-to-server calls
	const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
	try { return new URL(origin).host !== host; } catch { return true; }
}

/** Small per-instance sliding-window rate limit. True = over the limit. */
const hits = new Map<string, number[]>();
export function rateLimited(key: string, max: number, windowMs: number): boolean {
	const now = Date.now();
	const list = (hits.get(key) || []).filter(t => now - t < windowMs);
	list.push(now);
	hits.set(key, list);
	if (hits.size > 5000) for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > 60000) hits.delete(k);
	return list.length > max;
}
