'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../supabase/browser';
import { useStore } from './store';

export interface Friend { id: string; username: string; display_name: string; avatar_url: string | null }
/** My accepted friends. */
export function useFriends(): Friend[] | null {
	const meId = useStore(s => s.meId);
	const [list, setList] = useState<Friend[] | null>(null);
	useEffect(() => {
		if (!meId) return;
		void (async () => {
			const db = supabase();
			const { data } = await db.from('friendships').select('requester_id, addressee_id').eq('status', 'accepted');
			const ids = (data || []).map(f => (f.requester_id === meId ? f.addressee_id : f.requester_id));
			if (!ids.length) { setList([]); return; }
			const { data: ps } = await db.from('profiles').select('id, username, display_name, avatar_url').in('id', ids).eq('status', 'active').order('display_name');
			setList(ps || []);
		})();
	}, [meId]);
	return list;
}
