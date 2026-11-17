// Line icons (24px grid, stroke = currentColor). Decorative unless a label is given.
const paths = {
	chats: <><path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4A8 8 0 1 1 20 12Z" /></>,
	groups: <><circle cx="9" cy="8" r="3.4" /><path d="M2.8 19.5a6.3 6.3 0 0 1 12.4 0" /><circle cx="17" cy="9" r="2.6" /><path d="M16.4 14.1a5 5 0 0 1 5 5.4" /></>,
	contacts: <><rect x="4" y="3" width="16" height="18" rx="3" /><circle cx="12" cy="10" r="3" /><path d="M7.5 17.5a4.8 4.8 0 0 1 9 0" /></>,
	settings: <><circle cx="12" cy="12" r="3.2" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></>,
	shield: <><path d="M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6l-7-3Z" /><path d="m9 12 2 2 4-4" /></>,
	phone: <><path d="M21 16.5v3a2 2 0 0 1-2.2 2A19.8 19.8 0 0 1 2.5 5.2 2 2 0 0 1 4.5 3h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.4 10.9a16 16 0 0 0 4.7 4.7l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z" /></>,
	phoneDown: <><path d="M3.3 13.3c4.8-4.4 12.6-4.4 17.4 0 .6.6.7 1.5.2 2.2l-1.4 1.8a1.6 1.6 0 0 1-2 .4l-2.3-1.2a1.6 1.6 0 0 1-.8-1.6l.2-1.4a10 10 0 0 0-5.2 0l.2 1.4a1.6 1.6 0 0 1-.8 1.6l-2.3 1.2a1.6 1.6 0 0 1-2-.4l-1.4-1.8a1.6 1.6 0 0 1 .2-2.2Z" /></>,
	mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></>,
	micOff: <><path d="M15 10V6a3 3 0 0 0-5.7-1.3M9 9v2a3 3 0 0 0 5.1 2.1M5 11a7 7 0 0 0 11.5 5.4M19 11a7 7 0 0 1-.6 2.8M12 18v3M3 3l18 18" /></>,
	speaker: <><path d="M11 5 6 9H3v6h3l5 4V5Z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" /></>,
	send: <><path d="M4 12 20 4l-5 16-3.5-6.5L4 12Z" /><path d="m11.5 13.5 3-3" /></>,
	back: <><path d="m15 5-7 7 7 7" /></>,
	plus: <><path d="M12 5v14M5 12h14" /></>,
	search: <><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></>,
	info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
	close: <><path d="M6 6l12 12M18 6 6 18" /></>,
	check: <><path d="m5 12 4.5 4.5L19 7" /></>,
	userPlus: <><circle cx="9" cy="8" r="3.6" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M19 8v6M16 11h6" /></>,
	block: <><circle cx="12" cy="12" r="9" /><path d="m5.7 5.7 12.6 12.6" /></>,
	flag: <><path d="M5 21V4M5 4h11l-2 4 2 4H5" /></>,
	logout: <><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H4" /></>,
	bell: <><path d="M6 9a6 6 0 1 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9ZM10 20a2 2 0 0 0 4 0" /></>,
	bellOff: <><path d="M8.6 3.9A6 6 0 0 1 18 9c0 2.5.4 4.2 1 5.4M6.3 6.3C6.1 7.1 6 8 6 9c0 6-2.5 7.5-2.5 7.5H16.5M10 20a2 2 0 0 0 4 0M3 3l18 18" /></>,
	camera: <><path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" /><circle cx="12" cy="13" r="3.5" /></>,
	minimize: <><path d="m6 9 6 6 6-6" /></>,
	lock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
	edit: <><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z" /></>,
	leave: <><path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M14 16l4-4-4-4M18 12H9" /></>,
	crown: <><path d="m3 8 4 4 5-7 5 7 4-4-2 11H5L3 8Z" /></>,
	missed: <><path d="m3 7 6 6 4-4 6 6M19 9v6h-6" /></>,
} as const;

export type IconName = keyof typeof paths;

export default function Icon({ name, label, className = 'icon' }: { name: IconName; label?: string; className?: string }) {
	return (
		<svg className={className} viewBox="0 0 24 24" aria-hidden={label ? undefined : true} role={label ? 'img' : undefined} aria-label={label}>
			{paths[name]}
		</svg>
	);
}
