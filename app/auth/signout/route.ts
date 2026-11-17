import { NextResponse } from 'next/server';
import { serverSupabase } from '@/lib/supabase/server';
import { crossSite } from '@/lib/api';

// Sign out on the server too, so the session cookies are cleared in the same response.
export async function POST(req: Request) {
	if (crossSite(req)) return NextResponse.json({ error: 'This request came from another site' }, { status: 403 });
	const supabase = await serverSupabase();
	await supabase.auth.signOut();
	return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'private, no-store' } });
}
