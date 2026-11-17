'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import Avatar from '@/components/Avatar';
import { useStore } from '@/lib/client/store';
import { supabase } from '@/lib/supabase/browser';
import { api, dbMessage } from '@/lib/client/api';
import { listStamp } from '@/lib/format';
import type { ReportRow } from '@/lib/database.types';

interface P { id: string; username: string; display_name: string; avatar_url: string | null; status: string }

/** Reports from people, and suspending accounts. Admins only: the database refuses everyone else. */
export default function AdminPage() {
	const isAdmin = useStore(s => s.me?.role === 'admin');
	const ready = useStore(s => !!s.me);
	const [tab, setTab] = useState<'open' | 'closed'>('open');
	const [reports, setReports] = useState<ReportRow[] | null>(null);
	const [people, setPeople] = useState<Record<string, P>>({});
	const [error, setError] = useState('');
	const [busy, setBusy] = useState(false);

	const load = useCallback(async () => {
		const db = supabase();
		const q = db.from('user_reports').select('*').order('created_at', { ascending: false }).limit(100);
		const { data, error: e } = tab === 'open' ? await q.eq('status', 'open') : await q.neq('status', 'open');
		if (e) { setError(dbMessage(e)); return; }
		setReports(data || []);
		const ids = Array.from(new Set((data || []).flatMap(r => [r.reported_id, r.reporter_id]).filter((x): x is string => !!x)));
		if (ids.length) {
			const { data: ps } = await db.from('profiles').select('id, username, display_name, avatar_url, status').in('id', ids);
			setPeople(Object.fromEntries((ps || []).map(p => [p.id, p])));
		}
	}, [tab]);
	useEffect(() => { if (isAdmin) void load(); }, [isAdmin, load]);

	if (!ready) return <div className="empty"><div className="spinner" aria-label="Loading" /></div>;
	if (!isAdmin) return <div className="empty"><h2>Admins only</h2><Link className="btn btn-primary" href="/">Back to chats</Link></div>;

	const resolve = async (id: string, status: 'actioned' | 'dismissed' | 'open') => {
		setBusy(true);
		const { error: e } = await supabase().rpc('admin_resolve_report', { p_report: id, p_status: status });
		setBusy(false);
		if (e) setError(dbMessage(e)); else void load();
	};
	const setStatus = async (userId: string, status: 'active' | 'suspended') => {
		setBusy(true); setError('');
		try { await api(`/api/admin/users/${userId}`, { status }); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
	};

	return (
		<div className="page" style={{ paddingTop: 0 }}>
			<div className="page-head" style={{ paddingLeft: 0, paddingRight: 0 }}><h1>Admin</h1></div>
			<div className="row" role="tablist" style={{ marginBottom: 14 }}>
				{(['open', 'closed'] as const).map(t => (
					<button key={t} role="tab" aria-selected={tab === t} type="button" className={`btn btn-sm ${tab === t ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab(t)}>
						{t === 'open' ? 'Open reports' : 'Reviewed'}
					</button>
				))}
			</div>
			{error && <div className="banner error" role="alert" style={{ marginBottom: 12 }}>{error}</div>}
			{!reports && <div className="empty"><div className="spinner" aria-label="Loading reports" /></div>}
			{reports?.length === 0 && <div className="empty"><h2>Nothing here</h2><p>{tab === 'open' ? 'No open reports.' : 'No reviewed reports yet.'}</p></div>}
			{reports?.map(r => {
				const who = people[r.reported_id];
				const by = r.reporter_id ? people[r.reporter_id] : null;
				return (
					<article key={r.id} className="card stack" style={{ gap: 8 }}>
						<div className="row">
							<Avatar id={r.reported_id} name={who?.display_name} url={who?.avatar_url} size={40} />
							<div className="grow">
								<b>{who?.display_name || 'Deleted account'}</b> <span className="muted small">@{who?.username}</span>
								{who?.status === 'suspended' && <span className="chip" style={{ marginLeft: 6 }}>Suspended</span>}
								<div className="muted small">Reported by {by?.display_name || 'a deleted account'} · {listStamp(r.created_at)}</div>
							</div>
							{r.status !== 'open' && <span className="chip">{r.status}</span>}
						</div>
						<p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{r.reason}</p>
						<div className="row" style={{ flexWrap: 'wrap' }}>
							{who && who.status === 'active' && <button className="btn btn-sm btn-danger" type="button" disabled={busy} onClick={() => void setStatus(who.id, 'suspended')}>Suspend account</button>}
							{who && who.status === 'suspended' && <button className="btn btn-sm btn-outline" type="button" disabled={busy} onClick={() => void setStatus(who.id, 'active')}>Restore account</button>}
							{r.status === 'open'
								? <><button className="btn btn-sm btn-primary" type="button" disabled={busy} onClick={() => void resolve(r.id, 'actioned')}>Mark handled</button>
									<button className="btn btn-sm btn-ghost" type="button" disabled={busy} onClick={() => void resolve(r.id, 'dismissed')}>Dismiss</button></>
								: <button className="btn btn-sm btn-ghost" type="button" disabled={busy} onClick={() => void resolve(r.id, 'open')}>Reopen</button>}
						</div>
					</article>
				);
			})}
			<p className="muted small">Admins see reports only; they can’t read anyone’s chats.</p>
		</div>
	);
}
