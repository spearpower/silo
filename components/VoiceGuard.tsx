'use client';
// Hangs up table voice chat when you leave that table's pages (waiting room / table).
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { leaveVoice, voiceState } from '@/lib/voiceClient';

export default function VoiceGuard() {
	const path = usePathname() || '/';
	useEffect(() => {
		const { gameId, phase } = voiceState();
		if (phase === 'off' || gameId === null) return;
		if (path !== `/lobby/${gameId}` && path !== `/game/${gameId}`) void leaveVoice();
	}, [path]);
	return null;
}
