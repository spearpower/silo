import { initials, shadeFor } from '@/lib/format';

/** Picture if there is one, otherwise initials on a brand shade. Optional online dot. */
export default function Avatar({ id, name, url, size = 44, online, group }: {
	id?: string | null; name?: string | null; url?: string | null; size?: number; online?: boolean; group?: boolean;
}) {
	return (
		<span className={`avatar shade-${shadeFor(id)}${group ? ' group' : ''}`} style={{ '--size': `${size}px` } as React.CSSProperties} aria-hidden="true">
			{url ? <img src={url} alt="" loading="lazy" referrerPolicy="no-referrer" /> : initials(name)}
			{online && <span className="dot" />}
		</span>
	);
}
