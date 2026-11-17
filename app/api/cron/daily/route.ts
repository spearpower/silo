import { NextResponse } from 'next/server';
import { sweepCalls } from '@/lib/push';
import { adminConfigured, adminSupabase } from '@/lib/supabase/admin';

// Daily housekeeping (Vercel Cron, see vercel.json): settle calls nobody closed, prune old rate-limit windows.
// Vercel sends "Authorization: Bearer <CRON_SECRET>".
export async function GET(req: Request) {
	const secret = process.env.CRON_SECRET;
	if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return new NextResponse('Unauthorized', { status: 401 });
	if (!adminConfigured()) return NextResponse.json({ ok: false, reason: 'not configured' }, { status: 503 });
	await sweepCalls();
	const cutoff = new Date(Date.now() - 2 * 3600_000).toISOString();
	await adminSupabase().from('rate_limits' as never).delete().lt('window_start', cutoff);
	return NextResponse.json({ ok: true });
}
