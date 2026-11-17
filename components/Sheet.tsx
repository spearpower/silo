'use client';
import { useEffect, useRef, type ReactNode } from 'react';

/** Bottom sheet on phones, centred dialog on larger screens. Esc / backdrop closes. */
export default function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const prev = document.activeElement as HTMLElement | null;
		ref.current?.querySelector<HTMLElement>('input, textarea, button')?.focus();
		const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
		document.addEventListener('keydown', onKey);
		return () => { document.removeEventListener('keydown', onKey); prev?.focus?.(); };
	}, [onClose]);
	return (
		<div className="sheet-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
			<div className="sheet" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
				<h2>{title}</h2>
				{children}
			</div>
		</div>
	);
}
