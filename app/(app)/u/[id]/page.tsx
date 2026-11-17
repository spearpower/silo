'use client';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import Avatar from '@/components/Avatar';
import Icon from '@/components/Icon';
import Sheet from '@/components/Sheet';
import ReportSheet from '@/components/ReportSheet';
import { loadConversations, useStore } from '@/lib/client/store';
import { lazySupabase, supabase } from '@/lib/supabase/browser';
import { dbMessage } from '@/lib/client/api';
import { lastSeenText } from '@/lib/format';
import { isUuid } from '@/lib/validate';

type Rel = 'friend' | 'incoming' | 'outgoing' | 'none' | 'blocked';

/** Someone's profile: add / accept, message, block, report. */
export default function PersonPage() {
	const { id } = useParams<{ id: string }>();
	const router = useRouter();
	const { meId, online } = useStore(s => ({ meId: s.meId, online: s.online }));
	const [p, setP] = useState<{ username: string; display_name: string; avatar_url: string | null; bio: string } | null | undefined>(undefined);
	const [rel, setRel] = useState<Rel>('none');
	const [lastSeen, setLastSeen] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const [sheet, setSheet] = useState<null | 'report' | 'block'>(null);

	const load = useCallback(async () => {
		if (!meId || !isUuid(id)) { setP(null); return; }
		const db = lazySupabase;
		const [pr, f, b, ls] = await Promise.all([
			db.from('profiles').select('username, display_name, avatar_url, bio, status').eq('id', id).maybeSingle(),
			db.from('friendships').select('requester_id, status').or(`requester_id.eq.${id},addressee_id.eq.${id}`).maybeSingle(),
			db.from('user_blocks').select('blocked_id').eq('blocker_id', meId).eq('blocked_id', id).maybeSingle(),
			db.from('user_presence').select('last_seen_at').eq('user_id', id).maybeSingle(),
		]);
		setP(pr.data && pr.data.status === 'active' ? pr.data : null);
		setLastSeen(ls.data?.last_seen_at ?? null);
		setRel(b.data ? 'blocked' : !f.data ? 'none' : f.data.status === 'accepted' ? 'friend' : f.data.requester_id === meId ? 'outgoing' : 'incoming');
	}, [id, meId]);
	useEffect(() => { void load(); }, [load]);

	const db = lazySupabase;
	const act = async (fn: () => PromiseLike<{ error: { code?: string; message?: string } | null }>) => {
		setBusy(true); setError('');
		const { error: e } = await fn();
		setBusy(false);
		if (e) setError(dbMessage(e));
		await load();
	};
	const message = async () => {
		setBusy(true); setError('');
		const { data, error: e } = await db.rpc('start_direct', { p_user: id });
		setBusy(false);
		if (e || !data) { setError(dbMessage(e)); return; }
		await loadConversations();
		router.push(`/c/${data}`);
	};

	if (p === undefined) return <div className="empty"><div className="spinner" aria-label="Loading" /></div>;
	if (p === null || id === meId) {
		return <div className="empty"><h2>{id === meId ? 'That’s you' : 'Person not found'}</h2><Link className="btn btn-primary" href={id === meId ? '/settings' : '/contacts'}>{id === meId ? 'Edit your profile' : 'Back to contacts'}</Link></div>;
	}
	return (
		<div className="page" style={{ paddingTop: 0 }}>
			<div className="page-head" style={{ paddingLeft: 0, paddingRight: 0 }}>
				<Link className="icon-btn" href="/contacts" aria-label="Back"><Icon name="back" /></Link>
			</div>
			<div className="profile-hero">
				<Avatar id={id} name={p.display_name} url={p.avatar_url} size={110} online={!!online[id]} />
				<h2>{p.display_name}</h2>
				<div className="muted">@{p.username}{online[id] ? ' · online' : lastSeen ? ` · ${lastSeenText(lastSeen)}` : ''}</div>
				{p.bio && <p style={{ margin: '4px 0 0', maxWidth: 420 }}>{p.bio}</p>}
			</div>
			{error && <div className="banner error" role="alert" style={{ marginBottom: 12 }}>{error}</div>}
			<div className="actions-row">
				{rel !== 'blocked' && <button className="action-tile" type="button" disabled={busy} onClick={() => void message()}><Icon name="chats" />Message</button>}
				{rel === 'none' && <button className="action-tile" type="button" disabled={busy} onClick={() => void act(() => db.rpc('friend_request', { p_user: id }))}><Icon name="userPlus" />Add friend</button>}
				{rel === 'incoming' && <button className="action-tile" type="button" disabled={busy} onClick={() => void act(() => db.rpc('accept_friend', { p_user: id }))}><Icon name="check" />Accept</button>}
				{rel === 'outgoing' && <button className="action-tile" type="button" disabled={busy} onClick={() => void act(() => db.rpc('remove_friend', { p_user: id }))}><Icon name="close" />Cancel request</button>}
				{rel === 'friend' && <button className="action-tile" type="button" disabled={busy} onClick={() => void act(() => db.rpc('remove_friend', { p_user: id }))}><Icon name="close" />Unfriend</button>}
			</div>
			<section className="card stack" style={{ gap: 4 }}>
				<button className="btn btn-ghost" style={{ justifyContent: 'flex-start', color: 'var(--danger-ink)' }} type="button" disabled={busy}
					onClick={() => (rel === 'blocked' ? void act(() => db.rpc('unblock_user', { p_user: id })) : setSheet('block'))}>
					<Icon name="block" />{rel === 'blocked' ? 'Unblock' : 'Block'} {p.display_name}
				</button>
				<button className="btn btn-ghost" style={{ justifyContent: 'flex-start', color: 'var(--danger-ink)' }} type="button" onClick={() => setSheet('report')}><Icon name="flag" />Report {p.display_name}</button>
			</section>
			{sheet === 'report' && <ReportSheet userId={id} name={p.display_name} onClose={() => setSheet(null)} />}
			{sheet === 'block' && (
				<Sheet title={`Block ${p.display_name}?`} onClose={() => setSheet(null)}>
					<p className="muted">You won’t be able to message or call each other, and you’ll no longer be friends. They won’t find you in search.</p>
					<div className="row">
						<button className="btn btn-outline grow" type="button" onClick={() => setSheet(null)}>Cancel</button>
						<button className="btn btn-danger grow" type="button" disabled={busy} onClick={() => { setSheet(null); void act(() => db.rpc('block_user', { p_user: id })); }}>Block</button>
					</div>
				</Sheet>
			)}
		</div>
	);
}
