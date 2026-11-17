import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database } from '../database.types';
import { SUPABASE_PUBLIC_KEY, SUPABASE_URL } from '../env';

/**
 * Supabase client acting as the signed-in person (their session cookie), for route handlers and server
 * components. Row Level Security applies to everything it does. Create one per request.
 */
export async function serverSupabase() {
	const jar = await cookies();
	return createServerClient<Database>(SUPABASE_URL, SUPABASE_PUBLIC_KEY, {
		cookies: {
			getAll: () => jar.getAll(),
			setAll: list => {
				try {
					list.forEach(({ name, value, options }) => jar.set(name, value, options));
				} catch {
					// Server Components can't set cookies; the middleware refreshes the session instead.
				}
			},
		},
	});
}
