// Date/time and text helpers for the UI (pure, unit-tested).

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** Conversation list stamp: 14:05 today, "Yesterday", weekday this week, else 12/03/26 style date. */
export function listStamp(iso: string | null | undefined, now = new Date()): string {
	if (!iso) return '';
	const d = new Date(iso);
	if (sameDay(d, now)) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	const y = new Date(now); y.setDate(now.getDate() - 1);
	if (sameDay(d, y)) return 'Yesterday';
	if (now.getTime() - d.getTime() < 6 * 86400_000) return d.toLocaleDateString([], { weekday: 'short' });
	return d.toLocaleDateString([], { day: '2-digit', month: '2-digit', year: '2-digit' });
}

export const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** Day separator in a chat: Today / Yesterday / Monday 3 March. */
export function dayLabel(iso: string, now = new Date()): string {
	const d = new Date(iso);
	if (sameDay(d, now)) return 'Today';
	const y = new Date(now); y.setDate(now.getDate() - 1);
	if (sameDay(d, y)) return 'Yesterday';
	return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
}

export function lastSeenText(iso: string | null | undefined, now = Date.now()): string {
	if (!iso) return '';
	const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
	if (s < 90) return 'last seen just now';
	if (s < 3600) return `last seen ${Math.round(s / 60)} min ago`;
	if (s < 86400) return `last seen ${Math.round(s / 3600)} h ago`;
	return `last seen ${new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short' })}`;
}

export function duration(seconds: number): string {
	const s = Math.max(0, Math.floor(seconds));
	const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
	return (h ? `${h}:${String(m).padStart(2, '0')}` : String(m)) + ':' + String(r).padStart(2, '0');
}

export function initials(name: string | null | undefined): string {
	const parts = (name || '?').trim().split(/\s+/).filter(Boolean);
	const s = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] || '?').slice(0, 2);
	return s.toUpperCase();
}

/** Stable shade index for avatar backgrounds (brand palette only). */
export function shadeFor(id: string | null | undefined, n = 4): number {
	let h = 0;
	for (const c of id || '') h = (h * 31 + c.charCodeAt(0)) >>> 0;
	return h % n;
}
