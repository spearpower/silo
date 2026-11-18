import 'server-only';
// LiveKit access tokens. Issued only by our server, only after the database confirmed (call_access) that the
// person is joined to a live call in a conversation they belong to. Tokens are short-lived, allow the microphone
// and camera (any call can switch video on/off), never screen sharing or data; the room name is never a credential.
import { AccessToken, TrackSource } from 'livekit-server-sdk';

export const livekitConfigured = () => !!(process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET);

export const TOKEN_TTL = '10m'; // enough to connect; LiveKit refreshes it for an open connection

export async function callToken(o: { identity: string; name: string; room: string; media: 'audio' | 'video' }): Promise<{ url: string; token: string }> {
	const at = new AccessToken(process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!, {
		identity: o.identity, name: o.name, ttl: TOKEN_TTL,
	});
	// Camera is allowed in every call (a voice call can turn video on). Screen sharing is a later release.
	at.addGrant({
		room: o.room, roomJoin: true, canSubscribe: true, canPublish: true, canPublishData: false,
		canPublishSources: [TrackSource.MICROPHONE, TrackSource.CAMERA],
	});
	return { url: process.env.LIVEKIT_URL!, token: await at.toJwt() };
}
