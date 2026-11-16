// Phone alerts (Web Push). Free: uses VAPID keys, no third-party service.
// Every send is best effort: alerts never break or slow down a move.
import webpush from 'web-push';
import { sql } from './db';

export interface PushPayload { title: string; body: string; url: string; tag?: string }

let ready: boolean | null = null;
function configure(): boolean {
	if (ready !== null) return ready;
	const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
	ready = !!(pub && priv);
	if (ready) webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@example.com', pub!, priv!);
	return ready;
}
export const pushConfigured = () => configure();

/** Send to every phone these players allowed alerts on. Never throws. */
export async function notifyUsers(userIds: number[], payload: PushPayload): Promise<number> {
	if (!userIds.length || !configure()) return 0;
	let sent = 0;
	try {
		const subs = await sql<{ endpoint: string; p256dh: string; auth: string }[]>`
			select endpoint, p256dh, auth from push_subscriptions where user_id in ${sql(userIds)}`;
		await Promise.all(subs.map(async s => {
			try {
				await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 900, urgency: 'high', topic: payload.tag?.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) });
				sent++;
			} catch (e) {
				const code = (e as { statusCode?: number }).statusCode;
				if (code === 404 || code === 410) await sql`delete from push_subscriptions where endpoint = ${s.endpoint}`.catch(() => {});
				else console.error('[push]', code, (e as Error).message);
			}
		}));
	} catch (e) { console.error('[push]', (e as Error).message); }
	return sent;
}

export async function saveSubscription(userId: number, sub: { endpoint?: string; keys?: { p256dh?: string; auth?: string } }) {
	if (!sub?.endpoint || !/^https:\/\//.test(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) throw new Error('Bad subscription');
	await sql`
		insert into push_subscriptions (endpoint, user_id, p256dh, auth) values (${sub.endpoint.slice(0, 1000)}, ${userId}, ${sub.keys.p256dh.slice(0, 200)}, ${sub.keys.auth.slice(0, 100)})
		on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`;
}

export async function removeSubscription(userId: number, endpoint: string) {
	await sql`delete from push_subscriptions where endpoint = ${endpoint} and user_id = ${userId}`;
}

/** "Your turn" — only if that person isn't looking at the table right now (seen in the last 25 s). */
export async function alertTurn(gameId: number): Promise<void> {
	const [t] = await sql<{ user_id: number; penalty: { kind: string; amount: number } | null; variant: string }[]>`
		select g.turn_user_id as user_id, g.state->'penalty' as penalty, g.variant from games g
		join users u on u.id = g.turn_user_id
		join game_players p on p.game_id = g.id and p.user_id = g.turn_user_id
		where g.id = ${gameId} and g.status = 'playing' and not u.is_bot and p.left_at is null
		  and p.last_seen < now() - interval '25 seconds'`.catch(() => [] as never[]);
	if (!t) return;
	const pen = t.penalty;
	const body = pen
		? `Draw ${pen.amount} is waiting for you in game ${gameId} — answer it with ${pen.kind === '2' ? 'a 2 or an Ace' : pen.kind === '3' ? 'a 3 or the A♠' : 'a Joker or the A♠'}, or draw.`
		: `It’s your turn in game ${gameId}.`;
	await notifyUsers([t.user_id], { title: pen ? `Draw ${pen.amount}! Your turn` : 'Your turn', body, url: `/game/${gameId}`, tag: `turn-${gameId}` });
}

/** "Game over" — to everyone at the table who isn't watching it: who won and how. */
export async function alertFinished(gameId: number): Promise<void> {
	const rows = await sql<{ user_id: number; final_rank: number | null; finished: { how: string; by: number | null; standings: { id: number; rank: number }[] } | null }[]>`
		select p.user_id, p.final_rank, g.state->'finished' as finished from game_players p
		join users u on u.id = p.user_id join games g on g.id = p.game_id
		where p.game_id = ${gameId} and g.status = 'finished' and not u.is_bot and p.left_at is null
		  and p.last_seen < now() - interval '25 seconds'`.catch(() => [] as never[]);
	if (!rows.length || !rows[0].finished) return;
	const f = rows[0].finished;
	const winnerIds = f.standings.filter(s => s.rank === 1).map(s => s.id);
	const names = await sql<{ id: number; username: string }[]>`select id, username from users where id in ${sql(winnerIds)}`.catch(() => [] as never[]);
	const winners = names.map(n => n.username).join(' & ') || 'Someone';
	const how = f.how === 'cut' ? 'after a cut' : f.how === 'out' ? 'by going out' : 'on points';
	await Promise.all(rows.map(r => notifyUsers([r.user_id], {
		title: r.final_rank === 1 ? 'You won! 🏆' : `${winners} won`,
		body: r.final_rank === 1 ? `You won game ${gameId} ${how}.` : `Game ${gameId} is over (${how}). You came ${ordinal(r.final_rank ?? 0)}.`,
		url: `/game/${gameId}`, tag: `turn-${gameId}`,
	})));
}

const ordinal = (n: number) => (n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`);

/** A test alert to the signed-in player's own phones (Account page). Returns how many phones it reached. */
export async function alertTest(userId: number): Promise<number> {
	return notifyUsers([userId], { title: 'PicknPlay alerts work 🎉', body: 'This is how you’ll hear about your turn, invites and results.', url: '/account', tag: 'test' });
}

/** "Game started" — to everyone at the table who isn't watching the waiting room. */
export async function alertStarted(gameId: number, hostId: number, hostName: string): Promise<void> {
	const rows = await sql<{ user_id: number }[]>`
		select p.user_id from game_players p join users u on u.id = p.user_id
		where p.game_id = ${gameId} and not u.is_bot and p.user_id <> ${hostId} and p.last_seen < now() - interval '25 seconds'`.catch(() => [] as never[]);
	if (rows.length) await notifyUsers(rows.map(r => r.user_id), { title: 'Game started', body: `${hostName} started game ${gameId}. Your cards are dealt.`, url: `/game/${gameId}`, tag: `turn-${gameId}` });
}
