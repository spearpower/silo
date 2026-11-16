// Player stats and game history, worked out from game_players / games / game_points (no extra columns).
import { sql } from './db';
import { GameError } from './engine';
import { titles } from './fame';

export interface PlayerStats {
	user: { id: number; username: string; photo: string };
	titles: number;
	games: number; wins: number; winRate: number; avgPlace: number | null;
	bestStreak: number; streak: number; points: number;
	practiceGames: number; practiceWins: number;
	headToHead: { id: number; username: string; photo: string; games: number; wins: number; losses: number }[];
}

/** Finished games only. "Games" = with people (counts for Scores); practice = with Virtual Friends. */
export async function playerStats(userId: number): Promise<PlayerStats> {
	const [user] = await sql<{ id: number; username: string; photo: string; is_bot: boolean }[]>`
		select id, username, photo, is_bot from users where id = ${userId}`;
	if (!user || user.is_bot) throw new GameError('Player not found', 404);

	const rows = await sql<{ final_rank: number; practice: boolean }[]>`
		select gp.final_rank,
		       exists(select 1 from game_players x join users u on u.id = x.user_id where x.game_id = g.id and u.is_bot) as practice
		from game_players gp join games g on g.id = gp.game_id
		where gp.user_id = ${userId} and g.status = 'finished' and gp.final_rank is not null and gp.left_at is null
		order by g.finished_at nulls first, g.id`;
	const real = rows.filter(r => !r.practice);
	const practice = rows.filter(r => r.practice);
	let best = 0, run = 0;
	for (const r of real) { run = r.final_rank === 1 ? run + 1 : 0; best = Math.max(best, run); }
	const wins = real.filter(r => r.final_rank === 1).length;

	const [{ points }] = await sql<{ points: number }[]>`select coalesce(sum(points), 0)::int as points from game_points where user_id = ${userId}`;

	const h2h = await sql<{ id: number; username: string; photo: string; games: number; wins: number; losses: number }[]>`
		select o.user_id as id, u.username, u.photo, count(*)::int as games,
		       sum(case when me.final_rank < o.final_rank then 1 else 0 end)::int as wins,
		       sum(case when me.final_rank > o.final_rank then 1 else 0 end)::int as losses
		from game_players me
		join game_players o on o.game_id = me.game_id and o.user_id <> me.user_id
		join games g on g.id = me.game_id
		join users u on u.id = o.user_id
		where me.user_id = ${userId} and g.status = 'finished' and not u.is_bot
		  and me.final_rank is not null and o.final_rank is not null
		group by o.user_id, u.username, u.photo
		order by games desc, wins desc
		limit 12`;

	return {
		user: { id: user.id, username: user.username, photo: user.photo },
		titles: (await titles())[user.id] || 0,
		games: real.length, wins,
		winRate: real.length ? Math.round((wins / real.length) * 100) : 0,
		avgPlace: real.length ? Math.round((real.reduce((s, r) => s + r.final_rank, 0) / real.length) * 10) / 10 : null,
		bestStreak: best, streak: run, points,
		practiceGames: practice.length, practiceWins: practice.filter(r => r.final_rank === 1).length,
		headToHead: h2h,
	};
}

export interface HistoryGame {
	id: number; status: 'finished' | 'ended'; at: string | null; variant: string; moves: number; how: string | null;
	practice: boolean; endReason: string | null; endedBy: string | null;
	myRank: number | null; myLeft: string | null;
	players: { id: number; username: string; photo: string; isBot: boolean; rank: number | null; points: number; cut: boolean; left: string | null }[];
	log: string[];
}

/** My last 20 finished or ended games, newest first, with final places and the last few table events. */
export async function recentGames(userId: number): Promise<HistoryGame[]> {
	const games = await sql<{ id: number; status: 'finished' | 'ended'; finished_at: Date | null; updated_at: Date; variant: string; moves: number; how: string | null; end_reason: string | null; ended_by_name: string | null; log: string[] | null; my_rank: number | null; my_left: string | null }[]>`
		select g.id, g.status, g.finished_at, g.updated_at, g.variant, coalesce((g.state->>'moves')::int, 0) as moves, g.state->'finished'->>'how' as how, g.end_reason,
		       (select username from users where id = g.ended_by) as ended_by_name,
		       g.state->'log' as log, me.final_rank as my_rank, me.left_reason as my_left
		from game_players me join games g on g.id = me.game_id
		where me.user_id = ${userId} and g.status in ('finished', 'ended')
		order by coalesce(g.finished_at, g.updated_at) desc
		limit 20`;
	if (!games.length) return [];
	const ids = games.map(g => g.id);
	const players = await sql<{ game_id: number; user_id: number; username: string; photo: string; is_bot: boolean; final_rank: number | null; points: number; has_cut_card: boolean; left_reason: string | null }[]>`
		select p.game_id, p.user_id, u.username, u.photo, u.is_bot, p.final_rank, p.points, p.has_cut_card, p.left_reason
		from game_players p join users u on u.id = p.user_id
		where p.game_id in ${sql(ids)}
		order by p.game_id, p.final_rank nulls last, p.points, p.seat`;

	// names for {id} placeholders in the logs (super admins may not be at the table)
	const logIds = new Set<number>();
	for (const g of games) for (const line of g.log || []) for (const m of line.matchAll(/\{(\d+)\}/g)) logIds.add(Number(m[1]));
	const names = new Map<number, string>();
	if (logIds.size) for (const u of await sql<{ id: number; username: string }[]>`select id, username from users where id in ${sql([...logIds])}`) names.set(u.id, u.username);

	return games.map(g => {
		const ps = players.filter(p => p.game_id === g.id);
		return {
			id: g.id, status: g.status, at: (g.finished_at || g.updated_at)?.toISOString() ?? null, variant: g.variant, moves: g.moves, how: g.how,
			practice: ps.some(p => p.is_bot), endReason: g.end_reason, endedBy: g.ended_by_name,
			myRank: g.my_rank, myLeft: g.my_left,
			players: ps.map(p => ({ id: p.user_id, username: p.username, photo: p.photo, isBot: p.is_bot, rank: p.final_rank, points: p.points, cut: p.has_cut_card, left: p.left_reason })),
			log: (g.log || []).map(line => line.replace(/\{(\d+)\}/g, (_, x) => names.get(Number(x)) || 'Player')),
		};
	});
}
