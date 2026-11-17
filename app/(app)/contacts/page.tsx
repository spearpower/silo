'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import Avatar from '@/components/Avatar';
import Icon from '@/components/Icon';
import { loadConversations, useStore } from '@/lib/client/store';
import { lazySupabase, supabase } from '@/lib/supabase/browser';
import { dbMessage } from '@/lib/client/api';
import type { PersonSearchRow } from '@/lib/database.types';

interface P { id: string; username: string; display_name: string; avatar_url: string | null }
interface Lists { friends: P[]; incoming: P[]; outgoing: P[]; blocked: P[] }

export default function ContactsPage() {
	const router = useRouter();
	const { meId, online } = useStore(s => ({ meId: s.meId, online: s.online }));
	const [lists, setLists] = useState<Lists | null>(null);
	const [loadError, setLoadError] = useState('');
	const [q, setQ] = useState('');
	const [results, setResults] = useState<PersonSearchRow[] | null>(null);
	const [searching, setSearching] = useState(false);
	const [busy, setBusy] = useState<string | null>(null);
	const [error, setError] = useState('');

	const load = useCallback(async () => {
		if (!meId) return;
		const db = lazySupabase;
		const [f, b] = await Promise.all([
			db.from('friendships').select('requester_id, addressee_id, status'),
			db.from('user_blocks').select('blocked_id'),
		]);
		if (f.error || b.error) { setLoadError(dbMessage(f.error || b.error, 'Couldn’t load your contacts.')); return; }
		const other = (r: { requester_id: string; addressee_id: string }) => (r.requester_id === meId ? r.addressee_id : r.requester_id);
		const ids = [...(f.data || []).map(other), ...(b.data || []).map(x => x.blocked_id)];
		const { data: people } = ids.length ? await db.from('profiles').select('id, username, display_name, avatar_url').in('id', ids) : { data: [] as P[] };
		const by = new Map((people || []).map(p => [p.id, p]));
		const pick = (list: string[]) => list.map(id => by.get(id)).filter((p): p is P => !!p).sort((a, z) => a.display_name.localeCompare(z.display_name));
		setLists({
			friends: pick((f.data || []).filter(r => r.status === 'accepted').map(other)),
			incoming: pick((f.data || []).filter(r => r.status === 'pending' && r.addressee_id === meId).map(other)),
			outgoing: pick((f.data || []).filter(r => r.status === 'pending' && r.requester_id === meId).map(other)),
			blocked: pick((b.data || []).map(x => x.blocked_id)),
		});
		setLoadError('');
	}, [meId]);
	useEffect(() => { void load(); }, [load]);

	useEffect(() => {
		const term = q.trim();
		if (term.length < 2) { setResults(null); return; }
		setSearching(true);
		const t = setTimeout(async () => {
			const { data } = await supabase().rpc('search_people', { p_query: term });
			setResults(data || []);
			setSearching(false);
		}, 250);
		return () => clearTimeout(t);
	}, [q]);

	const act = async (key: string, fn: () => PromiseLike<{ error: { code?: string; message?: string } | null }>) => {
		setBusy(key); setError('');
		const { error: e } = await fn();
		setBusy(null);
		if (e) setError(dbMessage(e));
		await load();
		if (q.trim().length >= 2) { const { data } = await supabase().rpc('search_people', { p_query: q.trim() }); setResults(data || []); }
	};
	const db = lazySupabase;
	const message = async (id: string) => {
		setBusy(`m-${id}`); setError('');
		const { data, error: e } = await db.rpc('start_direct', { p_user: id });
		setBusy(null);
		if (e || !data) { setError(dbMessage(e)); return; }
		await loadConversations();
		router.push(`/c/${data}`);
	};

	const Row = ({ p, children, sub }: { p: P; children?: React.ReactNode; sub?: string }) => (
		<div className="member" style={{ padding: '10px 4px' }}>
			<Link href={`/u/${p.id}`} className="row grow" style={{ color: 'inherit', textDecoration: 'none' }}>
				<Avatar id={p.id} name={p.display_name} url={p.avatar_url} size={44} online={!!online[p.id]} />
				<span className="grow"><b className="ellipsis" style={{ display: 'block' }}>{p.display_name}</b><span className="muted small">{sub || `@${p.username}`}</span></span>
			</Link>
			<span className="row" style={{ gap: 6 }}>{children}</span>
		</div>
	);

	return (
		<div className="page" style={{ paddingTop: 0 }}>
			<div className="page-head" style={{ paddingLeft: 0, paddingRight: 0 }}><h1>Contacts</h1></div>
			<div className="search" style={{ margin: '0 0 14px' }}>
				<Icon name="search" className="icon sm" />
				<input className="input" type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Find people by username or name" aria-label="Find people" autoCapitalize="none" />
			</div>
			{error && <div className="banner error" role="alert" style={{ marginBottom: 12 }}>{error}</div>}

			{results !== null || searching ? (
				<section className="card" aria-label="Search results">
					{searching && !results && <div className="spinner" aria-label="Searching" />}
					{results && results.length === 0 && <p className="muted" style={{ margin: 0 }}>No one found for “{q.trim()}”. Check the username.</p>}
					{results?.map(r => (
						<Row key={r.id} p={r}>
							{r.relation === 'friend' && <button className="btn btn-sm btn-primary" type="button" onClick={() => void message(r.id)} disabled={!!busy}>Message</button>}
							{r.relation === 'none' && <button className="btn btn-sm btn-accent" type="button" disabled={!!busy} onClick={() => void act(r.id, () => db.rpc('friend_request', { p_user: r.id }))}><Icon name="userPlus" className="icon sm" />Add</button>}
							{r.relation === 'outgoing' && <span className="chip">Requested</span>}
							{r.relation === 'incoming' && <button className="btn btn-sm btn-primary" type="button" disabled={!!busy} onClick={() => void act(r.id, () => db.rpc('accept_friend', { p_user: r.id }))}>Accept</button>}
							{r.relation === 'blocked' && <span className="chip">Blocked</span>}
						</Row>
					))}
				</section>
			) : (
				<>
					{loadError && <div className="banner error" role="alert">{loadError} <button className="link-btn" type="button" onClick={() => void load()}>Try again</button></div>}
					{!lists && !loadError && <div className="empty"><div className="spinner" aria-label="Loading contacts" /></div>}
					{lists && lists.incoming.length > 0 && (
						<section className="card" aria-label="Friend requests">
							<h2>Friend requests <span className="badge">{lists.incoming.length}</span></h2>
							{lists.incoming.map(p => (
								<Row key={p.id} p={p} sub="wants to be friends">
									<button className="btn btn-sm btn-primary" type="button" disabled={!!busy} onClick={() => void act(p.id, () => db.rpc('accept_friend', { p_user: p.id }))}>Accept</button>
									<button className="btn btn-sm btn-ghost" type="button" disabled={!!busy} onClick={() => void act(p.id, () => db.rpc('remove_friend', { p_user: p.id }))}>Decline</button>
								</Row>
							))}
						</section>
					)}
					{lists && (
						<section className="card" aria-label="Friends">
							<h2>Friends{lists.friends.length ? ` · ${lists.friends.length}` : ''}</h2>
							{lists.friends.length === 0 && (
								<p className="muted" style={{ margin: 0 }}>No friends yet. Search for the people you know by their username, and send them a request.</p>
							)}
							{lists.friends.map(p => (
								<Row key={p.id} p={p} sub={online[p.id] ? 'online' : `@${p.username}`}>
									<button className="icon-btn" type="button" aria-label={`Message ${p.display_name}`} title="Message" disabled={!!busy} onClick={() => void message(p.id)}><Icon name="chats" /></button>
								</Row>
							))}
						</section>
					)}
					{lists && lists.outgoing.length > 0 && (
						<section className="card" aria-label="Sent requests">
							<h2>Sent requests</h2>
							{lists.outgoing.map(p => (
								<Row key={p.id} p={p} sub="waiting for a reply">
									<button className="btn btn-sm btn-ghost" type="button" disabled={!!busy} onClick={() => void act(p.id, () => db.rpc('remove_friend', { p_user: p.id }))}>Cancel</button>
								</Row>
							))}
						</section>
					)}
					{lists && lists.blocked.length > 0 && (
						<section className="card" aria-label="Blocked">
							<h2>Blocked</h2>
							{lists.blocked.map(p => (
								<Row key={p.id} p={p}>
									<button className="btn btn-sm btn-ghost" type="button" disabled={!!busy} onClick={() => void act(p.id, () => db.rpc('unblock_user', { p_user: p.id }))}>Unblock</button>
								</Row>
							))}
						</section>
					)}
				</>
			)}
		</div>
	);
}
