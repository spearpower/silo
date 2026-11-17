import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import type { Database } from '../database.types';
import { SUPABASE_PUBLIC_KEY, SUPABASE_URL } from '../env';

/** Refreshes the Supabase session cookies on every page request and reports who is signed in. */
export async function updateSession(req: NextRequest): Promise<{ res: NextResponse; userId: string | null }> {
	let res = NextResponse.next({ request: req });
	const supabase = createServerClient<Database>(SUPABASE_URL, SUPABASE_PUBLIC_KEY, {
		cookies: {
			getAll: () => req.cookies.getAll(),
			setAll: (list, headers) => {
				list.forEach(({ name, value }) => req.cookies.set(name, value));
				res = NextResponse.next({ request: req });
				list.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
				Object.entries(headers || {}).forEach(([k, v]) => res.headers.set(k, v));
			},
		},
	});
	// getClaims verifies the JWT (locally with asymmetric keys) and refreshes an expiring session.
	const { data } = await supabase.auth.getClaims();
	const sub = data?.claims?.sub;
	return { res, userId: typeof sub === 'string' ? sub : null };
}
