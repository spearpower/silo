import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../database.types';
import { SUPABASE_URL } from '../env';

// Privileged client (bypasses RLS). Server only, and only for work that is not done "as" a person:
// push fan-out, the call sweeper, account deletion. Never import this from a client component.
const SECRET = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export const adminConfigured = () => !!(SUPABASE_URL && SECRET);

let client: SupabaseClient<Database> | null = null;
export function adminSupabase(): SupabaseClient<Database> {
	if (!adminConfigured()) throw new Error('SUPABASE_SECRET_KEY is not set');
	if (!client) {
		client = createClient<Database>(SUPABASE_URL, SECRET, {
			auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
		});
	}
	return client;
}
