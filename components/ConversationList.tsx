'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import Avatar from './Avatar';
import Icon from './Icon';
import { useStore, loadConversations } from '@/lib/client/store';
import { listStamp } from '@/lib/format';
import type { ConversationListRow } from '@/lib/database.types';

function preview(c: ConversationListRow, meId: string | null): string {
	if (!c.last_body) return c.kind === 'group' ? 'Group created' : 'Say hello 👋';
	if (c.last_kind === 'system' || c.last_kind === 'call') return c.last_body;
	const who = c.last_sender_id === meId ? 'You: ' : c.kind === 'group' && c.last_sender_name ? `${c.last_sender_name}: ` : '';
	return who + c.last_body;
}

export default function ConversationList({ kind }: { kind: 'direct' | 'group' }) {
	const path = usePathname();
	const { convs, convError, meId, online } = useStore(s => ({ convs: s.convs, convError: s.convError, meId: s.meId, online: s.online }));
	const [q, setQ] = useState('');
	const rows = useMemo(() => {
		const all = (convs || []).filter(c => c.kind === kind);
		const t = q.trim().toLowerCase();
		if (!t) return all;
		return all.filter(c => (c.kind === 'group' ? c.title : `${c.other_display_name} ${c.other_username}`)?.toLowerCase().includes(t)
			|| c.last_body?.toLowerCase().includes(t));
	}, [convs, kind, q]);

	const title = kind === 'group' ? 'Groups' : 'Chats';
	return (
		<>
			<div className="page-head">
				<h1>{title}</h1>
				<Link className="icon-btn" href={kind === 'group' ? '/groups/new' : '/contacts'} aria-label={kind === 'group' ? 'New group' : 'New chat'} title={kind === 'group' ? 'New group' : 'New chat'}>
					<Icon name={kind === 'group' ? 'plus' : 'edit'} />
				</Link>
			</div>
			<div className="search">
				<Icon name="search" className="icon sm" />
				<input className="input" type="search" placeholder={`Search ${title.toLowerCase()}`} value={q} onChange={e => setQ(e.target.value)} aria-label={`Search ${title.toLowerCase()}`} />
			</div>
			{convError && !convs && (
				<div className="empty"><p>{convError}</p><button className="btn btn-outline" type="button" onClick={() => void loadConversations()}>Try again</button></div>
			)}
			{!convs && !convError && (
				<div aria-busy="true" aria-label={`Loading ${title.toLowerCase()}`}>
					{[0, 1, 2, 3, 4].map(i => (
						<div className="skeleton-row" key={i}>
							<div className="skel" style={{ width: 48, height: 48, borderRadius: '50%' }} />
							<div style={{ flex: 1 }}><div className="skel" style={{ height: 14, width: '45%', marginBottom: 8 }} /><div className="skel" style={{ height: 12, width: '75%' }} /></div>
						</div>
					))}
				</div>
			)}
			{convs && rows.length === 0 && (
				<div className="empty">
					<div className="art"><Icon name={kind === 'group' ? 'groups' : 'chats'} /></div>
					{q ? <><h2>No matches</h2><p>Nothing in your {title.toLowerCase()} matches “{q}”.</p></>
						: kind === 'group'
							? <><h2>No groups yet</h2><p>Start a private group with your friends. Only people you add can see it.</p><Link className="btn btn-primary" href="/groups/new">New group</Link></>
							: <><h2>No chats yet</h2><p>Find your friends and start a private conversation.</p><Link className="btn btn-primary" href="/contacts">Find friends</Link></>}
				</div>
			)}
			{convs && rows.length > 0 && (
				<ul className="list" aria-label={title}>
					{rows.map(c => {
						const name = c.kind === 'group' ? c.title || 'Group' : c.other_display_name || 'Deleted account';
						const unread = c.unread > 0;
						const muted = !!c.muted_until && new Date(c.muted_until).getTime() > Date.now();
						return (
							<li key={c.id}>
								<Link className="list-row" href={`/c/${c.id}`} aria-current={path === `/c/${c.id}` ? 'page' : undefined}>
									<Avatar id={c.kind === 'group' ? c.id : c.other_id} name={name} url={c.kind === 'group' ? c.photo_url : c.other_avatar_url} size={50}
										online={c.kind === 'direct' && !!c.other_id && !!online[c.other_id]} group={c.kind === 'group'} />
									<div className="grow">
										<div className="name ellipsis">{name}</div>
										<div className={`preview ellipsis${unread ? ' unread' : ''}`}>{preview(c, meId)}</div>
									</div>
									<div className="meta">
										<span className={`stamp${unread ? ' unread' : ''}`}>{listStamp(c.last_created_at || c.created_at)}</span>
										<span className="row" style={{ gap: 4 }}>
											{muted && <Icon name="bellOff" className="icon sm" label="Muted" />}
											{unread && <span className={`badge${muted ? ' quiet' : ''}`} aria-label={`${c.unread} unread`}>{c.unread > 99 ? '99+' : c.unread}</span>}
										</span>
									</div>
								</Link>
							</li>
						);
					})}
				</ul>
			)}
		</>
	);
}
