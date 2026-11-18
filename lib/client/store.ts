'use client';
// Client-side state for the signed-in app: my profile, chat list, open threads, members, online people, typing.
// One Realtime connection carries everything:
//   - postgres_changes on messages / call_sessions / call_participants (each row filtered by RLS for this person)
//   - private broadcast channel per recent chat ('conv:<id>') for typing + read pings (members only, see RLS);
//     kept open (not re-created on every visit) so typing shows in the chat list too
//   - presence channel 'online'
// After a dropped connection or when the app comes back to the foreground, everything is re-fetched (resync),
// so nothing is lost while Realtime was down.
import { useSelector } from './external';
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { supabase } from '../supabase/browser';
import type { ConversationListRow, MessageRow, ProfileRow, SettingsRow, ParticipantRow, CallRow, CallParticipantRow } from '../database.types';
import { api, dbMessage } from './api';
import { messageBlip } from './sound';
import { registerAppPush } from './native';
export { receiptOf } from '../receipts';

export type Person = Pick<ProfileRow, 'id' | 'username' | 'display_name' | 'avatar_url'>;
export type Member = Person & Pick<ParticipantRow, 'role' | 'joined_at' | 'last_delivered_at' | 'receipt_read_at'>;
export type UiMessage = MessageRow & { pending?: boolean; failed?: string };
export interface Thread { items: UiMessage[]; hasMore: boolean; loading: boolean; error: string | null; loaded: boolean }

export interface State {
	ready: boolean;
	meId: string | null;
	me: ProfileRow | null;
	settings: SettingsRow | null;
	convs: ConversationListRow[] | null;
	convError: string | null;
	threads: Record<string, Thread>;
	members: Record<string, Member[]>;
	people: Record<string, Person>;
	online: Record<string, true>;
	typing: Record<string, Record<string, number>>;
	quotes: Record<string, MessageRow | null>; // quoted messages not in the loaded page (null = not visible / deleted)
	connection: 'connecting' | 'live' | 'offline';
	openConv: string | null;
	toast: { id: number; text: string; href?: string } | null;
}

let state: State = {
	ready: false, meId: null, me: null, settings: null, convs: null, convError: null, threads: {}, members: {}, people: {},
	online: {}, typing: {}, quotes: {}, connection: 'connecting', openConv: null, toast: null,
};
const listeners = new Set<() => void>();
function set(patch: Partial<State> | ((s: State) => Partial<State>)) {
	state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
	listeners.forEach(l => l());
}
export const getState = () => state;
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export function useStore<T>(select: (s: State) => T): T {
	return useSelector(subscribe, getState, select);
}

const PAGE = 40;
const sb = () => supabase();

// ---------------------------------------------------------------- boot / resync

let booted = false;
let dbChannel: RealtimeChannel | null = null;
let onlineChannel: RealtimeChannel | null = null;
let wasDown = false;
const callListeners = new Set<(p: RealtimePostgresChangesPayload<CallRow | CallParticipantRow>, table: string) => void>();
export function onCallChange(fn: (p: RealtimePostgresChangesPayload<CallRow | CallParticipantRow>, table: string) => void) {
	callListeners.add(fn);
	return () => { callListeners.delete(fn); };
}
const resyncListeners = new Set<() => void>();
export function onResync(fn: () => void) { resyncListeners.add(fn); return () => { resyncListeners.delete(fn); }; }

export async function boot() {
	if (booted) return;
	booted = true;
	const { data } = await sb().auth.getUser();
	if (!data.user) { location.href = '/signin?next=' + encodeURIComponent(location.pathname); return; }
	set({ meId: data.user.id });
	await sb().realtime.setAuth().catch(() => {}); // private channels need the user's token before the first join
	await Promise.all([loadMe(), loadConversations()]);
	set({ ready: true });
	subscribeDb();
	joinOnline();
	registerAppPush(); // Android app: register this phone for notifications
	heartbeat();
	setInterval(() => { if (document.visibilityState === 'visible') heartbeat(); }, 25_000);
	sb().auth.onAuthStateChange(ev => { if (ev === 'SIGNED_OUT') location.href = '/signin'; });
	let last = Date.now();
	const wake = () => {
		if (document.visibilityState !== 'visible' || Date.now() - last < 4000) return;
		last = Date.now();
		heartbeat();
		resync();
	};
	document.addEventListener('visibilitychange', wake);
	window.addEventListener('online', () => { last = 0; wake(); });
	window.addEventListener('focus', wake);
}

export async function loadMe() {
	const id = state.meId;
	if (!id) return;
	const [p, s] = await Promise.all([
		sb().from('profiles').select('*').eq('id', id).single(),
		sb().from('user_settings').select('*').eq('user_id', id).single(),
	]);
	set({ me: p.data ?? null, settings: s.data ?? null });
	if (p.data) remember([p.data]);
}

let convTimer: ReturnType<typeof setTimeout> | null = null;
export function refreshConversationsSoon() {
	if (convTimer) clearTimeout(convTimer);
	convTimer = setTimeout(() => { convTimer = null; void loadConversations(); }, 250);
}

export async function loadConversations() {
	const { data, error } = await sb().rpc('my_conversations');
	if (error) { set({ convError: dbMessage(error, 'Couldn’t load your chats.') }); return; }
	const rows = (data || []) as ConversationListRow[];
	// the chat on screen is read: don't flash an unread badge for it
	const open = state.openConv;
	set({ convs: rows.map(r => (r.id === open && document.visibilityState === 'visible' ? { ...r, unread: 0 } : r)), convError: null });
	remember(rows.filter(r => r.other_id).map(r => ({ id: r.other_id!, username: r.other_username!, display_name: r.other_display_name!, avatar_url: r.other_avatar_url })));
	syncConvChannels();
}

function subscribeDb() {
	// Private per-user channel (Realtime public access is off); rows are still filtered by RLS.
	dbChannel = sb().channel(`user:${state.meId}`, { config: { private: true } })
		.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, p => onMessage(p.new as MessageRow))
		.on('postgres_changes', { event: '*', schema: 'public', table: 'call_sessions' }, p => callListeners.forEach(f => f(p as never, 'call_sessions')))
		.on('postgres_changes', { event: '*', schema: 'public', table: 'call_participants' }, p => callListeners.forEach(f => f(p as never, 'call_participants')))
		.subscribe(status => {
			if (status === 'SUBSCRIBED') {
				set({ connection: 'live' });
				if (wasDown) { wasDown = false; resync(); }
			} else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
				wasDown = true;
				set({ connection: 'offline' });
			}
		});
}

function joinOnline() {
	onlineChannel = sb().channel('online', { config: { private: true, presence: { key: state.meId! } } });
	onlineChannel
		.on('presence', { event: 'sync' }, () => {
			const ids = Object.keys(onlineChannel!.presenceState());
			set({ online: Object.fromEntries(ids.map(id => [id, true as const])) });
		})
		.subscribe(async status => {
			if (status === 'SUBSCRIBED' && state.settings?.show_online !== false) await onlineChannel!.track({ at: Date.now() });
		});
}

/** Apply a changed "show me online" setting straight away. */
export async function setOnlineVisible(visible: boolean) {
	if (!onlineChannel) return;
	if (visible) await onlineChannel.track({ at: Date.now() }); else await onlineChannel.untrack();
}

function heartbeat() { void sb().rpc('heartbeat'); }

/** Re-fetch everything that may have changed while we weren't listening. */
export function resync() {
	void loadConversations();
	for (const conv of Object.keys(state.threads)) void loadLatest(conv);
	if (state.openConv) void loadMembers(state.openConv);
	resyncListeners.forEach(f => f());
}

// ---------------------------------------------------------------- people

export function remember(list: Person[]) {
	if (!list.length) return;
	set(s => {
		const people = { ...s.people };
		for (const p of list) people[p.id] = { id: p.id, username: p.username, display_name: p.display_name, avatar_url: p.avatar_url };
		return { people };
	});
}

export async function ensurePeople(ids: (string | null)[]) {
	const missing = Array.from(new Set(ids.filter((x): x is string => !!x && !state.people[x])));
	if (!missing.length) return;
	const { data } = await sb().from('profiles').select('id, username, display_name, avatar_url').in('id', missing);
	if (data) remember(data);
}

// ---------------------------------------------------------------- threads

const emptyThread: Thread = { items: [], hasMore: true, loading: false, error: null, loaded: false };

function patchThread(conv: string, fn: (t: Thread) => Partial<Thread>) {
	set(s => {
		const t = s.threads[conv] || emptyThread;
		return { threads: { ...s.threads, [conv]: { ...t, ...fn(t) } } };
	});
}

const byTime = (a: UiMessage, b: UiMessage) => (Date.parse(a.created_at) - Date.parse(b.created_at)) || (a.id < b.id ? -1 : 1);

/** Merge server rows into a thread: no duplicates, pending copies replaced by the real row. */
function merge(items: UiMessage[], incoming: MessageRow[]): UiMessage[] {
	if (!incoming.length) return items;
	const ids = new Set(items.map(m => m.id));
	const byClient = new Map(incoming.filter(m => m.client_id).map(m => [m.client_id!, m]));
	const kept = items.filter(m => !(m.pending || m.failed) || !m.client_id || !byClient.has(m.client_id));
	const add = incoming.filter(m => !ids.has(m.id));
	return [...kept, ...add].sort(byTime);
}

export async function loadLatest(conv: string) {
	patchThread(conv, t => ({ loading: !t.loaded }));
	const { data, error } = await sb().from('messages').select('*').eq('conversation_id', conv)
		.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(PAGE);
	if (error) { patchThread(conv, () => ({ loading: false, error: dbMessage(error, 'Couldn’t load messages.') })); return; }
	const rows = (data || []).reverse();
	patchThread(conv, t => ({
		items: merge(t.loaded ? t.items : t.items.filter(m => m.pending || m.failed), rows),
		hasMore: t.loaded ? t.hasMore : rows.length === PAGE, loading: false, loaded: true, error: null,
	}));
	void ensurePeople(rows.map(r => r.sender_id));
	void ensureQuotes(conv);
}

/** Load messages that replies point at but that aren't in the loaded page (older history). RLS applies. */
export async function ensureQuotes(conv: string) {
	const t = state.threads[conv];
	if (!t) return;
	const have = new Set(t.items.map(m => m.id));
	const missing = Array.from(new Set(t.items.map(m => m.reply_to_id).filter((x): x is string => !!x && !have.has(x) && !(x in state.quotes))));
	if (!missing.length) return;
	const { data } = await sb().from('messages').select('*').in('id', missing);
	set(s => {
		const quotes = { ...s.quotes };
		for (const id of missing) quotes[id] = data?.find(r => r.id === id) ?? null;
		return { quotes };
	});
	void ensurePeople((data || []).map(r => r.sender_id));
}

export async function loadOlder(conv: string) {
	const t = state.threads[conv];
	if (!t || t.loading || !t.hasMore) return;
	const oldest = t.items.find(m => !m.pending && !m.failed);
	if (!oldest) return;
	patchThread(conv, () => ({ loading: true }));
	const { data, error } = await sb().from('messages').select('*').eq('conversation_id', conv)
		.lt('created_at', oldest.created_at)
		.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(PAGE);
	if (error) { patchThread(conv, () => ({ loading: false, error: dbMessage(error, 'Couldn’t load older messages.') })); return; }
	const rows = (data || []).reverse();
	patchThread(conv, x => ({ items: merge(x.items, rows), hasMore: rows.length === PAGE, loading: false }));
	void ensurePeople(rows.map(r => r.sender_id));
	void ensureQuotes(conv);
}

function onMessage(m: MessageRow) {
	if (state.threads[m.conversation_id]?.loaded) {
		patchThread(m.conversation_id, t => ({ items: merge(t.items, [m]) }));
		if (m.reply_to_id) void ensureQuotes(m.conversation_id);
	}
	refreshConversationsSoon();
	void ensurePeople([m.sender_id]);
	if (m.sender_id && m.sender_id !== state.meId) {
		set(s => {
			const t = { ...(s.typing[m.conversation_id] || {}) };
			delete t[m.sender_id!];
			return { typing: { ...s.typing, [m.conversation_id]: t } };
		});
		const looking = state.openConv === m.conversation_id && document.visibilityState === 'visible';
		if (looking) markReadSoon(m.conversation_id);
		else {
			const conv = state.convs?.find(c => c.id === m.conversation_id);
			const muted = conv?.muted_until && new Date(conv.muted_until).getTime() > Date.now();
			if (!muted && m.kind === 'text') {
				messageBlip();
				const who = state.people[m.sender_id]?.display_name || 'New message';
				const where = conv?.kind === 'group' ? ` · ${conv.title}` : '';
				showToast(`${who}${where}`, `/c/${m.conversation_id}`);
			}
		}
	}
	if (m.kind === 'system' && state.members[m.conversation_id]) void loadMembers(m.conversation_id);
}

// ---------------------------------------------------------------- sending

export async function sendMessage(conv: string, text: string, opts: { clientId?: string; replyTo?: string | null } = {}) {
	const clientId = opts.clientId || crypto.randomUUID();
	const replyTo = opts.replyTo || null;
	const temp: UiMessage = {
		id: `tmp-${clientId}`, conversation_id: conv, sender_id: state.meId, kind: 'text', body: text, client_id: clientId,
		meta: null, created_at: new Date().toISOString(), reply_to_id: replyTo, pending: true,
	};
	patchThread(conv, t => ({ items: [...t.items.filter(m => m.client_id !== clientId), temp] }));
	sendTyping(conv, true); // stop the "typing…" on the other side straight away
	try {
		const { message } = await api<{ message: MessageRow }>('/api/messages', { conversationId: conv, body: text, clientId, replyTo });
		patchThread(conv, t => ({ items: merge(t.items, [message]) }));
		refreshConversationsSoon();
	} catch (e) {
		patchThread(conv, t => ({ items: t.items.map(m => (m.client_id === clientId && m.pending ? { ...m, pending: false, failed: (e as Error).message } : m)) }));
	}
}

export function retryMessage(conv: string, m: UiMessage) {
	if (m.client_id) void sendMessage(conv, m.body, { clientId: m.client_id, replyTo: m.reply_to_id });
}
export function discardMessage(conv: string, m: UiMessage) {
	patchThread(conv, t => ({ items: t.items.filter(x => x.id !== m.id) }));
}

// ---------------------------------------------------------------- members, receipts, typing

export async function loadMembers(conv: string) {
	const { data: parts, error } = await sb().from('conversation_participants')
		.select('user_id, role, joined_at, last_delivered_at, receipt_read_at').eq('conversation_id', conv);
	if (error || !parts) return;
	await ensurePeople(parts.map(p => p.user_id));
	const people = state.people;
	const members: Member[] = parts.map(p => ({
		...(people[p.user_id] || { id: p.user_id, username: '', display_name: 'Silo user', avatar_url: null }),
		role: p.role, joined_at: p.joined_at, last_delivered_at: p.last_delivered_at, receipt_read_at: p.receipt_read_at,
	}));
	members.sort((a, b) => (a.role === 'owner' ? -1 : b.role === 'owner' ? 1 : a.role === 'admin' && b.role !== 'admin' ? -1 : b.role === 'admin' && a.role !== 'admin' ? 1 : a.display_name.localeCompare(b.display_name)));
	set(s => ({ members: { ...s.members, [conv]: members } }));
}

const convChannels = new Map<string, RealtimeChannel>();
const MAX_CONV_CHANNELS = 30; // the most recent chats (plus the open one) get live typing / read pings
const lastTyping = new Map<string, number>();

function onTyping(conv: string, payload: unknown) {
	const p = payload as { u?: string; stop?: boolean } | undefined;
	const u = p?.u;
	if (!u || u === state.meId) return;
	set(s => {
		const t = { ...(s.typing[conv] || {}) };
		if (p?.stop) delete t[u]; else t[u] = Date.now() + 6000;
		return { typing: { ...s.typing, [conv]: t } };
	});
	if (!p?.stop) setTimeout(() => set(s => ({ typing: { ...s.typing } })), 6100); // re-render so it expires
}

function ensureConvChannel(conv: string): RealtimeChannel {
	const existing = convChannels.get(conv);
	if (existing) return existing;
	const ch = sb().channel(`conv:${conv}`, { config: { private: true, broadcast: { self: false } } })
		.on('broadcast', { event: 'typing' }, ({ payload }) => onTyping(conv, payload))
		.on('broadcast', { event: 'read' }, () => { if (state.members[conv]) void loadMembers(conv); })
		.subscribe();
	convChannels.set(conv, ch);
	return ch;
}

/** Keep channels open for the recent chats (and the open one); close the rest. */
function syncConvChannels() {
	const wanted = new Set((state.convs || []).slice(0, MAX_CONV_CHANNELS).map(c => c.id));
	if (state.openConv) wanted.add(state.openConv);
	for (const conv of wanted) ensureConvChannel(conv);
	for (const [conv, ch] of convChannels) {
		if (!wanted.has(conv)) { convChannels.delete(conv); void sb().removeChannel(ch); }
	}
}

/** Called by the chat screen: loads it, makes sure its private channel is open, marks it read. Returns a cleanup. */
export function openConversation(conv: string): () => void {
	set({ openConv: conv });
	void loadLatest(conv); // first load, or catch up on anything missed while elsewhere
	void loadMembers(conv);
	ensureConvChannel(conv);
	markReadSoon(conv);
	const onVisible = () => { if (document.visibilityState === 'visible') markReadSoon(conv); };
	document.addEventListener('visibilitychange', onVisible);
	return () => {
		document.removeEventListener('visibilitychange', onVisible);
		sendTyping(conv, true);
		if (state.openConv === conv) set({ openConv: null });
	};
}

/** "I'm typing" (throttled to one ping every 2.5 s), or stop=true when the text is sent or cleared. */
export function sendTyping(conv: string, stop = false) {
	const ch = convChannels.get(conv);
	if (!ch) return;
	const last = lastTyping.get(conv) || 0;
	if (stop) {
		if (!last) return; // nothing to stop
		lastTyping.delete(conv);
	} else {
		if (Date.now() - last < 2500) return;
		lastTyping.set(conv, Date.now());
	}
	void ch.send({ type: 'broadcast', event: 'typing', payload: { u: state.meId, ...(stop ? { stop: true } : {}) } });
}

export function typingNames(conv: string, s: State): string[] {
	const now = Date.now();
	return Object.entries(s.typing[conv] || {}).filter(([, until]) => until > now).map(([id]) => s.people[id]?.display_name || 'Someone');
}

let readTimer: ReturnType<typeof setTimeout> | null = null;
function markReadSoon(conv: string) {
	if (readTimer) clearTimeout(readTimer);
	readTimer = setTimeout(async () => {
		readTimer = null;
		if (document.visibilityState !== 'visible') return;
		await sb().rpc('mark_read', { p_conv: conv });
		set(s => ({ convs: s.convs?.map(c => (c.id === conv ? { ...c, unread: 0 } : c)) ?? null }));
		void convChannels.get(conv)?.send({ type: 'broadcast', event: 'read', payload: {} });
	}, 400);
}

// ---------------------------------------------------------------- toast

let toastTimer: ReturnType<typeof setTimeout> | null = null;
export function showToast(text: string, href?: string) {
	if (toastTimer) clearTimeout(toastTimer);
	set({ toast: { id: Date.now(), text, href } });
	toastTimer = setTimeout(() => set({ toast: null }), 3500);
}
export const hideToast = () => set({ toast: null });

export function forgetConversation(conv: string) {
	set(s => {
		const threads = { ...s.threads }; delete threads[conv];
		const members = { ...s.members }; delete members[conv];
		return { threads, members, convs: s.convs?.filter(c => c.id !== conv) ?? null };
	});
}

export function patchSettings(p: Partial<SettingsRow>) { set(s => ({ settings: s.settings ? { ...s.settings, ...p } : s.settings })); }
export function patchMe(p: Partial<ProfileRow>) {
	set(s => ({ me: s.me ? { ...s.me, ...p } : s.me }));
	if (state.me) remember([state.me]);
}
