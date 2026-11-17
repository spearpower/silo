'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import Icon, { type IconName } from './Icon';
import ConversationList from './ConversationList';
import Runtime from './Runtime';
import { boot, useStore } from '@/lib/client/store';
import { wireCalls } from '@/lib/client/calls';

const NAV: { href: string; label: string; icon: IconName; match: (p: string) => boolean }[] = [
	{ href: '/', label: 'Chats', icon: 'chats', match: p => p === '/' },
	{ href: '/groups', label: 'Groups', icon: 'groups', match: p => p.startsWith('/groups') },
	{ href: '/contacts', label: 'Contacts', icon: 'contacts', match: p => p.startsWith('/contacts') || p.startsWith('/u/') },
	{ href: '/settings', label: 'Settings', icon: 'settings', match: p => p.startsWith('/settings') },
];

/**
 * Phone: one screen at a time with a bottom tab bar (hidden inside a chat).
 * Desktop: navigation rail + chat list + open chat side by side.
 */
export default function AppShell({ children }: { children: ReactNode }) {
	const path = usePathname();
	const { convs, isAdmin } = useStore(s => ({ convs: s.convs, isAdmin: s.me?.role === 'admin' }));

	useEffect(() => { void boot().then(wireCalls); }, []);

	const convId = path.startsWith('/c/') ? path.split('/')[2] : null;
	const openKind = convId ? convs?.find(c => c.id === convId)?.kind ?? 'direct' : null;
	const listKind: 'direct' | 'group' | null = path === '/' ? 'direct' : path === '/groups' ? 'group' : openKind;
	const mode = path === '/' || path === '/groups' ? 'mobile-list' : convId ? 'mobile-main' : 'no-list';

	const unread = (k: 'direct' | 'group') => (convs || []).filter(c => c.kind === k && c.unread > 0 && !(c.muted_until && new Date(c.muted_until).getTime() > Date.now())).length;
	const badges: Record<string, number> = { '/': unread('direct'), '/groups': unread('group') };
	const nav = isAdmin ? [...NAV, { href: '/admin', label: 'Admin', icon: 'shield' as IconName, match: (p: string) => p.startsWith('/admin') }] : NAV;
	const current = (n: typeof NAV[number]) => n.match(path) || (convId && ((n.href === '/' && openKind === 'direct') || (n.href === '/groups' && openKind === 'group')));

	return (
		<div className={`shell ${mode}`}>
			<nav className="rail" aria-label="Main">
				<img className="logo" src="/icons/icon-192.png" alt="Silo" />
				{nav.map(n => (
					<Link key={n.href} href={n.href} aria-current={current(n) ? 'page' : undefined} aria-label={n.label} title={n.label}>
						<Icon name={n.icon} />
						{badges[n.href] > 0 && <span className="badge">{badges[n.href]}</span>}
					</Link>
				))}
			</nav>
			{listKind && <section className="pane-list" aria-label={listKind === 'group' ? 'Groups' : 'Chats'}><ConversationList kind={listKind} /></section>}
			<main className="pane-main" id="main">{children}</main>
			<nav className="tabbar" aria-label="Main">
				{nav.map(n => (
					<Link key={n.href} href={n.href} aria-current={current(n) ? 'page' : undefined}>
						<Icon name={n.icon} />
						<span>{n.label}</span>
						{badges[n.href] > 0 && <span className="badge">{badges[n.href]}</span>}
					</Link>
				))}
			</nav>
			<Runtime />
		</div>
	);
}
