import 'server-only';
import { NextResponse } from 'next/server';
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';
import { serverSupabase } from './supabase/server';
import { supabaseConfigured } from './env';

export class HttpError extends Error {
	constructor(message: string, public status = 400) { super(message); }
}

export const json = (data: unknown, status = 200) =>
	NextResponse.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } });
export const fail = (message: string, status = 400) => json({ error: message }, status);

export type Db = SupabaseClient<Database>;
export interface Ctx { db: Db; userId: string; req: Request }

/**
 * Turn a database error into an HTTP error. Messages we raise ourselves (SQLSTATE P0001) are written for people
 * and are passed through; anything else is logged and replaced by a generic message (no internals leak out).
 */
export function dbError(e: PostgrestError | null, where: string): HttpError | null {
	if (!e) return null;
	if (e.code === 'P0001') return new HttpError(e.message, 400);
	if (e.code === '28000') return new HttpError('Please sign in again', 401);
	if (e.code === '42501') return new HttpError('You’re not allowed to do that', 403);
	console.error(`[db] ${where}`, e.code, e.message);
	return new HttpError('Something went wrong. Please try again.', 500);
}

/** Throws the mapped error, or returns the data. */
export function must<T>(r: { data: T; error: PostgrestError | null }, where: string): T {
	const err = dbError(r.error, where);
	if (err) throw err;
	return r.data;
}

/**
 * CSRF guard for writes. Browsers always send Origin on cross-site POSTs; it must be this site. Writes also
 * need a JSON body (a cross-site HTML form cannot send one without a CORS preflight, which we never allow).
 */
export function crossSite(req: Request): boolean {
	if (req.method === 'GET' || req.method === 'HEAD') return false;
	const origin = req.headers.get('origin');
	if (origin) {
		const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
		try { if (new URL(origin).host !== host) return true; } catch { return true; }
	}
	const type = req.headers.get('content-type') || '';
	return !type.toLowerCase().startsWith('application/json');
}

export async function readJson<T>(req: Request): Promise<Partial<T>> {
	try {
		const text = await req.text();
		if (text.length > 20000) throw new HttpError('Request too large', 413);
		return (text ? JSON.parse(text) : {}) as Partial<T>;
	} catch (e) {
		if (e instanceof HttpError) throw e;
		throw new HttpError('Bad request body', 400);
	}
}

/** Per-person rate limit kept in Postgres (works across serverless instances). */
export async function limit(db: Db, action: string, max: number, windowSeconds: number) {
	const { data, error } = await db.rpc('rate_limit', { p_action: action, p_max: max, p_window_seconds: windowSeconds });
	if (error) { console.error('[rate_limit]', error.message); return; } // fail open on a DB hiccup, RLS still applies
	if (data === false) throw new HttpError('You’re doing that too often. Wait a moment and try again.', 429);
}

/** Wraps a route handler: requires a signed-in person, blocks cross-site writes, maps errors to JSON. */
export function withUser<P>(handler: (ctx: Ctx, params: P) => Promise<Response>) {
	return async (req: Request, route: { params: Promise<P> }): Promise<Response> => {
		if (!supabaseConfigured) return fail('Silo isn’t connected to its database yet', 503);
		if (crossSite(req)) return fail('This request came from another site', 403);
		try {
			const db = await serverSupabase();
			const { data, error } = await db.auth.getUser(); // verified with Supabase Auth (catches revoked sessions)
			if (error || !data.user) return fail('Please sign in again', 401);
			return await handler({ db, userId: data.user.id, req }, await (route?.params ?? Promise.resolve({} as P)));
		} catch (e) {
			if (e instanceof HttpError) return fail(e.message, e.status);
			console.error('[api]', e);
			return fail('Something went wrong. Please try again.', 500);
		}
	};
}
