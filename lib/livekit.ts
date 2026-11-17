import 'server-only';
// LiveKit access tokens. Issued only by our server, only after the database confirmed (call_access) that the
// person is joined to a live call in a conversation they belong to. Tokens are short-lived and audio-only;
// the room name is never treated as a credential.
import { AccessToken, TrackSource } from 'livekit-server-sdk';

export const livekitConfigured = () => !!(process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET);

export const TOKEN_TTL = '10m'; // enough to connect; LiveKit refreshes it for an open connection

export async function callToken(o: { identity: string; name: string; room: string; media: 'audio' | 'video' }): Promise<{ url: string; token: string }> {
	const at = new AccessToken(process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!, {
		identity: o.identity, name: o.name, ttl: TOKEN_TTL,
	});
	// Video is a later release: the 'video' media value is reserved, but tokens only allow the microphone for now.
	at.addGrant({
		room: o.room, roomJoin: true, canSubscribe: true, canPublish: true, canPublishData: false,
		canPublishSources: [TrackSource.MICROPHONE],
	});
	return { url: process.env.LIVEKIT_URL!, token: await at.toJwt() };
}
