'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import Avatar from '@/components/Avatar';
import Icon from '@/components/Icon';
import { useFriends } from '@/lib/client/friends';
import { loadConversations } from '@/lib/client/store';
import { supabase } from '@/lib/supabase/browser';
import { dbMessage } from '@/lib/client/api';

export default function NewGroupPage() {
	const router = useRouter();
	const friends = useFriends();
	const [title, setTitle] = useState('');
	const [q, setQ] = useState('');
	const [picked, setPicked] = useState<Set<string>>(new Set());
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');

	const shown = useMemo(() => {
		const t = q.trim().toLowerCase();
		return (friends || []).filter(f => !t || f.display_name.toLowerCase().includes(t) || f.username.includes(t));
	}, [friends, q]);

	const create = async () => {
		setBusy(true); setError('');
		const { data, error: e } = await supabase().rpc('create_group', { p_title: title.trim(), p_members: Array.from(picked) });
		if (e || !data) { setBusy(false); setError(dbMessage(e, 'Couldn’t create the group.')); return; }
		await loadConversations();
		router.replace(`/c/${data}`);
	};

	return (
		<div className="page" style={{ paddingTop: 0 }}>
			<div className="page-head" style={{ paddingLeft: 0, paddingRight: 0 }}>
				<Link className="icon-btn" href="/groups" aria-label="Back"><Icon name="back" /></Link>
				<h1 style={{ fontSize: 22 }}>New group</h1>
			</div>
			<form className="stack" onSubmit={e => { e.preventDefault(); void create(); }}>
				<div className="field">
					<label htmlFor="gname">Group name</label>
					<input id="gname" className="input" value={title} maxLength={60} onChange={e => setTitle(e.target.value)} placeholder="Weekend plans" required />
				</div>
				<div className="field">
					<span className="label">Members · {picked.size} selected</span>
					<div className="search" style={{ margin: 0 }}>
						<Icon name="search" className="icon sm" />
						<input className="input" type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search friends" aria-label="Search friends" />
					</div>
				</div>
				<div className="card" style={{ padding: 6 }}>
					{!friends && <div className="empty"><div className="spinner" aria-label="Loading friends" /></div>}
					{friends && friends.length === 0 && (
						<div className="empty"><h2>No friends yet</h2><p>Groups are for people you know. Add friends first, then create a group.</p><Link className="btn btn-primary" href="/contacts">Find friends</Link></div>
					)}
					{shown.map(f => (
						<label key={f.id} className="picker-row">
							<input type="checkbox" checked={picked.has(f.id)} onChange={e => setPicked(p => { const n = new Set(p); if (e.target.checked) n.add(f.id); else n.delete(f.id); return n; })} />
							<Avatar id={f.id} name={f.display_name} url={f.avatar_url} size={40} />
							<span className="grow"><b>{f.display_name}</b><br /><span className="muted small">@{f.username}</span></span>
						</label>
					))}
				</div>
				<p className="muted small" style={{ margin: 0 }}><Icon name="lock" className="icon sm" /> Groups are private. Only members can see the group, its members and its messages.</p>
				{error && <div className="banner error" role="alert">{error}</div>}
				<button className="btn btn-primary btn-block" type="submit" disabled={busy || !title.trim()}>{busy ? 'Creating…' : 'Create group'}</button>
			</form>
		</div>
	);
}
