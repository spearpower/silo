import { NextResponse, type NextRequest } from 'next/server';
import { supabaseConfigured } from './lib/env';
import { updateSession } from './lib/supabase/middleware';

// Pages anyone may open. Everything else needs a signed-in person (API routes check for themselves).
const PUBLIC = ['/signin', '/signup', '/forgot', '/privacy', '/setup'];
const AUTH_ONLY = ['/signin', '/signup', '/forgot'];

export async function middleware(req: NextRequest) {
	const { pathname } = req.nextUrl;
	const isPublic = PUBLIC.includes(pathname) || pathname.startsWith('/auth/');

	if (!supabaseConfigured) {
		if (pathname === '/setup' || pathname === '/privacy') return NextResponse.next();
		const url = req.nextUrl.clone();
		url.pathname = '/setup';
		url.search = '';
		return NextResponse.redirect(url);
	}

	const { res, userId } = await updateSession(req);
	if (!userId && !isPublic) {
		const url = req.nextUrl.clone();
		url.pathname = '/signin';
		url.search = pathname !== '/' ? `?next=${encodeURIComponent(pathname)}` : '';
		return NextResponse.redirect(url);
	}
	if (userId && AUTH_ONLY.includes(pathname)) {
		const url = req.nextUrl.clone();
		url.pathname = '/';
		url.search = '';
		return NextResponse.redirect(url);
	}
	return res;
}

export const config = {
	matcher: ['/((?!api|_next/static|_next/image|icons|sw.js|manifest.webmanifest|offline.html|favicon.ico|robots.txt).*)'],
};
