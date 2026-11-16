// Signed session cookie (JWT, HS256). Works in middleware (edge) and route handlers.
import { SignJWT, jwtVerify } from 'jose';

export const COOKIE = 'picknplay_session';
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export interface Session { id: number; username: string; photo: string; role: 'player' | 'admin' | 'superadmin'; mustChange?: boolean }

function key() {
	const secret = process.env.SESSION_SECRET;
	if (!secret || secret.length < 32) {
		if (process.env.NODE_ENV === 'production') throw new Error('SESSION_SECRET must be set (32+ characters)');
		return new TextEncoder().encode('dev-only-insecure-secret-change-me-0123456789');
	}
	return new TextEncoder().encode(secret);
}

export async function signSession(s: Session): Promise<string> {
	return new SignJWT({ u: s.username, p: s.photo, r: s.role, ...(s.mustChange ? { mc: 1 } : {}) })
		.setProtectedHeader({ alg: 'HS256' })
		.setSubject(String(s.id))
		.setIssuedAt()
		.setExpirationTime(`${MAX_AGE}s`)
		.sign(key());
}

export async function readSession(token: string | undefined): Promise<Session | null> {
	if (!token) return null;
	try {
		const { payload } = await jwtVerify(token, key(), { algorithms: ['HS256'] });
		return { id: Number(payload.sub), username: String(payload.u), photo: String(payload.p), role: payload.r === 'superadmin' ? 'superadmin' : payload.r === 'admin' ? 'admin' : 'player', mustChange: payload.mc === 1 };
	} catch {
		return null;
	}
}

export const cookieOptions = {
	httpOnly: true,
	sameSite: 'lax' as const,
	secure: process.env.NODE_ENV === 'production',
	path: '/',
	maxAge: MAX_AGE,
};
