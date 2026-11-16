'use client';
// In-app turn notifications while you're elsewhere in the app (Play, Scores, Friends…):
// a banner "It's your turn in game N" with the turn chime, and the app-icon badge (installed PWA)
// showing how many games are waiting for you. The game table itself handles its own turn alerts.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/client';
import { initSound, playSound } from '@/lib/sound';

interface Mine { id: number; my_turn: boolean; host: string; variant: string }
const QUIET = ['/signin', '/signup', '/privacy', '/offline', '/new-password'];

function setBadge(n: number) {
	const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
	try { if (n > 0) void nav.setAppBadge?.(n).catch(() => {}); else void nav.clearAppBadge?.().catch(() => {}); } catch { /* not supported */ }
}

export default function TurnWatcher() {
	const path = usePathname() || '/';
	const [waiting, setWaiting] = useState<Mine | null>(null);
	const known = useRef<Set<number>>(new Set());
	const first = useRef(true);
	const onTable = path.startsWith('/game/');
	const quiet = QUIET.includes(path);

	useEffect(() => {
		if (quiet) return;
		initSound();
		let stop = false;
		const check = async () => {
			if (stop || document.visibilityState !== 'visible') return;
			try {
				const { games } = await api<{ games: Mine[] }>('/api/games/mine');
				const mine = games.filter(g => g.my_turn);
				setBadge(mine.length);
				const fresh = mine.filter(g => !known.current.has(g.id) && !path.startsWith(`/game/${g.id}`));
				known.current = new Set(mine.map(g => g.id));
				if (!onTable && mine.length) setWaiting(w => (w && mine.some(g => g.id === w.id) ? w : mine[0]));
				if (!mine.length) setWaiting(null);
				if (fresh.length && !first.current && !onTable) { playSound('turn'); try { navigator.vibrate?.([90, 60, 90]); } catch { /* iPhone */ } }
				first.current = false;
			} catch { /* signed out or offline: try again later */ }
		};
		void check();
		const t = setInterval(check, onTable ? 20000 : 8000);
		const vis = () => { if (document.visibilityState === 'visible') void check(); };
		document.addEventListener('visibilitychange', vis);
		return () => { stop = true; clearInterval(t); document.removeEventListener('visibilitychange', vis); };
	}, [path, onTable, quiet]);

	if (quiet || onTable || !waiting) return null;
	return (
		<Link href={`/game/${waiting.id}`} className="turn-banner" role="status" aria-live="polite">
			<span className="tb-ico" aria-hidden="true">🃏</span>
			<span className="tb-txt"><b>It’s your turn</b> · game {waiting.id} ({waiting.variant === 'super' ? 'Super' : 'Classic'})</span>
			<span className="tb-go">Play ›</span>
		</Link>
	);
}
