'use client';
import { useState } from 'react';
import Sheet from './Sheet';
import { supabase } from '@/lib/supabase/browser';
import { dbMessage } from '@/lib/client/api';

/** Report a person to the Silo admins (optionally from a chat, which is attached for context). */
export default function ReportSheet({ userId, name, conversationId, onClose }: { userId: string; name: string; conversationId?: string; onClose: () => void }) {
	const [reason, setReason] = useState('');
	const [busy, setBusy] = useState(false);
	const [done, setDone] = useState(false);
	const [error, setError] = useState('');
	const submit = async () => {
		setBusy(true); setError('');
		const { error: e } = await supabase().rpc('report_user', { p_user: userId, p_reason: reason, p_conversation: conversationId ?? null, p_message: null });
		setBusy(false);
		if (e) setError(dbMessage(e)); else setDone(true);
	};
	return (
		<Sheet title={done ? 'Thanks for telling us' : `Report ${name}`} onClose={onClose}>
			{done ? (
				<div className="stack">
					<p className="muted">An admin will review it. If you don’t want to hear from {name} again, you can also block them.</p>
					<button className="btn btn-primary btn-block" type="button" onClick={onClose}>Done</button>
				</div>
			) : (
				<form className="stack" onSubmit={e => { e.preventDefault(); void submit(); }}>
					<p className="muted small">Reports go to the Silo admins. {name} isn’t told who reported them.</p>
					<div className="field">
						<label htmlFor="reason">What happened?</label>
						<textarea id="reason" className="textarea" maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} required minLength={3} />
					</div>
					{error && <div className="banner error" role="alert">{error}</div>}
					<div className="row">
						<button className="btn btn-outline grow" type="button" onClick={onClose}>Cancel</button>
						<button className="btn btn-danger grow" type="submit" disabled={busy || reason.trim().length < 3}>{busy ? 'Sending…' : 'Send report'}</button>
					</div>
				</form>
			)}
		</Sheet>
	);
}
