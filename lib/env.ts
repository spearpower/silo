// Public configuration (safe in the browser). NEXT_PUBLIC_* values are inlined at build time.
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
// New projects: the publishable key (sb_publishable_...). Older projects: the anon key. Both are public by design;
// what a browser can do with them is limited by Row Level Security.
export const SUPABASE_PUBLIC_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
export const supabaseConfigured = !!(SUPABASE_URL && SUPABASE_PUBLIC_KEY);

export const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '';
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || '').replace(/\/$/, '');
