'use client';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import Avatar from '@/components/Avatar';
import Icon from '@/components/Icon';
import Sheet from '@/components/Sheet';
import ReportSheet from '@/components/ReportSheet';
import { forgetConversation, loadConversations, loadMembers, useStore, type Member } from '@/lib/client/store';
import { useFriends } from '@/lib/client/friends';
import { startCall } from '@/lib/client/calls';
import { lazySupabase, supabase } from '@/lib/supabase/browser';
import { dbMessage } from '@/lib/client/api';
import { uploadPicture } from '@/lib/client/images';
import { lastSeenText } from '@/lib/format';

const ROLE: Record<Member['role'], string> = { owner: 'Owner', admin: 'Admin', member: '' };

export default function InfoPage() {
	const { id } = useParams<{ id: string }>();
	const router = useRouter();
	const { conv, members, meId, online, convsLoaded } = useStore(s => ({
		conv: s.convs?.find(c => c.id === id) ?? null, members: s.members[id], meId: s.meId, online: s.online, convsLoaded: !!s.convs,
	}));
	const [error, setError] = useState('');
	const [busy, setBusy] = useState(false);
	const [sheet, setSheet] = useState<null | 'report' | 'add' | 'rename' | 'leave' | 'block'>(null);
	const [iBlocked, setIBlocked] = useState(false);
	const [profile, setProfile] = useState<{ bio: string; lastSeen: string | null } | null>(null);

	useEffect(() => { void loadMembers(id); }, [id]);
	const other = conv?.kind === 'direct' ? conv.other_id : null;
	useEffect(() => {
		if (!other || !meId) return;
		const db = lazySupabase;
		void Promise.all([
			db.from('profiles').select('bio').eq('id', other).maybeSingle(),
			db.from('user_presence').select('last_seen_at').eq('user_id', other).maybeSingle(),
			db.from('user_blocks').select('blocked_id').eq('blocker_id', meId).eq('blocked_id', other).maybeSingle(),
		]).then(([p, pr, b]) => { setProfile({ bio: p.data?.bio || '', lastSeen: pr.data?.last_seen_at ?? null }); setIBlocked(!!b.data); });
	}, [other, meId]);

	const run = useCallback(async (fn: () => PromiseLike<{ error: { code?: string; message?: string } | null }>, after?: () => void) => {
		setBusy(true); setError('');
		const { error: e } = await fn();
		setBusy(false);
		if (e) { setError(dbMessage(e)); return false; }
		after?.();
		return true;
	}, []);

	if (convsLoaded && !conv) {
		return <div className="empty"><h2>Chat not available</h2><p>You’re no longer in this conversation.</p><Link className="btn btn-primary" href="/">Back to chats</Link></div>;
	}
	if (!conv) return <div className="empty"><div className="spinner" aria-label="Loading" /></div>;

	const db = lazySupabase;
	const myRole = conv.my_role;
	const isAdmin = myRole === 'owner' || myRole === 'admin';
	const muted = !!conv.muted_until && new Date(conv.muted_until).getTime() > Date.now();
	const title = conv.kind === 'group' ? conv.title || 'Group' : conv.other_display_name || 'Deleted account';

	const toggleMute = () => run(
		() => db.from('conversation_participants').update({ muted_until: muted ? null : '9999-12-31T00:00:00Z' }).eq('conversation_id', id).eq('user_id', meId!),
		() => void loadConversations(),
	);

	const onPhoto = async (file: File | undefined) => {
		if (!file) return;
		setBusy(true); setError('');
		try {
			const url = await uploadPicture('group-photos', id, file);
			const { error: e } = await db.rpc('update_group', { p_conv: id, p_title: conv.title || 'Group', p_photo_url: url });
			if (e) throw new Error(dbMessage(e));
			await loadConversations();
		} catch (e) { setError((e as Error).message); } finally { setBusy(false); }
	};

	return (
		<div className="page" style={{ paddingTop: 0 }}>
			<div className="page-head" style={{ paddingLeft: 0, paddingRight: 0 }}>
				<Link className="icon-btn" href={`/c/${id}`} aria-label="Back to chat"><Icon name="back" /></Link>
				<h1 style={{ fontSize: 20 }}>{conv.kind === 'group' ? 'Group info' : 'Contact info'}</h1>
			</div>

			<div className="profile-hero">
				<Avatar id={conv.kind === 'group' ? id : other} name={title} url={conv.kind === 'group' ? conv.photo_url : conv.other_avatar_url} size={104}
					online={!!other && !!online[other]} group={conv.kind === 'group'} />
				<h2>{title}</h2>
				{conv.kind === 'direct'
					? <div className="muted">@{conv.other_username} · {other && online[other] ? 'online' : lastSeenText(profile?.lastSeen) || 'Silo member'}</div>
					: <div className="muted">Group · {conv.member_count} member{conv.member_count === 1 ? '' : 's'}</div>}
				{profile?.bio && <p style={{ margin: '4px 0 0', maxWidth: 420 }}>{profile.bio}</p>}
			</div>

			<div className="actions-row">
				<Link className="action-tile" href={`/c/${id}`}><Icon name="chats" />Message</Link>
				<button className="action-tile" type="button" onClick={() => void startCall(id)} disabled={iBlocked}><Icon name="phone" />Call</button>
				<button className="action-tile" type="button" onClick={() => void toggleMute()} disabled={busy} aria-pressed={muted}><Icon name={muted ? 'bell' : 'bellOff'} />{muted ? 'Unmute' : 'Mute'}</button>
				{conv.kind === 'group' && isAdmin && (
					<label className="action-tile" style={{ cursor: 'pointer' }}>
						<Icon name="camera" />Photo
						<input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={e => void onPhoto(e.target.files?.[0])} />
					</label>
				)}
			</div>

			{error && <div className="banner error" role="alert" style={{ marginBottom: 12 }}>{error}</div>}

			{conv.kind === 'group' && (
				<section className="card" aria-label="Members">
					<div className="row" style={{ marginBottom: 4 }}>
						<h2 className="grow" style={{ margin: 0 }}>Members</h2>
						{isAdmin && <button className="btn btn-sm btn-outline" type="button" onClick={() => setSheet('add')}><Icon name="userPlus" className="icon sm" />Add</button>}
					</div>
					{!members && <div className="spinner" aria-label="Loading members" />}
					{members?.map(m => (
						<MemberRow key={m.id} m={m} me={m.id === meId} online={!!online[m.id]} myRole={myRole} busy={busy}
							onRemove={() => run(() => db.rpc('remove_group_member', { p_conv: id, p_user: m.id }), () => { void loadMembers(id); void loadConversations(); })}
							onRole={role => run(() => db.rpc('set_member_role', { p_conv: id, p_user: m.id, p_role: role }), () => void loadMembers(id))} />
					))}
				</section>
			)}

			<section className="card stack" style={{ gap: 4 }}>
				{conv.kind === 'group' && isAdmin && (
					<button className="btn btn-ghost" style={{ justifyContent: 'flex-start' }} type="button" onClick={() => setSheet('rename')}><Icon name="edit" />Rename group</button>
				)}
				{conv.kind === 'group' && (
					<button className="btn btn-ghost" style={{ justifyContent: 'flex-start', color: 'var(--danger-ink)' }} type="button" onClick={() => setSheet('leave')}><Icon name="leave" />Leave group</button>
				)}
				{conv.kind === 'direct' && other && (
					<>
						<button className="btn btn-ghost" style={{ justifyContent: 'flex-start', color: 'var(--danger-ink)' }} type="button" disabled={busy}
							onClick={() => (iBlocked ? void run(() => db.rpc('unblock_user', { p_user: other }), () => setIBlocked(false)) : setSheet('block'))}>
							<Icon name="block" />{iBlocked ? `Unblock ${title}` : `Block ${title}`}
						</button>
						<button className="btn btn-ghost" style={{ justifyContent: 'flex-start', color: 'var(--danger-ink)' }} type="button" onClick={() => setSheet('report')}><Icon name="flag" />Report {title}</button>
					</>
				)}
			</section>
			<p className="muted small" style={{ textAlign: 'center', marginTop: 16, display: 'flex', gap: 6, justifyContent: 'center', alignItems: 'center' }}>
				<Icon name="lock" className="icon sm" /> Only members can read this {conv.kind === 'group' ? 'group' : 'chat'}.
			</p>

			{sheet === 'report' && other && <ReportSheet userId={other} name={title} conversationId={id} onClose={() => setSheet(null)} />}
			{sheet === 'block' && other && (
				<Sheet title={`Block ${title}?`} onClose={() => setSheet(null)}>
					<p className="muted">You won’t be able to message or call each other, and you’ll no longer be friends. You can unblock later.</p>
					<div className="row">
						<button className="btn btn-outline grow" type="button" onClick={() => setSheet(null)}>Cancel</button>
						<button className="btn btn-danger grow" type="button" disabled={busy} onClick={() => void run(() => db.rpc('block_user', { p_user: other }), () => { setIBlocked(true); setSheet(null); })}>Block</button>
					</div>
				</Sheet>
			)}
			{sheet === 'leave' && (
				<Sheet title={`Leave ${title}?`} onClose={() => setSheet(null)}>
					<p className="muted">You’ll stop getting its messages and lose access to its history.{myRole === 'owner' ? ' Ownership passes to another member.' : ''}</p>
					<div className="row">
						<button className="btn btn-outline grow" type="button" onClick={() => setSheet(null)}>Cancel</button>
						<button className="btn btn-danger grow" type="button" disabled={busy} onClick={() => void run(() => db.rpc('leave_group', { p_conv: id }), () => { forgetConversation(id); router.replace('/groups'); })}>Leave</button>
					</div>
				</Sheet>
			)}
			{sheet === 'rename' && <RenameSheet current={conv.title || ''} onClose={() => setSheet(null)}
				onSave={name => run(() => db.rpc('update_group', { p_conv: id, p_title: name, p_photo_url: conv.photo_url }), () => { setSheet(null); void loadConversations(); })} />}
			{sheet === 'add' && <AddMembersSheet conv={id} existing={new Set((members || []).map(m => m.id))} onClose={() => setSheet(null)} />}
		</div>
	);
}

function MemberRow({ m, me, online, myRole, busy, onRemove, onRole }: {
	m: Member; me: boolean; online: boolean; myRole: Member['role']; busy: boolean; onRemove: () => void; onRole: (r: 'admin' | 'member') => void;
}) {
	const canRemove = !me && m.role !== 'owner' && (myRole === 'owner' || (myRole === 'admin' && m.role === 'member'));
	const canRole = !me && myRole === 'owner' && m.role !== 'owner';
	return (
		<div className="member">
			<Avatar id={m.id} name={m.display_name} url={m.avatar_url} size={40} online={online} />
			<div className="grow">
				<div className="ellipsis" style={{ fontWeight: 600 }}>{me ? 'You' : m.display_name}</div>
				<div className="muted small ellipsis">@{m.username}</div>
			</div>
			{ROLE[m.role] && <span className={`chip${m.role === 'owner' ? ' accent' : ''}`}>{m.role === 'owner' && <Icon name="crown" className="icon sm" />}{ROLE[m.role]}</span>}
			{canRole && <button className="btn btn-sm btn-ghost" type="button" disabled={busy} onClick={() => onRole(m.role === 'admin' ? 'member' : 'admin')}>{m.role === 'admin' ? 'Remove admin' : 'Make admin'}</button>}
			{canRemove && <button className="icon-btn" type="button" disabled={busy} onClick={onRemove} aria-label={`Remove ${m.display_name}`} title="Remove"><Icon name="close" className="icon sm" /></button>}
		</div>
	);
}

function RenameSheet({ current, onClose, onSave }: { current: string; onClose: () => void; onSave: (name: string) => void }) {
	const [name, setName] = useState(current);
	return (
		<Sheet title="Rename group" onClose={onClose}>
			<form className="stack" onSubmit={e => { e.preventDefault(); onSave(name.trim()); }}>
				<input className="input" value={name} maxLength={60} onChange={e => setName(e.target.value)} aria-label="Group name" required />
				<div className="row">
					<button className="btn btn-outline grow" type="button" onClick={onClose}>Cancel</button>
					<button className="btn btn-primary grow" type="submit" disabled={!name.trim()}>Save</button>
				</div>
			</form>
		</Sheet>
	);
}

function AddMembersSheet({ conv, existing, onClose }: { conv: string; existing: Set<string>; onClose: () => void }) {
	const friends = useFriends();
	const [picked, setPicked] = useState<Set<string>>(new Set());
	const [error, setError] = useState('');
	const [busy, setBusy] = useState(false);
	const choices = (friends || []).filter(f => !existing.has(f.id));
	const add = async () => {
		setBusy(true); setError('');
		const { error: e } = await supabase().rpc('add_group_members', { p_conv: conv, p_members: Array.from(picked) });
		setBusy(false);
		if (e) { setError(dbMessage(e)); return; }
		void loadMembers(conv); void loadConversations(); onClose();
	};
	return (
		<Sheet title="Add members" onClose={onClose}>
			<p className="muted small">You can add your friends.</p>
			{!friends && <div className="spinner" aria-label="Loading friends" />}
			{friends && !choices.length && <p className="muted">All your friends are already here. Add more friends from Contacts.</p>}
			<div style={{ maxHeight: 340, overflow: 'auto' }}>
				{choices.map(f => (
					<label key={f.id} className="picker-row">
						<input type="checkbox" checked={picked.has(f.id)} onChange={e => setPicked(p => { const n = new Set(p); if (e.target.checked) n.add(f.id); else n.delete(f.id); return n; })} />
						<Avatar id={f.id} name={f.display_name} url={f.avatar_url} size={36} />
						<span className="grow"><b>{f.display_name}</b> <span className="muted small">@{f.username}</span></span>
					</label>
				))}
			</div>
			{error && <div className="banner error" role="alert">{error}</div>}
			<div className="row" style={{ marginTop: 12 }}>
				<button className="btn btn-outline grow" type="button" onClick={onClose}>Cancel</button>
				<button className="btn btn-primary grow" type="button" disabled={!picked.size || busy} onClick={() => void add()}>{busy ? 'Adding…' : `Add${picked.size ? ` ${picked.size}` : ''}`}</button>
			</div>
		</Sheet>
	);
}
