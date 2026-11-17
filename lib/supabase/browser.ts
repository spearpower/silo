'use client';
import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../database.types';
import { SUPABASE_PUBLIC_KEY, SUPABASE_URL, supabaseConfigured } from '../env';

export type Supa = SupabaseClient<Database>;
let client: Supa | null = null;

/** One browser client for the whole app (one Realtime connection, one auth listener). */
export function supabase(): Supa {
	if (!supabaseConfigured) throw new Error('Silo is not connected to Supabase yet (see .env.example).');
	if (!client) client = createBrowserClient<Database>(SUPABASE_URL, SUPABASE_PUBLIC_KEY);
	return client;
}

/** Same client, but only created when first used (safe to reference while a page is pre-rendered). */
export const lazySupabase: Supa = new Proxy({} as Supa, {
	get: (_t, prop) => {
		const c = supabase() as unknown as Record<string | symbol, unknown>;
		const v = c[prop];
		return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(c) : v;
	},
});
