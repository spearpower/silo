// Voice chat at a table (LiveKit Cloud). Our server hands out a short-lived voice pass only to
// players seated at the table, and only while the admin switch is on.
import { AccessToken, TrackSource } from 'livekit-server-sdk';
import { sql } from './db';
import { GameError } from './engine';
import { Session } from './session';
import { getSettings, voiceConfigured } from './settings';

export const roomName = (gameId: number) => `picknplay-game-${gameId}`;

export async function voicePass(user: Session, gameId: number): Promise<{ url: string; token: string; room: string }> {
	if (!voiceConfigured()) throw new GameError('Voice chat isn’t set up on this server', 503);
	if (!(await getSettings()).voiceChat) throw new GameError('Voice chat is switched off by the admin', 403);
	const [m] = await sql<{ status: string }[]>`
		select g.status from games g join game_players p on p.game_id = g.id
		where g.id = ${gameId} and p.user_id = ${user.id} and p.left_at is null`;
	if (!m) throw new GameError('Only players at this table can join its voice chat', 403);
	if (m.status !== 'playing' && m.status !== 'lobby') throw new GameError('This game is over', 409);
	const at = new AccessToken(process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!, {
		identity: String(user.id), name: user.username, ttl: '3h',
	});
	at.addGrant({
		room: roomName(gameId), roomJoin: true, canSubscribe: true, canPublish: true, canPublishData: false,
		canPublishSources: [TrackSource.MICROPHONE],
	});
	return { url: process.env.LIVEKIT_URL!, token: await at.toJwt(), room: roomName(gameId) };
}
