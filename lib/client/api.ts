'use client';
// fetch() wrapper for Silo's own API routes.

export class ApiError extends Error {
	constructor(message: string, public status: number) { super(message); }
}

export async function api<T = unknown>(path: string, body: unknown = {}): Promise<T> {
	let res: Response;
	try {
		res = await fetch(path, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
			cache: 'no-store',
			credentials: 'same-origin',
		});
	} catch {
		throw new ApiError('You seem to be offline. Check your connection.', 0);
	}
	const data = await res.json().catch(() => ({}));
	if (res.status === 401 && typeof window !== 'undefined') {
		window.location.href = '/signin?next=' + encodeURIComponent(location.pathname);
	}
	if (!res.ok) throw new ApiError((data as { error?: string }).error || 'Something went wrong', res.status);
	return data as T;
}

/** Friendly text for a Supabase (PostgREST) error from a direct browser query or RPC. */
export function dbMessage(e: { code?: string; message?: string } | null | undefined, fallback = 'Something went wrong. Please try again.'): string {
	if (!e) return fallback;
	if (e.code === 'P0001' && e.message) return e.message; // raised by our own SQL, written for people
	if (/fetch|network/i.test(e.message || '')) return 'You seem to be offline. Check your connection.';
	return fallback;
}
