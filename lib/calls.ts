import 'server-only';
import { HttpError, must, type Db } from './api';
import { callToken, livekitConfigured } from './livekit';

/** LiveKit pass for a call the person is joined to (checked by the database, not by the room name). */
export async function passFor(db: Db, userId: string, callId: string) {
	if (!livekitConfigured()) throw new HttpError('Voice calls aren’t set up on this server yet', 503);
	const rows = must(await db.rpc('call_access', { p_call: callId }), 'call_access');
	const access = rows?.[0];
	if (!access) throw new HttpError('You’re not in this call', 403);
	const { data: me } = await db.from('profiles').select('display_name').eq('id', userId).single();
	return callToken({ identity: userId, name: me?.display_name || 'Silo user', room: access.room_name, media: access.media });
}
