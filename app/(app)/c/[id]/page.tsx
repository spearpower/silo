'use client';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Avatar from '@/components/Avatar';
import Icon from '@/components/Icon';
import {
	discardMessage, loadOlder, onCallChange, onResync, openConversation, receiptOf, retryMessage, sendMessage, sendTyping,
	typingNames, useStore, type UiMessage,
} from '@/lib/client/store';
import { joinGroupCall, presentIncoming, startCall, useCall } from '@/lib/client/calls';
import { supabase } from '@/lib/supabase/browser';
import { dayLabel, lastSeenText, timeOf } from '@/lib/format';
import { MAX_MESSAGE } from '@/lib/validate';

const GROUP_GAP_MS = 3 * 60_000;

function Tick({ state }: { state: ReturnType<typeof receiptOf> }) {
	if (state === 'pending') return <svg className="tick" viewBox="0 0 16 12" aria-label="Sending"><circle cx="8" cy="6" r="4.5" /><path d="M8 3.5V6l1.6 1" /></svg>;
	if (state === 'failed') return null;
	if (state === 'sent') return <svg className="tick" viewBox="0 0 16 12" aria-label="Sent"><path d="m3 6.5 3 3 6.5-7" /></svg>;
	return <svg className={`tick${state === 'read' ? ' read' : ''}`} viewBox="0 0 16 12" aria-label={state === 'read' ? 'Read' : 'Delivered'}><path d="m1 6.5 3 3 6.5-7M7 9.5l.5.3L14 2.5" /></svg>;
}

export default function ConversationPage() {
	const { id } = useParams<{ id: string }>();
	const search = useSearchParams();
	const s = useStore(st => ({
		meId: st.meId, conv: st.convs?.find(c => c.id === id) ?? null, convsLoaded: !!st.convs,
		thread: st.threads[id], members: st.members[id], people: st.people, online: st.online,
		typing: typingNames(id, st).join(','),
	}));
	const callPhase = useCall(c => (c.conversationId === id ? c.phase : 'idle'));
	const [text, setText] = useState('');
	const [lastSeen, setLastSeen] = useState<string | null>(null);
	const [iBlocked, setIBlocked] = useState(false);
	const [liveCall, setLiveCall] = useState<{ id: string; status: string; kind: string } | null>(null);
	const scroller = useRef<HTMLDivElement>(null);
	const box = useRef<HTMLTextAreaElement>(null);
	const nearBottom = useRef(true);
	const prevHeight = useRef(0);
	const loadingOlder = useRef(false);

	useEffect(() => openConversation(id), [id]);

	// Arrived from a call notification: show the ringing sheet (or join banner) for that call.
	useEffect(() => {
		const callId = search.get('call');
		if (callId && s.meId) void presentIncoming(callId);
	}, [search, s.meId]);

	const conv = s.conv;
	const other = conv?.kind === 'direct' ? conv.other_id : null;

	// Last seen + whether I blocked them (direct chats)
	useEffect(() => {
		if (!other || !s.meId) return;
		const db = supabase();
		void db.from('user_presence').select('last_seen_at').eq('user_id', other).maybeSingle().then(({ data }) => setLastSeen(data?.last_seen_at ?? null));
		void db.from('user_blocks').select('blocked_id').eq('blocker_id', s.meId).eq('blocked_id', other).maybeSingle().then(({ data }) => setIBlocked(!!data));
	}, [other, s.meId, s.online]);

	// Running call in this chat (for the "Join" banner in groups)
	const loadLiveCall = useCallback(async () => {
		const { data } = await supabase().from('call_sessions').select('id, status, kind').eq('conversation_id', id).in('status', ['ringing', 'active']).maybeSingle();
		setLiveCall(data ?? null);
	}, [id]);
	useEffect(() => {
		void loadLiveCall();
		const off1 = onCallChange(p => { if ((p.new as { conversation_id?: string })?.conversation_id === id || p.eventType !== 'INSERT') void loadLiveCall(); });
		const off2 = onResync(() => void loadLiveCall());
		return () => { off1(); off2(); };
	}, [id, loadLiveCall]);

	// Keep the view pinned to the newest message unless the reader scrolled up; keep position when older ones load.
	const items = s.thread?.items;
	useLayoutEffect(() => {
		const el = scroller.current;
		if (!el) return;
		if (loadingOlder.current) {
			el.scrollTop = el.scrollHeight - prevHeight.current;
			loadingOlder.current = false;
		} else if (nearBottom.current) {
			el.scrollTop = el.scrollHeight;
		}
	}, [items, s.typing]);

	const onScroll = () => {
		const el = scroller.current;
		if (!el) return;
		nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
		if (el.scrollTop < 60 && s.thread?.hasMore && !s.thread.loading) {
			prevHeight.current = el.scrollHeight;
			loadingOlder.current = true;
			void loadOlder(id);
		}
	};

	const send = () => {
		const t = text.trim();
		if (!t || t.length > MAX_MESSAGE) return;
		nearBottom.current = true;
		void sendMessage(id, t);
		setText('');
		requestAnimationFrame(() => { if (box.current) { box.current.style.height = ''; box.current.focus(); } });
	};

	const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		const touch = window.matchMedia('(pointer: coarse)').matches;
		if (e.key === 'Enter' && !e.shiftKey && !touch && !e.nativeEvent.isComposing) { e.preventDefault(); send(); }
	};

	const onInput = (v: string) => {
		setText(v);
		if (v.trim()) sendTyping(id);
		const el = box.current;
		if (el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 160) + 'px'; }
	};

	const rendered = useMemo(() => {
		const out: React.ReactNode[] = [];
		const list = items || [];
		let lastDay = '';
		list.forEach((m, i) => {
			const day = new Date(m.created_at).toDateString();
			if (day !== lastDay) { out.push(<div className="day" key={`d-${day}`}>{dayLabel(m.created_at)}</div>); lastDay = day; }
			if (m.kind === 'system') { out.push(<div className="sys" key={m.id}>{m.body}</div>); return; }
			if (m.kind === 'call') {
				const missed = /Missed|Declined|Cancelled/.test(m.body);
				out.push(<div className={`call-log${missed ? ' missed' : ''}`} key={m.id}><Icon name={missed ? 'missed' : 'phone'} className="icon sm" />{m.body}<span className="muted small">{timeOf(m.created_at)}</span></div>);
				return;
			}
			const prev = list[i - 1];
			const first = !prev || prev.kind !== 'text' || prev.sender_id !== m.sender_id || new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() > GROUP_GAP_MS
				|| new Date(prev.created_at).toDateString() !== day;
			const mine = m.sender_id === s.meId;
			const person = m.sender_id ? s.people[m.sender_id] : null;
			const name = person?.display_name || 'Deleted account';
			out.push(
				<div key={m.client_id || m.id} className={`msg${mine ? ' me' : ''}${first ? ' first gap' : ''}${m.failed ? ' failed' : ''}`}>
					{conv?.kind === 'group' && !mine && (first ? <Avatar id={m.sender_id} name={name} url={person?.avatar_url} size={30} /> : <span className="spacer-av" />)}
					<div>
						<div className="bubble">
							{conv?.kind === 'group' && !mine && first && <span className="sender">{name}</span>}
							{m.body}
							<span className="foot">{timeOf(m.created_at)}{mine && <Tick state={receiptOf(m, s.members, s.meId)} />}</span>
						</div>
						{m.failed && (
							<div className="retry" role="alert">
								<span>Not sent{m.failed.length < 80 ? ` · ${m.failed}` : ''}</span>
								<button className="link-btn" type="button" onClick={() => retryMessage(id, m as UiMessage)}>Retry</button>
								<button className="link-btn" type="button" onClick={() => discardMessage(id, m as UiMessage)}>Delete</button>
							</div>
						)}
					</div>
				</div>,
			);
		});
		return out;
	}, [items, s.meId, s.people, s.members, conv?.kind, id]);

	// ----- header text
	const title = conv ? (conv.kind === 'group' ? conv.title || 'Group' : conv.other_display_name || 'Deleted account') : '';
	const typing = s.typing ? s.typing.split(',') : [];
	let status = '';
	let live = false;
	if (typing.length) { status = conv?.kind === 'group' ? `${typing.join(', ')} typing…` : 'typing…'; live = true; }
	else if (conv?.kind === 'group') status = `${conv.member_count} member${conv.member_count === 1 ? '' : 's'}`;
	else if (other && s.online[other]) { status = 'online'; live = true; }
	else status = lastSeenText(lastSeen);

	const back = conv?.kind === 'group' ? '/groups' : '/';
	const inThisCall = callPhase !== 'idle' && callPhase !== 'ended';
	const showJoin = liveCall && liveCall.kind === 'group' && liveCall.status === 'active' && !inThisCall;

	if (s.convsLoaded && !conv) {
		return (
			<div className="empty">
				<div className="art"><Icon name="lock" /></div>
				<h2>Chat not available</h2>
				<p>This conversation doesn’t exist, or you’re no longer a member.</p>
				<Link className="btn btn-primary" href="/">Back to chats</Link>
			</div>
		);
	}

	return (
		<div className="chat">
			<header className="chat-head">
				<Link className="icon-btn" href={back} aria-label="Back"><Icon name="back" /></Link>
				<Link className="who" href={`/c/${id}/info`} aria-label={`Details for ${title}`}>
					<Avatar id={conv?.kind === 'group' ? id : other} name={title} url={conv?.kind === 'group' ? conv?.photo_url : conv?.other_avatar_url} size={40}
						online={!!other && !!s.online[other]} group={conv?.kind === 'group'} />
					<span className="grow">
						<span className="title ellipsis" style={{ display: 'block' }}>{title || ' '}</span>
						<span className={`status ellipsis${live ? ' live' : ''}`} style={{ display: 'block' }} aria-live="polite">{status || ' '}</span>
					</span>
				</Link>
				<button className="icon-btn call-btn" type="button" aria-label={conv?.kind === 'group' ? 'Start a group voice call' : 'Voice call'} title="Voice call"
					disabled={!conv || iBlocked || inThisCall} onClick={() => void (showJoin && liveCall ? joinGroupCall(liveCall.id, id) : startCall(id))}>
					<Icon name="phone" />
				</button>
				<Link className="icon-btn" href={`/c/${id}/info`} aria-label="Chat details"><Icon name="info" /></Link>
			</header>

			{showJoin && liveCall && (
				<div className="call-banner" role="status">
					<span className="live-dot" style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--scarlet)' }} />
					<span className="grow">Voice call in progress</span>
					<button className="btn btn-sm btn-accent" type="button" onClick={() => void joinGroupCall(liveCall.id, id)}>Join</button>
				</div>
			)}

			<div className="messages" ref={scroller} onScroll={onScroll} role="log" aria-label={`Messages with ${title}`} aria-busy={!s.thread?.loaded}>
				{s.thread?.loaded && s.thread.hasMore && (
					<button className="btn btn-sm btn-outline load-older" type="button" disabled={s.thread.loading}
						onClick={() => { const el = scroller.current; prevHeight.current = el?.scrollHeight || 0; loadingOlder.current = true; void loadOlder(id); }}>
						{s.thread.loading ? 'Loading…' : 'Load earlier messages'}
					</button>
				)}
				{!s.thread?.loaded && !s.thread?.error && <div className="empty"><div className="spinner" aria-label="Loading messages" /></div>}
				{s.thread?.error && <div className="banner error" role="alert">{s.thread.error}</div>}
				{s.thread?.loaded && items?.length === 0 && (
					<div className="empty">
						<div className="art"><Icon name="lock" /></div>
						<h2>{conv?.kind === 'group' ? 'Say hi to the group' : `Say hi to ${title}`}</h2>
						<p>Messages here are visible only to the people in this {conv?.kind === 'group' ? 'group' : 'chat'}.</p>
					</div>
				)}
				{rendered}
			</div>

			<div className="typing" aria-hidden={!typing.length}>
				{typing.length > 0 && <><span className="dots"><span /><span /><span /></span> {conv?.kind === 'group' ? `${typing.join(', ')} typing` : 'typing'}</>}
			</div>

			{iBlocked ? (
				<div className="blocked-note">You blocked {title}. <Link href={`/c/${id}/info`}>Unblock</Link> to send messages.</div>
			) : (
				<form className="composer" onSubmit={e => { e.preventDefault(); send(); }}>
					<label htmlFor="composer" className="sr-only">Message</label>
					<textarea id="composer" ref={box} rows={1} value={text} maxLength={MAX_MESSAGE} placeholder="Message"
						onChange={e => onInput(e.target.value)} onKeyDown={onKey} enterKeyHint="send" autoComplete="off" />
					<button className="send-btn" type="submit" disabled={!text.trim()} aria-label="Send"><Icon name="send" /></button>
				</form>
			)}
		</div>
	);
}
