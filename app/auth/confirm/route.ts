import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { serverSupabase } from '@/lib/supabase/server';
import { safeNext } from '@/lib/validate';

// Landing point for links in Supabase Auth emails (confirm sign-up, reset password).
// Supports both the token_hash template (recommended) and the PKCE ?code= flow.
export async function GET(req: NextRequest) {
	const url = req.nextUrl;
	const next = safeNext(url.searchParams.get('next'));
	const tokenHash = url.searchParams.get('token_hash');
	const type = url.searchParams.get('type') as EmailOtpType | null;
	const code = url.searchParams.get('code');
	const supabase = await serverSupabase();

	let ok = false;
	if (tokenHash && type) ok = !(await supabase.auth.verifyOtp({ type, token_hash: tokenHash })).error;
	else if (code) ok = !(await supabase.auth.exchangeCodeForSession(code)).error;

	const dest = req.nextUrl.clone();
	dest.search = '';
	if (ok) {
		dest.pathname = type === 'recovery' ? '/reset-password' : next;
	} else {
		dest.pathname = '/signin';
		dest.searchParams.set('error', 'link');
	}
	return NextResponse.redirect(dest);
}
