// Friends (requests, accept, remove), presence, and invites to a table.
import { sql } from './db';
import { GameError } from './engine';
import { joinGame } from './games';
import { Session } from './session';
import { notifyUsers } from './push';

export const ONLINE_MINUTES = 2;

export interface Person { id: number; username: string; photo: string; online: boolean; lastSeen: string | null }
export interface FriendsView {
	friends: Person[]; incoming: Person[]; outgoing: Person[];
	invites: { id: number; gameId: number; from: Person; at: string; players: number; status: string }[];
}

type Row = { id: number; username: string; photo: string; last_seen_at: Date | null };
const person = (r: Row): Person => ({
	id: r.id, username: r.username, photo: r.photo, lastSeen: r.last_seen_at ? r.last_seen_at.toISOString() : null,
	online: !!r.last_seen_at && Date.now() - r.last_seen_at.getTime() < ONLINE_MINUTES * 60000,
});

export async function friendsView(user: Session): Promise<FriendsView> {
	const rows = await sql<(Row & { kind: 'friend' | 'incoming' | 'outgoing' })[]>`
		select u.id, u.username, u.photo, u.last_seen_at,
		       case when f.status = 'accepted' then 'friend' when f.addressee_id = ${user.id} then 'incoming' else 'outgoing' end as kind
		from friendships f
		join users u on u.id = case when f.requester_id = ${user.id} then f.addressee_id else f.requester_id end
		where (f.requester_id = ${user.id} or f.addressee_id = ${user.id}) and u.status = 'active'
		order by u.last_seen_at desc nulls last, u.username`;
	const invites = await sql<(Row & { invite_id: number; game_id: number; created_at: Date; players: number; game_status: string })[]>`
		select i.id as invite_id, i.game_id, i.created_at, u.id, u.username, u.photo, u.last_seen_at, g.status as game_status,
		       (select count(*)::int from game_players p where p.game_id = g.id) as players
		from game_invites i join users u on u.id = i.from_id join games g on g.id = i.game_id
		where i.to_id = ${user.id} and i.status = 'sent' and g.status = 'lobby' and i.created_at > now() - interval '3 hours'
		  and not exists (select 1 from game_players p where p.game_id = g.id and p.user_id = ${user.id})
		order by i.created_at desc limit 10`;
	return {
		friends: rows.filter(r => r.kind === 'friend').map(person).sort((a, b) => Number(b.online) - Number(a.online)),
		incoming: rows.filter(r => r.kind === 'incoming').map(person),
		outgoing: rows.filter(r => r.kind === 'outgoing').map(person),
		invites: invites.map(i => ({ id: i.invite_id, gameId: i.game_id, from: person(i), at: i.created_at.toISOString(), players: i.players, status: i.game_status })),
	};
}

export async function searchPlayers(user: Session, q: string) {
	const term = q.trim().slice(0, 20);
	if (term.length < 2) return [];
	const rows = await sql<(Row & { rel: string | null })[]>`
		select u.id, u.username, u.photo, u.last_seen_at,
		       (select case when f.status = 'accepted' then 'friend' when f.requester_id = ${user.id} then 'outgoing' else 'incoming' end
		          from friendships f where (f.requester_id = ${user.id} and f.addressee_id = u.id) or (f.requester_id = u.id and f.addressee_id = ${user.id})) as rel
		from users u
		where not u.is_bot and u.status = 'active' and u.id <> ${user.id} and u.username ilike ${'%' + term + '%'}
		order by (lower(u.username) = lower(${term})) desc, u.username limit 12`;
	return rows.map(r => ({ ...person(r), relation: r.rel }));
}

async function isUser(id: number) {
	const [u] = await sql<{ username: string }[]>`select username from users where id = ${id} and not is_bot and status = 'active'`;
	if (!u) throw new GameError('Player not found', 404);
	return u.username;
}

/** Send a request; if they already asked you, this accepts it. */
export async function requestFriend(user: Session, otherId: number): Promise<'sent' | 'accepted'> {
	if (otherId === user.id) throw new GameError('That’s you');
	await isUser(otherId);
	const [theirs] = await sql`select 1 from friendships where requester_id = ${otherId} and addressee_id = ${user.id} and status = 'pending'`;
	if (theirs) { await respondFriend(user, otherId, true); return 'accepted'; }
	await sql`
		insert into friendships (requester_id, addressee_id) values (${user.id}, ${otherId})
		on conflict do nothing`;
	await notifyUsers([otherId], { title: 'Friend request', body: `${user.username} wants to be friends on PicknPlay`, url: '/friends', tag: `friend-${user.id}` });
	return 'sent';
}

export async function respondFriend(user: Session, requesterId: number, accept: boolean): Promise<void> {
	if (accept) {
		const r = await sql`update friendships set status = 'accepted', accepted_at = now()
			where requester_id = ${requesterId} and addressee_id = ${user.id} and status = 'pending' returning 1`;
		if (!r.length) throw new GameError('That request is no longer there', 404);
		await notifyUsers([requesterId], { title: 'Friend request accepted', body: `${user.username} is now your friend`, url: '/friends', tag: `friend-${user.id}` });
	} else {
		await sql`delete from friendships where requester_id = ${requesterId} and addressee_id = ${user.id} and status = 'pending'`;
	}
}

/** Remove a friend, or cancel a request you sent. */
export async function removeFriend(user: Session, otherId: number): Promise<void> {
	await sql`delete from friendships where (requester_id = ${user.id} and addressee_id = ${otherId}) or (requester_id = ${otherId} and addressee_id = ${user.id})`;
}

/** Invite friends to the waiting room I'm in. */
export async function inviteFriends(user: Session, gameId: number, toIds: number[]): Promise<number> {
	const [g] = await sql<{ status: string; member: boolean }[]>`
		select g.status, exists(select 1 from game_players p where p.game_id = g.id and p.user_id = ${user.id}) as member from games g where g.id = ${gameId}`;
	if (!g) throw new GameError('Game not found', 404);
	if (!g.member) throw new GameError('Only players at this table can invite', 403);
	if (g.status !== 'lobby') throw new GameError('This game has already started', 409);
	const ids = [...new Set(toIds.map(Number).filter(Boolean))].slice(0, 10);
	if (!ids.length) throw new GameError('Choose a friend to invite');
	const ok = await sql<{ id: number }[]>`
		select case when requester_id = ${user.id} then addressee_id else requester_id end as id from friendships
		where status = 'accepted' and (requester_id = ${user.id} or addressee_id = ${user.id})
		  and (case when requester_id = ${user.id} then addressee_id else requester_id end) in ${sql(ids)}`;
	const to = ok.map(r => r.id);
	if (!to.length) throw new GameError('You can only invite your friends', 403);
	for (const id of to) {
		await sql`insert into game_invites (game_id, from_id, to_id) values (${gameId}, ${user.id}, ${id})
			on conflict (game_id, to_id) do update set status = 'sent', from_id = excluded.from_id, created_at = now()`;
	}
	await notifyUsers(to, { title: `${user.username} invited you to play`, body: `Join table ${gameId} on PicknPlay`, url: '/', tag: `invite-${gameId}` });
	return to.length;
}

/** Accept (join the table — no PIN needed, you were invited) or decline an invite. */
export async function respondInvite(user: Session, inviteId: number, accept: boolean): Promise<{ gameId: number }> {
	const [i] = await sql<{ game_id: number; pin: string | null }[]>`
		select i.game_id, g.pin from game_invites i join games g on g.id = i.game_id where i.id = ${inviteId} and i.to_id = ${user.id}`;
	if (!i) throw new GameError('That invite is no longer there', 404);
	if (accept) await joinGame(user, i.game_id, i.pin);
	await sql`update game_invites set status = ${accept ? 'accepted' : 'declined'} where id = ${inviteId}`;
	return { gameId: i.game_id };
}

/** Friends I could invite to this table (not already seated). */
export async function invitable(user: Session, gameId: number): Promise<(Person & { invited: boolean })[]> {
	const rows = await sql<(Row & { invited: boolean })[]>`
		select u.id, u.username, u.photo, u.last_seen_at,
		       exists(select 1 from game_invites i where i.game_id = ${gameId} and i.to_id = u.id and i.status = 'sent') as invited
		from friendships f
		join users u on u.id = case when f.requester_id = ${user.id} then f.addressee_id else f.requester_id end
		where f.status = 'accepted' and (f.requester_id = ${user.id} or f.addressee_id = ${user.id}) and u.status = 'active'
		  and not exists (select 1 from game_players p where p.game_id = ${gameId} and p.user_id = u.id)
		order by u.last_seen_at desc nulls last, u.username`;
	return rows.map(r => ({ ...person(r), invited: r.invited })).sort((a, b) => Number(b.online) - Number(a.online));
}
