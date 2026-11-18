import 'server-only';
// Alerts to browsers (Web Push, VAPID) and to the Silo Android app (Firebase Cloud Messaging).
// Runs with the service role because it reads other people's
// subscriptions; every caller has already been authorised by RLS for the action that triggers the alert.
// Best effort: a failed alert never fails the message or call that caused it.
import webpush from 'web-push';
import { adminConfigured, adminSupabase } from './supabase/admin';
import { incomingCallNotification, messageNotification, missedCallNotification, type PushPayload } from './notify';
import type { MessageRow, MissedRow } from './database.types';
import { fcmConfigured, sendFcm } from './fcm';

let ready: boolean | null = null;
/** Web Push (browsers) is set up. */
export function webPushConfigured(): boolean {
	if (ready !== null) return ready;
	const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
	ready = !!(pub && priv && adminConfigured());
	if (ready) webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@example.com', pub!, priv!);
	return ready;
}
/** Any alert channel (browsers or the Android app) is set up. */
export const pushConfigured = () => webPushConfigured() || (fcmConfigured() && adminConfigured());

/** People seen in the app in the last 30 s get in-app sounds/banners instead of a push. */
const ACTIVE_MS = 30_000;

async function activeUsers(ids: string[]): Promise<Set<string>> {
	if (!ids.length) return new Set();
	const { data } = await adminSupabase().from('user_presence').select('user_id, last_seen_at').in('user_id', ids);
	const now = Date.now();
	return new Set((data || []).filter(r => now - new Date(r.last_seen_at).getTime() < ACTIVE_MS).map(r => r.user_id));
}

export async function sendTo(userIds: string[], payload: PushPayload, opts: { ttl?: number; urgency?: 'normal' | 'high' } = {}): Promise<number> {
	if (!userIds.length || !pushConfigured()) return 0;
	const [web, app] = await Promise.all([sendWeb(userIds, payload, opts), sendApp(userIds, payload, opts.ttl ?? 3600)]);
	return web + app;
}

/** Android app phones (FCM, data-only; the app builds the notification). */
async function sendApp(userIds: string[], payload: PushPayload, ttl: number): Promise<number> {
	if (!fcmConfigured() || !adminConfigured()) return 0;
	const admin = adminSupabase();
	const { data: devices, error } = await admin.from('device_tokens').select('id, token').in('user_id', userIds);
	if (error) { console.error('[push] device tokens', error.message); return 0; }
	const data: Record<string, string> = { kind: payload.kind, title: payload.title, body: payload.body, url: payload.url, tag: payload.tag, ...(payload.callId ? { callId: payload.callId } : {}), ...(payload.media ? { media: payload.media } : {}) };
	let sent = 0;
	await Promise.all((devices || []).map(async d => {
		const r = await sendFcm(d.token, data, ttl);
		if (r === 'sent') sent++;
		else if (r === 'gone') await admin.from('device_tokens').delete().eq('id', d.id); // app uninstalled / token replaced
	}));
	return sent;
}

/** Browsers (Web Push). */
async function sendWeb(userIds: string[], payload: PushPayload, opts: { ttl?: number; urgency?: 'normal' | 'high' }): Promise<number> {
	if (!webPushConfigured()) return 0;
	const admin = adminSupabase();
	const { data: subs, error } = await admin.from('push_subscriptions').select('id, endpoint, p256dh, auth').in('user_id', userIds);
	if (error) { console.error('[push] subscriptions', error.message); return 0; }
	let sent = 0;
	await Promise.all((subs || []).map(async s => {
		try {
			await webpush.sendNotification(
				{ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
				JSON.stringify(payload),
				{ TTL: opts.ttl ?? 3600, urgency: opts.urgency ?? 'normal', topic: payload.tag.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) },
			);
			sent++;
		} catch (e) {
			const code = (e as { statusCode?: number }).statusCode;
			if (code === 404 || code === 410) await admin.from('push_subscriptions').delete().eq('id', s.id); // phone unsubscribed
			else console.error('[push] send', code, (e as Error).message);
		}
	}));
	return sent;
}

/** New message: everyone else in the chat who isn't looking at the app and hasn't muted the chat. */
export async function alertMessage(msg: MessageRow): Promise<void> {
	if (!pushConfigured() || msg.kind !== 'text' || !msg.sender_id) return;
	try {
		const admin = adminSupabase();
		const [{ data: conv }, { data: parts }, { data: sender }] = await Promise.all([
			admin.from('conversations').select('id, kind, title').eq('id', msg.conversation_id).single(),
			admin.from('conversation_participants').select('user_id, muted_until').eq('conversation_id', msg.conversation_id),
			admin.from('profiles').select('display_name').eq('id', msg.sender_id).single(),
		]);
		if (!conv || !parts || !sender) return;
		const now = Date.now();
		const targets = parts.filter(p => p.user_id !== msg.sender_id && (!p.muted_until || new Date(p.muted_until).getTime() < now)).map(p => p.user_id);
		const active = await activeUsers(targets);
		const offline = targets.filter(id => !active.has(id));
		if (!offline.length) return;
		const { data: settings } = await admin.from('user_settings').select('user_id, push_previews').in('user_id', offline);
		const previews = new Set((settings || []).filter(s => s.push_previews).map(s => s.user_id));
		const make = (withText: boolean) => messageNotification({
			conversationId: conv.id, kind: conv.kind, groupTitle: conv.title, senderName: sender.display_name, text: msg.body, previews: withText,
		});
		await Promise.all([
			sendTo(offline.filter(id => previews.has(id)), make(true)),
			sendTo(offline.filter(id => !previews.has(id)), make(false)),
		]);
	} catch (e) { console.error('[push] message', (e as Error).message); }
}

async function callContext(callId: string) {
	const admin = adminSupabase();
	const { data: call } = await admin.from('call_sessions').select('id, conversation_id, kind, started_by, media').eq('id', callId).single();
	if (!call) return null;
	const [{ data: conv }, { data: caller }] = await Promise.all([
		admin.from('conversations').select('title').eq('id', call.conversation_id).single(),
		call.started_by ? admin.from('profiles').select('display_name').eq('id', call.started_by).single() : Promise.resolve({ data: null }),
	]);
	return { call, groupTitle: conv?.title ?? null, callerName: caller?.display_name || 'Someone' };
}

/** Ring: everyone invited to a new call. Short TTL: a ring that arrives a minute late is useless. */
export async function alertIncomingCall(callId: string, callerId: string): Promise<void> {
	if (!pushConfigured()) return;
	try {
		const ctx = await callContext(callId);
		if (!ctx) return;
		const { data: invited } = await adminSupabase().from('call_participants').select('user_id').eq('call_id', callId).eq('state', 'invited');
		const ids = (invited || []).map(r => r.user_id).filter(id => id !== callerId);
		await sendTo(ids, incomingCallNotification({ conversationId: ctx.call.conversation_id, callId, kind: ctx.call.kind, groupTitle: ctx.groupTitle, callerName: ctx.callerName, media: ctx.call.media }), { ttl: 45, urgency: 'high' });
	} catch (e) { console.error('[push] call', (e as Error).message); }
}

export async function alertMissed(rows: MissedRow[]): Promise<void> {
	if (!pushConfigured() || !rows.length) return;
	const byCall = new Map<string, string[]>();
	for (const r of rows) byCall.set(r.call_id, [...(byCall.get(r.call_id) || []), r.user_id]);
	await Promise.all(Array.from(byCall, async ([callId, ids]) => {
		try {
			const ctx = await callContext(callId);
			if (!ctx) return;
			await sendTo(ids, missedCallNotification({ conversationId: ctx.call.conversation_id, callId, kind: ctx.call.kind, groupTitle: ctx.groupTitle, callerName: ctx.callerName, media: ctx.call.media }), { ttl: 86400 });
		} catch (e) { console.error('[push] missed', (e as Error).message); }
	}));
}

/** Server-side call sweeper (no-answer -> missed, silent -> left) followed by missed-call alerts. */
export async function sweepCalls(conversationId?: string): Promise<void> {
	if (!adminConfigured()) return;
	const { data, error } = await adminSupabase().rpc('expire_calls', { p_conv: conversationId ?? null });
	if (error) { console.error('[calls] expire', error.message); return; }
	await alertMissed(data || []);
}
