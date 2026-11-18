'use client';
import { useRef, type ReactNode } from 'react';
import Icon from './Icon';
import { haptic } from '@/lib/client/sound';

const TRIGGER = 56; // px of right-swipe that starts a reply
const MAX = 84;

/**
 * Swipe a message to the right to reply (touch / pen). Vertical scrolling stays native (touch-action: pan-y);
 * only a clearly horizontal drag is taken over. Mouse and keyboard users get the reply button instead.
 */
export default function SwipeToReply({ children, onReply, disabled, className }: {
	children: ReactNode; onReply: () => void; disabled?: boolean; className?: string;
}) {
	const row = useRef<HTMLDivElement>(null);
	const hint = useRef<HTMLSpanElement>(null);
	const g = useRef<{ x: number; y: number; dx: number; mode: 'idle' | 'maybe' | 'swipe' | 'scroll'; buzzed: boolean; id: number }>({ x: 0, y: 0, dx: 0, mode: 'idle', buzzed: false, id: -1 });

	const paint = (dx: number, animate: boolean) => {
		const el = row.current, h = hint.current;
		if (!el || !h) return;
		el.style.transition = animate ? 'transform .2s ease' : 'none';
		el.style.transform = dx ? `translateX(${dx}px)` : '';
		h.style.opacity = String(Math.min(1, dx / TRIGGER));
		h.style.transform = `translateY(-50%) scale(${dx >= TRIGGER ? 1.15 : 0.8 + 0.2 * Math.min(1, dx / TRIGGER)})`;
	};

	const end = () => {
		const s = g.current;
		if (s.mode === 'swipe' && s.dx >= TRIGGER) onReply();
		s.mode = 'idle'; s.dx = 0; s.buzzed = false; s.id = -1;
		paint(0, true);
	};

	if (disabled) return <div className={className}>{children}</div>;

	return (
		<div className="swipe-wrap">
			<span className="swipe-hint" ref={hint} aria-hidden="true"><Icon name="reply" className="icon sm" /></span>
			<div
				ref={row}
				className={className}
				style={{ touchAction: 'pan-y' }}
				onPointerDown={e => {
					if (e.pointerType === 'mouse') return;
					g.current = { x: e.clientX, y: e.clientY, dx: 0, mode: 'maybe', buzzed: false, id: e.pointerId };
				}}
				onPointerMove={e => {
					const s = g.current;
					if (s.id !== e.pointerId || s.mode === 'idle' || s.mode === 'scroll') return;
					const dx = e.clientX - s.x, dy = e.clientY - s.y;
					if (s.mode === 'maybe') {
						if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { s.mode = 'scroll'; return; }
						if (dx > 12 && dx > Math.abs(dy) * 1.5) { s.mode = 'swipe'; row.current?.setPointerCapture(e.pointerId); } else return;
					}
					s.dx = Math.max(0, Math.min(MAX, dx));
					if (s.dx >= TRIGGER && !s.buzzed) { s.buzzed = true; haptic(12); }
					if (s.dx < TRIGGER) s.buzzed = false;
					paint(s.dx, false);
				}}
				onPointerUp={end}
				onPointerCancel={end}
			>
				{children}
			</div>
		</div>
	);
}
