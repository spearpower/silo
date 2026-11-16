'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameView } from './engine';

export class ApiError extends Error {
	constructor(message: string, public status: number) { super(message); }
}

export async function api<T = unknown>(path: string, body?: unknown): Promise<T> {
	const res = await fetch(path, {
		method: body === undefined ? 'GET' : 'POST',
		headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body),
		cache: 'no-store',
	});
	const data = await res.json().catch(() => ({}));
	if (res.status === 428 && typeof window !== 'undefined' && location.pathname !== '/new-password') {
		window.location.href = '/new-password';
	}
	if (res.status === 401 && typeof window !== 'undefined') {
		window.location.href = '/signin?next=' + encodeURIComponent(location.pathname);
	}
	if (!res.ok) throw new ApiError((data as { error?: string }).error || 'Something went wrong', res.status);
	return data as T;
}

export interface LobbyPlayer { id: number; seat: number; username: string; photo: string; online: boolean; isBot?: boolean; left?: boolean }
export interface GameData {
	id: number; me: number; variant: 'classic' | 'super'; status: 'lobby' | 'playing' | 'finished' | 'abandoned' | 'ended'; hostId: number; isMember: boolean;
	pin: string | null; private: boolean; timerSec: number; version: number; deadline: string | null;
	serverNow: string; nextGameId: number | null; players: LobbyPlayer[]; view: GameView | null; watch?: GameView | null; practice?: boolean; chatLast?: number;
	canManage?: boolean; superAdmin?: boolean;
	myLeft?: { by: number | null; byName?: string | null; reason: string | null } | null;
	ended?: { by: number | null; byName?: string | null; reason: string } | null;
}

const RT_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const RT_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
export const realtimeEnabled = !!(RT_URL && RT_KEY);

/** Subscribe to "changed" pings on a Supabase Realtime broadcast topic. Returns an unsubscribe function. */
export function subscribe(topic: string, onPing: () => void): () => void {
	if (!realtimeEnabled) return () => {};
	let stop = false;
	let cleanup = () => {};
	import('@supabase/supabase-js').then(({ createClient }) => {
		if (stop) return;
		const client = createClient(RT_URL!, RT_KEY!, { auth: { persistSession: false } });
		const ch = client.channel(topic).on('broadcast', { event: 'v' }, () => onPing()).subscribe();
		cleanup = () => { client.removeChannel(ch); };
	});
	return () => { stop = true; cleanup(); };
}

/** Live game data: realtime pings when configured, polling always (slower when realtime works). */
export function useGame(id: number) {
	const [data, setData] = useState<GameData | null>(null);
	const [error, setError] = useState<string | null>(null);
	const busy = useRef(false);
	const skew = useRef(0); // server clock minus device clock, for the turn timer

	const refresh = useCallback(async () => {
		if (busy.current) return;
		busy.current = true;
		try {
			const d = await api<GameData>(`/api/games/${id}`);
			skew.current = new Date(d.serverNow).getTime() - Date.now();
			setData(prev => (prev && prev.version > d.version ? prev : d));
			setError(null);
		} catch (e) {
			setError((e as Error).message);
		} finally {
			busy.current = false;
		}
	}, [id]);

	useEffect(() => {
		refresh();
		const every = realtimeEnabled ? 4000 : 1500;
		const t = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, every);
		const unsub = subscribe(`game-${id}`, refresh);
		const onVis = () => { if (document.visibilityState === 'visible') refresh(); };
		document.addEventListener('visibilitychange', onVis);
		window.addEventListener('online', refresh);
		return () => { clearInterval(t); unsub(); document.removeEventListener('visibilitychange', onVis); window.removeEventListener('online', refresh); };
	}, [id, refresh]);

	/** Apply a server response from a move immediately (no wait for the next poll). */
	const accept = useCallback((d: Partial<GameData> & { version: number; serverNow: string }) => {
		skew.current = new Date(d.serverNow).getTime() - Date.now();
		// Move responses are partial (no player list): merge into what we have
		setData(prev => (!prev ? (d as GameData) : prev.version > d.version ? prev : { ...prev, ...d }));
	}, []);

	return { data, error, refresh, accept, serverNow: () => Date.now() + skew.current };
}

export { avatarUrl as avatar } from './avatars';
export { cardImage as cardSrc, CARD_BACK } from './card-codes';
export function haptic(ms: number | number[] = 12) { try { navigator.vibrate?.(ms); } catch { /* not supported (iPhone) */ } }
