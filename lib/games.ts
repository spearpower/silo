// Game service: lobby, start, moves, timers, results. Every write runs in one transaction with the
// game row locked (SELECT ... FOR UPDATE), so simultaneous moves can't interleave. The engine state in
// games.state is the single source of truth; the readable columns (top card, cutter, direction, hands…)
// are mirrored from it in the same transaction for reports, and are never sent to other players.
import type postgres from 'postgres';
import { sql } from './db';
import { Action, apply, autoPlay, AWAY_TURNS, awayPlayer, BotLevel, GameError, GameState, GameView, newGame, removePlayer, TableEvent, viewFor } from './engine';
import { botTurn } from './bot';
import { getRules, getSettings } from './settings';
import { notifyGame, notifyLobbyList } from './realtime';
import { after } from 'next/server';
import { alertFinished, alertTurn } from './push';
import { Session } from './session';
import { isJoker, rankOf, SUIT_DB, suitOf, type Variant } from './card-codes';

type Tx = postgres.TransactionSql<{}>;

const ONLINE_SECONDS = 20;
/** Games with no moves for this long are closed (lobbies: abandoned; games in play: ended, no points). */
export const STALE_HOURS = 24;
export const BOT_LEVELS: BotLevel[] = ['easy', 'normal', 'smart'];
export const asBotLevel = (x: unknown): BotLevel => (BOT_LEVELS.includes(x as BotLevel) ? (x as BotLevel) : 'normal');
export const TIMERS = [0, 15, 20, 30, 40, 60];
export const asTimer = (x: unknown) => (TIMERS.includes(Number(x)) ? Number(x) : 30);
const MAX_VIRTUAL_FRIENDS = 5;
/** A Virtual Friend "thinks" for 1.2–2.2 s so people can follow the play. */
const botSeconds = () => 1.2 + Math.random();
const isBotTurn = (st: GameState | null) => !!st && st.turn !== null && !st.finished && !!st.bots?.includes(st.turn);
/** Play whatever is due: a Virtual Friend's turn, or a person's timed-out turn. */
function runDueTurn(st: GameState) {
	return isBotTurn(st) ? botTurn(st, st.turn!) : autoPlay(st);
}

interface GameRow {
	id: number; host_id: number; variant: Variant; pin: string | null; timer_sec: number; status: string;
	version: number; state: GameState | null; turn_user_id: number | null;
	turn_deadline: Date | null; next_game_id: number | null;
	end_reason?: string | null; ended_by?: number | null;
}

/** Display name for someone who may not be sitting at the table (e.g. a super admin). */
async function nameOfUser(id: number | null | undefined): Promise<string | null> {
	if (!id) return null;
	const [u] = await sql<{ username: string }[]>`select username from users where id = ${id}`;
	return u?.username ?? null;
}

// ---------- Lobby ----------

export async function createGame(user: Session, pin: string | null, timerSec: number, variant: Variant = 'classic'): Promise<number> {
	if (pin !== null && !/^\d{4}$/.test(pin)) throw new GameError('The PIN must be 4 digits');
	const id = await sql.begin(async tx => {
		// one open table per host: close any older lobby they left behind
		await tx`update games set status = 'abandoned' where host_id = ${user.id} and status = 'lobby'`;
		const [g] = await tx<{ id: number }[]>`
			insert into games (host_id, pin, timer_sec, variant, deck_remaining) values (${user.id}, ${pin}, ${timerSec}, ${variant}, ${variant === 'super' ? 54 : 52}) returning id`;
		await tx`insert into game_players (game_id, user_id, seat, card_count) values (${g.id}, ${user.id}, 1, 0)`;
		return g.id;
	});
	await notifyLobbyList();
	return id;
}

export async function listOpenGames(user: Session, publicOnly: boolean, search: string) {
	await closeStaleGamesSometimes();
	const s = search.replace(/\D/g, '');
	return sql<{ id: number; private: boolean; variant: Variant; host: string; photo: string; players: number; created_at: Date }[]>`
		select g.id, (g.pin is not null) as private, g.variant, h.username as host, h.photo, g.created_at,
		       (select count(*)::int from game_players p where p.game_id = g.id) as players
		from games g
		join users h on h.id = g.host_id
		join game_players hp on hp.game_id = g.id and hp.user_id = g.host_id
		where g.status = 'lobby'
		  and (hp.last_seen > now() - make_interval(secs => ${ONLINE_SECONDS}) or g.host_id = ${user.id})
		  and (select count(*) from game_players p where p.game_id = g.id) < 6
		  ${publicOnly ? sql`and g.pin is null` : sql``}
		  ${s ? sql`and g.id::text like ${'%' + s + '%'}` : sql``}
		order by g.id desc
		limit 20`;
}

export async function listMyGames(user: Session) {
	await closeStaleGamesSometimes();
	return sql<{ id: number; variant: Variant; moves: number; host: string; photo: string; players: number; my_turn: boolean }[]>`
		select g.id, g.variant, coalesce((g.state->>'moves')::int, 0) as moves, h.username as host, h.photo,
		       (select count(*)::int from game_players p where p.game_id = g.id and p.left_at is null) as players,
		       (g.turn_user_id = ${user.id}) as my_turn
		from games g
		join game_players me on me.game_id = g.id and me.user_id = ${user.id} and me.left_at is null
		join users h on h.id = g.host_id
		where g.status = 'playing'
		order by g.updated_at desc
		limit 20`;
}

/**
 * Quick Game: sit at the fullest open public table that still has a seat (host online),
 * or open a new public table. Returns where to go.
 */
export async function quickGame(user: Session, variant: Variant = 'classic'): Promise<{ id: number; created: boolean }> {
	await closeStaleGamesSometimes();
	const tables = await sql<{ id: number }[]>`
		select g.id
		from games g
		join game_players hp on hp.game_id = g.id and hp.user_id = g.host_id
		where g.status = 'lobby' and g.pin is null and g.host_id <> ${user.id} and g.variant = ${variant}
		  and hp.last_seen > now() - make_interval(secs => ${ONLINE_SECONDS})
		  and (select count(*) from game_players p where p.game_id = g.id) < 6
		order by (select count(*) from game_players p where p.game_id = g.id) desc, g.id
		limit 5`;
	for (const t of tables) {
		try { await joinGame(user, t.id, null); return { id: t.id, created: false }; }
		catch (e) { if (!(e instanceof GameError)) throw e; } // filled up or started meanwhile: try the next one
	}
	return { id: await createGame(user, null, 30, variant), created: true };
}

/** Quick Game host after the wait: fill the table to 3 with Virtual Friends and start. */
export async function quickFillAndStart(user: Session, gameId: number): Promise<void> {
	const [g] = await sql<{ host_id: number; status: string; players: number; timer_sec: number }[]>`
		select host_id, status, timer_sec, (select count(*)::int from game_players p where p.game_id = g.id) as players from games g where id = ${gameId}`;
	if (!g) throw new GameError('Game not found', 404);
	if (g.host_id !== user.id) throw new GameError('Only the host can start the game', 403);
	if (g.status !== 'lobby') return;
	for (let n = g.players; n < 3; n++) await addVirtualFriend(user, gameId);
	await startGame(user, gameId, g.timer_sec, 'normal');
}

export async function joinGame(user: Session, gameId: number, pin: string | null): Promise<'joined' | 'member'> {
	const result = await sql.begin(async tx => {
		const g = await lock(tx, gameId);
		const members = await tx<{ user_id: number; seat: number }[]>`select user_id, seat from game_players where game_id = ${gameId}`;
		if (members.some(m => m.user_id === user.id)) return 'member' as const;
		if (g.status !== 'lobby') throw new GameError('This game has already started', 409);
		if (g.pin && g.pin !== (pin || '')) throw new GameError(pin ? 'That PIN is not right. Try again.' : 'This game needs a PIN', 403);
		if (members.length >= 6) throw new GameError('This table is full (6 players)', 409);
		const taken = new Set(members.map(m => m.seat));
		const seat = [1, 2, 3, 4, 5, 6].find(x => !taken.has(x))!;
		await tx`insert into game_players (game_id, user_id, seat, card_count) values (${gameId}, ${user.id}, ${seat}, 0)`;
		await bump(tx, gameId);
		return 'joined' as const;
	});
	await ping(gameId);
	return result;
}

/** Shortest sensible reason text: no control characters, max 80 characters. */
export function cleanReason(raw: unknown): string {
	return Array.from(String(raw ?? '').replace(/[\u0000-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim()).slice(0, 80).join('');
}

async function roleOf(tx: Tx, userId: number): Promise<string> {
	const [u] = await tx<{ role: string }[]>`select role from users where id = ${userId}`;
	return u?.role || 'player';
}

/** Host of the table, or a super admin (any table). */
async function canManage(tx: Tx, g: GameRow, userId: number): Promise<boolean> {
	return g.host_id === userId || (await roleOf(tx, userId)) === 'superadmin';
}

/** Leave a table. In the waiting room no reason is needed; during a game a reason is required. */
export async function leaveGame(user: Session, gameId: number, reasonRaw?: unknown): Promise<void> {
	const reason = cleanReason(reasonRaw);
	await sql.begin(async tx => {
		const g = await lock(tx, gameId);
		if (g.status === 'lobby') {
			if (g.host_id === user.id) await tx`update games set status = 'abandoned' where id = ${gameId}`;
			else await tx`delete from game_players where game_id = ${gameId} and user_id = ${user.id}`;
			await bump(tx, gameId);
			return;
		}
		if (g.status !== 'playing' || !g.state) throw new GameError('This game is not being played', 409);
		if (!reason) throw new GameError('Choose a reason for leaving');
		await takeOut(tx, g, user.id, user.id, reason, `left the game · ${reason}`);
	});
	await ping(gameId);
	await notifyLobbyList();
}

/** Remove a player: the host, or a super admin. Works in the waiting room and during a game. */
export async function kickPlayer(user: Session, gameId: number, target: number, reasonRaw?: unknown): Promise<void> {
	const reason = cleanReason(reasonRaw);
	await sql.begin(async tx => {
		const g = await lock(tx, gameId);
		if (!(await canManage(tx, g, user.id))) throw new GameError('Only the host or a super admin can remove players', 403);
		if (target === user.id) throw new GameError('To go yourself, use Leave game');
		if (g.status === 'lobby') {
			await tx`delete from game_players where game_id = ${gameId} and user_id = ${target}`;
			await bump(tx, gameId);
			return;
		}
		if (g.status !== 'playing' || !g.state) throw new GameError('This game is not being played', 409);
		if (!reason) throw new GameError('Choose a reason for removing them');
		await takeOut(tx, g, target, user.id, reason, `was removed by {${user.id}} · ${reason}`);
	});
	await ping(gameId);
}

/** End a game early (host or super admin). No leaderboard points are given. */
export async function endGame(user: Session, gameId: number, reasonRaw: unknown): Promise<void> {
	const reason = cleanReason(reasonRaw);
	if (!reason) throw new GameError('Choose a reason for ending the game');
	await sql.begin(async tx => {
		const g = await lock(tx, gameId);
		if (!(await canManage(tx, g, user.id))) throw new GameError('Only the host or a super admin can end the game', 403);
		if (g.status !== 'playing' || !g.state) throw new GameError('This game is not being played', 409);
		await finishEarly(tx, g, g.state, user.id, reason);
	});
	await ping(gameId);
	await notifyLobbyList();
}

/** Take one player out of a running game; end it if fewer than 2 players (or no people) remain. */
async function takeOut(tx: Tx, g: GameRow, target: number, by: number | null, reason: string, note: string) {
	const state = g.state!;
	if (!state.players[String(target)]) throw new GameError('That player is not in this game', 404);
	const seqBefore = state.seq;
	const left = removePlayer(state, target, note);
	await tx`update game_players set left_at = now(), left_reason = ${reason}, left_by = ${by}, hand_cards = '[]'::jsonb, card_count = 0
		where game_id = ${g.id} and user_id = ${target}`;
	const people = state.order.filter(id => !state.bots?.includes(id)).length;
	if (left < 2 || people === 0) return finishEarly(tx, g, state, null, left < 2 ? 'Not enough players left' : 'Only Virtual Friends were left');
	return save(tx, g, state, by ?? target, seqBefore);
}

export const AWAY_REASON = `Away · missed ${AWAY_TURNS} turns in a row`;

/** After a timed-out turn: save, taking the player out if they've now missed AWAY_TURNS turns in a row. */
async function saveAfterTimeout(tx: Tx, g: GameRow, state: GameState, timedOut: number | null, seqBefore: number) {
	const away = awayPlayer(state, timedOut);
	if (away === null) return save(tx, g, state, timedOut ?? g.host_id, seqBefore);
	await recordEvents(tx, g.id, state, timedOut ?? g.host_id, seqBefore);
	return takeOut(tx, { ...g, state }, away, null, AWAY_REASON, `was taken out · ${AWAY_REASON.toLowerCase()}`);
}

async function finishEarly(tx: Tx, g: GameRow, state: GameState, by: number | null, reason: string) {
	state.turn = null;
	state.log.unshift(by ? `Game ended by {${by}} · ${reason}` : `Game ended · ${reason}`);
	state.log.length = Math.min(state.log.length, 8);
	await tx`insert into game_events (game_id, user_id, event_type, payload) values (${g.id}, ${by ?? g.host_id}, 'ended', ${tx.json({ reason, by } as never)})`;
	const [row] = await tx<{ version: number; turn_deadline: Date | null; status: string }[]>`
		update games set state = ${tx.json(state as never)}, status = 'ended', end_reason = ${reason}, ended_by = ${by},
			turn_user_id = null, turn_deadline = null, finished_at = now(), version = version + 1
		where id = ${g.id}
		returning version, turn_deadline, status`;
	return row;
}

// ---------- Stuck games ----------

let lastSweep = 0;
/** Runs the stale-game sweep at most every 10 minutes per server instance (cheap, called from lists). */
async function closeStaleGamesSometimes() {
	if (Date.now() - lastSweep < 10 * 60 * 1000) return;
	lastSweep = Date.now();
	try { await closeStaleGames(); } catch (e) { console.error('stale sweep', e); }
}

/** Close games nobody has touched for STALE_HOURS. Returns how many lobbies and games were closed. */
export async function closeStaleGames(): Promise<{ lobbies: number; games: number }> {
	const reason = `No moves for ${STALE_HOURS} hours`;
	const lobbies = await sql`
		update games set status = 'abandoned'
		where status = 'lobby' and updated_at < now() - make_interval(hours => ${STALE_HOURS})
		returning id`;
	const games = await sql<{ id: number; version: number }[]>`
		update games set status = 'ended', end_reason = ${reason}, ended_by = null,
			turn_user_id = null, turn_deadline = null, finished_at = now(), version = version + 1,
			state = case when state is null then null else jsonb_set(
				jsonb_set(state, '{turn}', 'null'::jsonb), '{log}',
				jsonb_build_array(${'Game ended · ' + reason}::text) || coalesce(state->'log', '[]'::jsonb)) end
		where status = 'playing' and updated_at < now() - make_interval(hours => ${STALE_HOURS})
		returning id, version`;
	for (const g of games) await notifyGame(g.id, g.version);
	if (lobbies.length || games.length) await notifyLobbyList();
	return { lobbies: lobbies.length, games: games.length };
}

/** Admin overview: games being played and open waiting rooms (last 24 h), with people and/or Virtual Friends. */
export async function liveTables() {
	return sql<{ id: number; status: 'lobby' | 'playing'; private: boolean; variant: Variant; host: string; moves: number; timer_sec: number; updated_at: Date; created_at: Date; with_bots: boolean; people: number; players: { id: number; username: string; photo: string; isBot: boolean }[]; turn: string | null }[]>`
		select g.id, g.status, (g.pin is not null) as private, g.variant, h.username as host, coalesce((g.state->>'moves')::int, 0) as moves, g.timer_sec, g.updated_at, g.created_at,
		       exists(select 1 from game_players p join users u on u.id = p.user_id where p.game_id = g.id and p.left_at is null and u.is_bot) as with_bots,
		       (select count(*)::int from game_players p join users u on u.id = p.user_id where p.game_id = g.id and p.left_at is null and not u.is_bot) as people,
		       (select coalesce(json_agg(json_build_object('id', u.id, 'username', u.username, 'photo', u.photo, 'isBot', u.is_bot) order by p.seat), '[]'::json)
		          from game_players p join users u on u.id = p.user_id where p.game_id = g.id and p.left_at is null) as players,
		       (select username from users where id = g.turn_user_id) as turn
		from games g join users h on h.id = g.host_id
		where g.status = 'playing' or (g.status = 'lobby' and g.updated_at > now() - interval '24 hours')
		order by g.updated_at desc
		limit 200`;
}

export async function startGame(user: Session, gameId: number, timerSec: number, level: BotLevel = 'normal'): Promise<void> {
	const rules = await getRules();
	await sql.begin(async tx => {
		const g = await lock(tx, gameId);
		if (g.host_id !== user.id) throw new GameError('Only the host can start the game', 403);
		if (g.status !== 'lobby') throw new GameError('The game has already started', 409);
		const players = await tx<{ user_id: number; is_bot: boolean }[]>`
			select p.user_id, u.is_bot from game_players p join users u on u.id = p.user_id where p.game_id = ${gameId} order by p.seat`;
		if (players.length < 2) throw new GameError('You need at least 2 players to start');
		const bots = players.filter(p => p.is_bot).map(p => p.user_id);
		if (bots.length && !(await getSettings()).virtualFriends) throw new GameError('Virtual Friends are switched off. Remove them to start.', 409);
		const state = newGame(g.variant, players.map(p => p.user_id), rules);
		state.bots = bots;
		if (bots.length) state.botLevel = level;
		await tx`update games set timer_sec = ${timerSec} where id = ${gameId}`;
		await tx`insert into game_events (game_id, user_id, event_type, payload) values (${gameId}, ${user.id}, 'start',
			${tx.json({ variant: g.variant, order: state.order, cutter: state.cutter, top: state.discard[0], rules } as never)})`;
		await save(tx, { ...g, timer_sec: timerSec }, state, user.id, state.seq);
	});
	await ping(gameId);
	await notifyLobbyList();
}

export async function playAgain(user: Session, gameId: number): Promise<number> {
	const newId = await sql.begin(async tx => {
		const g = await lock(tx, gameId);
		if (g.host_id !== user.id) throw new GameError('Only the host can start a new game', 403);
		if (g.status !== 'finished' && g.status !== 'ended') throw new GameError('This game hasn’t finished yet', 409);
		if (g.next_game_id) return g.next_game_id;
		await tx`update games set status = 'abandoned' where host_id = ${user.id} and status = 'lobby'`;
		const [ng] = await tx<{ id: number }[]>`
			insert into games (host_id, variant, pin, timer_sec, deck_remaining) values (${user.id}, ${g.variant}, ${g.pin}, ${g.timer_sec}, ${g.variant === 'super' ? 54 : 52}) returning id`;
		await tx`insert into game_players (game_id, user_id, seat, card_count)
			select ${ng.id}, user_id, seat, 0 from game_players where game_id = ${gameId} and left_at is null`;
		await tx`update games set next_game_id = ${ng.id} where id = ${gameId}`;
		await bump(tx, gameId);
		return ng.id;
	});
	await ping(gameId);
	await notifyLobbyList();
	return newId;
}

/** Host adds one Virtual Friend to their waiting room. */
export async function addVirtualFriend(user: Session, gameId: number): Promise<void> {
	if (!(await getSettings()).virtualFriends) throw new GameError('Virtual Friends are switched off by the admin', 403);
	await sql.begin(async tx => {
		const g = await lock(tx, gameId);
		if (g.host_id !== user.id) throw new GameError('Only the host can add Virtual Friends', 403);
		if (g.status !== 'lobby') throw new GameError('The game has already started', 409);
		const seats = await tx<{ user_id: number; seat: number; is_bot: boolean }[]>`
			select p.user_id, p.seat, u.is_bot from game_players p join users u on u.id = p.user_id where p.game_id = ${gameId}`;
		if (seats.length >= 6) throw new GameError('This table is full (6 players)', 409);
		if (seats.filter(x => x.is_bot).length >= MAX_VIRTUAL_FRIENDS) throw new GameError('A table can have up to 5 Virtual Friends', 409);
		const [bot] = await tx<{ id: number }[]>`
			select id from users where is_bot and status = 'active'
			  and id not in (select user_id from game_players where game_id = ${gameId})
			order by random() limit 1`;
		if (!bot) throw new GameError('No more Virtual Friends are free', 409);
		const taken = new Set(seats.map(x => x.seat));
		const seat = [1, 2, 3, 4, 5, 6].find(x => !taken.has(x))!;
		await tx`insert into game_players (game_id, user_id, seat, card_count) values (${gameId}, ${bot.id}, ${seat}, 0)`;
		await bump(tx, gameId);
	});
	await ping(gameId);
}

/** One tap: a private table with `count` Virtual Friends that starts right away. */
export async function startPractice(user: Session, count: number, timerSec: number, level: BotLevel = 'normal', variant: Variant = 'classic'): Promise<number> {
	if (!(await getSettings()).virtualFriends) throw new GameError('Virtual Friends are switched off by the admin', 403);
	const n = Math.max(1, Math.min(MAX_VIRTUAL_FRIENDS, Math.floor(count)));
	const rules = await getRules();
	return sql.begin(async tx => {
		await tx`update games set status = 'abandoned' where host_id = ${user.id} and status = 'lobby'`;
		const pin = String(1000 + Math.floor(Math.random() * 9000)); // private, so it never shows in Open tables
		const [g] = await tx<GameRow[]>`insert into games (host_id, pin, timer_sec, variant) values (${user.id}, ${pin}, ${timerSec}, ${variant}) returning *`;
		const bots = await tx<{ id: number }[]>`select id from users where is_bot and status = 'active' order by random() limit ${n}`;
		if (!bots.length) throw new GameError('No Virtual Friends are set up yet. Ask the admin to run the database update.', 409);
		const ids = [user.id, ...bots.map(b => b.id)];
		for (let i = 0; i < ids.length; i++) await tx`insert into game_players (game_id, user_id, seat) values (${g.id}, ${ids[i]}, ${i + 1})`;
		const state = newGame(variant, ids, rules);
		state.bots = bots.map(b => b.id);
		state.botLevel = level;
		await tx`insert into game_events (game_id, user_id, event_type, payload) values (${g.id}, ${user.id}, 'start',
			${tx.json({ variant, order: state.order, cutter: state.cutter, top: state.discard[0], rules, practice: true } as never)})`;
		await save(tx, g, state, user.id, state.seq);
		return g.id;
	});
}

// ---------- Playing ----------

export interface MoveResult {
	changed: boolean; status: string; version: number; deadline: string | null; serverNow: string;
	nextGameId: number | null; view: GameView | null;
}

/** Apply one move. Fast path: a handful of database round trips, answered from the saved state (no re-read). */
export async function move(user: Session, gameId: number, action: Action): Promise<MoveResult> {
	return sql.begin(async tx => {
		const g = await lockAsMember(tx, gameId, user.id);
		if (g.status === 'ended') throw new GameError('This game was ended', 409);
		if (g.status === 'finished') throw new GameError('This game has finished', 409);
		if (g.status !== 'playing' || !g.state) throw new GameError('This game is not being played right now', 409);
		const state = g.state;
		const seqBefore = state.seq;
		if (action.type === 'timeout') {
			// Any player's device may report the timer; the server decides if it really ran out
			if (!g.turn_deadline || g.turn_deadline.getTime() > Date.now() + 1000) return result(g, state, user.id, false);
			const timedOut = state.turn;
			runDueTurn(state);
			const saved = await saveAfterTimeout(tx, g, state, timedOut, seqBefore);
			return result({ ...g, ...saved }, state, user.id, true);
		}
		apply(state, user.id, action);
		const saved = await save(tx, g, state, user.id, seqBefore);
		return result({ ...g, ...saved }, state, user.id, true);
	});
}

function result(g: Pick<GameRow, 'status' | 'version' | 'turn_deadline' | 'next_game_id'>, state: GameState, me: number, changed: boolean): MoveResult {
	return {
		changed, status: g.status, version: g.version,
		deadline: g.turn_deadline ? new Date(g.turn_deadline).toISOString() : null,
		serverNow: new Date().toISOString(), nextGameId: g.next_game_id, view: state.players[String(me)] ? viewFor(state, me) : null, // null: they were just taken out
	};
}

/** Read a player's view. Also records they're online and applies an overdue timeout. */
export async function getGame(user: Session, gameId: number) {
	await sql`update game_players set last_seen = now() where game_id = ${gameId} and user_id = ${user.id}`;
	let [g] = await sql<(GameRow & { chat_last: number | null })[]>`
		select g.*, (select max(m.id) from game_messages m where m.game_id = g.id) as chat_last from games g where g.id = ${gameId}`;
	if (!g) throw new GameError('Game not found', 404);

	// Turn timer ran out and nobody reported it (e.g. that player closed the app): play it now
	// (Virtual Friends move as soon as their thinking time is up; people get a 2 s grace)
	const grace = (row: GameRow) => (isBotTurn(row.state) ? 0 : 2000);
	if (g.status === 'playing' && g.turn_deadline && g.turn_deadline.getTime() < Date.now() - grace(g)) {
		let changed = false;
		await sql.begin(async tx => {
			const locked = await lock(tx, gameId);
			if (locked.status !== 'playing' || !locked.state || !locked.turn_deadline || locked.turn_deadline.getTime() >= Date.now() - grace(locked)) return;
			const seqBefore = locked.state.seq;
			const timedOut = locked.state.turn;
			runDueTurn(locked.state);
			await saveAfterTimeout(tx, locked, locked.state, timedOut, seqBefore);
			changed = true;
		});
		if (changed) {
			after(async () => { await alertTurn(gameId); await alertFinished(gameId); }); // each checks the game's status itself
			await ping(gameId);
			[g] = await sql<(GameRow & { chat_last: number | null })[]>`
				select g.*, (select max(m.id) from game_messages m where m.game_id = g.id) as chat_last from games g where g.id = ${gameId}`;
		}
	}

	const players = await sql<{ user_id: number; seat: number; username: string; photo: string; online: boolean; is_bot: boolean; left_at: Date | null; left_reason: string | null; left_by: number | null; role: string }[]>`
		select p.user_id, p.seat, u.username, u.photo, u.is_bot, p.left_at, p.left_reason, p.left_by, u.role,
		       (u.is_bot or p.last_seen > now() - make_interval(secs => ${ONLINE_SECONDS})) as online
		from game_players p join users u on u.id = p.user_id
		where p.game_id = ${gameId} order by p.seat`;
	const meRow = players.find(p => p.user_id === user.id);
	const isMember = !!meRow && !meRow.left_at;
	const [{ role: myRole } = { role: 'player' }] = await sql<{ role: string }[]>`select role from users where id = ${user.id}`;
	const isAdmin = myRole === 'admin' || myRole === 'superadmin';
	if (!meRow && g.status !== 'lobby' && !isAdmin) throw new GameError('You are not in this game', 403);

	const view: GameView | null = g.state && isMember ? viewFor(g.state, user.id) : null;
	// Admins not at the table can watch: everyone's table, never anyone's hand
	const watch: GameView | null = g.state && !meRow && isAdmin ? viewFor(g.state, -1) : null;
	return {
		id: g.id,
		me: user.id,
		status: g.status,
		variant: g.variant,
		hostId: g.host_id,
		isMember,
		pin: isMember ? g.pin : null,
		private: !!g.pin,
		timerSec: g.timer_sec,
		version: g.version,
		deadline: g.turn_deadline ? g.turn_deadline.toISOString() : null,
		serverNow: new Date().toISOString(),
		nextGameId: g.next_game_id,
		chatLast: isMember ? g.chat_last ?? 0 : 0,
		players: players.map(p => ({ id: p.user_id, seat: p.seat, username: p.username, photo: p.photo, online: p.online, isBot: p.is_bot, left: !!p.left_at })),
		canManage: g.host_id === user.id || myRole === 'superadmin',
		superAdmin: myRole === 'superadmin',
		myLeft: meRow?.left_at ? { by: meRow.left_by, byName: await nameOfUser(meRow.left_by), reason: meRow.left_reason } : null,
		ended: g.status === 'ended' ? { by: g.ended_by ?? null, byName: await nameOfUser(g.ended_by ?? null), reason: g.end_reason ?? '' } : null,
		practice: !!g.state?.bots?.length,
		view,
		watch,
	};
}

export async function leaderboard() {
	return sql<{ id: number; username: string; photo: string; points: number; games: number }[]>`
		with month as (
			select date_trunc('month', now() at time zone 'Africa/Kampala') at time zone 'Africa/Kampala' as start
		)
		select u.id, u.username, u.photo, sum(gp.points)::int as points, count(*)::int as games
		from game_points gp join users u on u.id = gp.user_id, month
		where gp.created_at >= month.start and not u.is_bot
		group by u.id order by points desc, games asc, u.username
		limit 50`;
}

// ---------- helpers ----------

async function lock(tx: Tx, gameId: number): Promise<GameRow> {
	const [g] = await tx<GameRow[]>`select * from games where id = ${gameId} for update`;
	if (!g) throw new GameError('Game not found', 404);
	return g;
}

async function lockAsMember(tx: Tx, gameId: number, userId: number): Promise<GameRow> {
	const [g] = await tx<(GameRow & { is_member: boolean })[]>`
		select g.*, exists(select 1 from game_players p where p.game_id = g.id and p.user_id = ${userId} and p.left_at is null) as is_member
		from games g where g.id = ${gameId} for update`;
	if (!g) throw new GameError('Game not found', 404);
	if (!g.is_member) throw new GameError('You are not in this game', 403);
	return g;
}

async function bump(tx: Tx, gameId: number) {
	await tx`update games set version = version + 1 where id = ${gameId}`;
}

/** Turn history: one game_events row per table event since `seqBefore` (moves, draws, penalties, effects, results). */
async function recordEvents(tx: Tx, gameId: number, state: GameState, actor: number, seqBefore: number) {
	const fresh = state.events.filter(e => e.n > seqBefore);
	const rows: { game_id: number; user_id: number; event_type: string; payload: unknown }[] = fresh.map((e: TableEvent) => {
		const { t, by, ...rest } = e;
		return { game_id: gameId, user_id: by || actor, event_type: t, payload: rest };
	});
	if (state.finished) rows.push({ game_id: gameId, user_id: state.finished.by ?? actor, event_type: 'finish', payload: state.finished });
	if (!rows.length) return;
	await tx`insert into game_events ${tx(rows.map(r => ({ ...r, payload: tx.json(r.payload as never) })), 'game_id', 'user_id', 'event_type', 'payload')}`;
}

/**
 * Persist the engine state + turn deadline, mirror the readable columns from it, write the turn history
 * and — when the game ends — final places and leaderboard points.
 */
async function save(tx: Tx, g: GameRow, state: GameState, actor: number, seqBefore: number) {
	const finished = !!state.finished;
	const secs = finished || state.turn === null ? null
		: isBotTurn(state) ? botSeconds()
		: g.timer_sec ? g.timer_sec : null;
	const top = state.discard[0] ?? null;
	const [row] = await tx<{ version: number; turn_deadline: Date | null; status: string }[]>`
		update games set
			state = ${tx.json(state as never)},
			status = ${finished ? 'finished' : 'playing'},
			version = version + 1,
			turn_user_id = ${state.turn},
			turn_deadline = ${secs === null ? null : tx`now() + make_interval(secs => ${secs})`},
			finished_at = ${finished ? tx`now()` : null},
			current_suit = ${finished ? null : SUIT_DB[state.suit]},
			top_card_rank = ${top ? (isJoker(top) ? 'JOKER' : rankOf(top)) : null},
			top_card_suit = ${top && !isJoker(top) ? SUIT_DB[suitOf(top)!] : null},
			cutter_rank = ${rankOf(state.cutter)},
			cutter_suit = ${SUIT_DB[suitOf(state.cutter)!]},
			deck_remaining = ${state.deck.length},
			discard_pile = ${tx.json(state.discard as never)},
			direction = ${state.direction}
		where id = ${g.id}
		returning version, turn_deadline, status`;

	// Hands (server-side only: never selected for other players)
	const hands = state.order.map(id => {
		const hand = state.players[String(id)].hand;
		const st = state.finished?.standings.find(x => x.id === id);
		return { uid: id, hand, n: hand.length, pts: st ? st.points : 0, rank: st ? st.rank : null, cut: state.finished?.how === 'cut' && state.finished.by === id };
	});
	await tx`
		update game_players as gp set hand_cards = v.hand, card_count = v.n,
			points = case when ${finished} then v.pts else gp.points end,
			final_rank = case when ${finished} then v.rank else gp.final_rank end,
			has_cut_card = v.cut
		from jsonb_to_recordset(${tx.json(hands as never)}) as v(uid bigint, hand jsonb, n int, pts int, rank int, cut boolean)
		where gp.game_id = ${g.id} and gp.user_id = v.uid`;

	await recordEvents(tx, g.id, state, actor, seqBefore);

	// Games with Virtual Friends are practice: no leaderboard points
	if (state.finished && !state.bots?.length) {
		const pts = state.finished.standings.map(x => ({ user_id: x.id, game_id: g.id, points: x.award }));
		await tx`insert into game_points ${tx(pts, 'user_id', 'game_id', 'points')} on conflict (game_id, user_id) do nothing`;
	}
	return row;
}

async function ping(gameId: number) {
	const [g] = await sql<{ version: number }[]>`select version from games where id = ${gameId}`;
	if (g) await notifyGame(gameId, g.version);
}

// ---------- Delete my account ----------

/**
 * Deletes a player's account. Personal data goes (profile, password, chat, points, friends, invites, alerts).
 * A player who never played is deleted completely; otherwise the row stays as an anonymous "Deleted<id>" so
 * other players' finished games keep making sense. Running games carry on without them.
 */
export async function deleteAccount(user: Session, password: string, confirm: string): Promise<{ removed: 'deleted' | 'anonymised'; games: number[] }> {
	if (confirm.trim().toUpperCase() !== 'DELETE') throw new GameError('Type DELETE to confirm');
	const touched: number[] = [];
	const removed = await sql.begin(async tx => {
		const [u] = await tx<{ ok: boolean; role: string; is_bot: boolean }[]>`
			select app_check_password(${password}, password_hash) as ok, role, is_bot from users where id = ${user.id} for update`;
		if (!u || u.is_bot) throw new GameError('Account not found', 404);
		if (!u.ok) throw new GameError('That password isn’t right', 403);
		if (u.role === 'superadmin') throw new GameError('The super admin account can’t be deleted. Make someone else super admin first.', 409);

		// games in play: leave like any player (the others carry on); waiting rooms: close or leave
		const seats = await tx<{ game_id: number; status: string; host_id: number }[]>`
			select g.id as game_id, g.status, g.host_id from game_players p join games g on g.id = p.game_id
			where p.user_id = ${user.id} and p.left_at is null and g.status in ('playing', 'lobby')`;
		for (const s of seats) {
			const g = await lock(tx, s.game_id);
			if (g.status === 'playing' && g.state?.players[String(user.id)]) {
				await takeOut(tx, g, user.id, user.id, 'Account deleted', 'left the game · Account deleted');
			} else if (g.status === 'lobby') {
				if (g.host_id === user.id) await tx`update games set status = 'abandoned' where id = ${g.id}`;
				else await tx`delete from game_players where game_id = ${g.id} and user_id = ${user.id}`;
				await bump(tx, g.id);
			}
			touched.push(s.game_id);
		}

		// personal content
		await tx`delete from game_messages where user_id = ${user.id}`;
		await tx`delete from game_points where user_id = ${user.id}`;
		await tx`delete from friendships where requester_id = ${user.id} or addressee_id = ${user.id}`;
		await tx`delete from game_invites where from_id = ${user.id} or to_id = ${user.id}`;
		await tx`delete from push_subscriptions where user_id = ${user.id}`;
		await tx`update app_settings set updated_by = null where updated_by = ${user.id}`;

		const [{ shared }] = await tx<{ shared: boolean }[]>`
			select exists(select 1 from game_players where user_id = ${user.id} or left_by = ${user.id})
			    or exists(select 1 from games where host_id = ${user.id} or turn_user_id = ${user.id} or ended_by = ${user.id})
			    or exists(select 1 from game_events where user_id = ${user.id}) as shared`;
		if (!shared) {
			await tx`delete from users where id = ${user.id}`;
			return 'deleted' as const;
		}
		await tx`
			update users set username = ${'Deleted' + user.id}, fullname = '', email = null, phone = null, photo = 'na.png',
				password_hash = app_hash_password(${crypto.randomUUID()}), status = 'suspended', role = 'player',
				must_change_password = false, last_seen_at = null, last_login_at = null
			where id = ${user.id}`;
		return 'anonymised' as const;
	});
	for (const id of touched) await ping(id);
	if (touched.length) await notifyLobbyList();
	console.log('[account]', JSON.stringify({ action: 'delete', id: user.id, removed }));
	return { removed, games: touched };
}
