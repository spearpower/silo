'use client';
// Account: turn phone alerts on or off for this phone.
import { useEffect, useState } from 'react';
import { disablePush, enablePush, pushState, type PushState } from '@/lib/pushClient';
import { api } from '@/lib/client';

const NOTE: Record<PushState, string> = {
	on: 'This phone buzzes when it’s your turn, a game starts, or a friend invites you.',
	off: 'Get a buzz when it’s your turn, a game starts, or a friend invites you.',
	blocked: 'Alerts are blocked for PicknPlay in this browser’s settings. Allow notifications there, then come back.',
	'ios-install': 'On iPhone, alerts work once PicknPlay is on your Home Screen: tap Share → Add to Home Screen, then open it from there.',
	unsupported: 'This browser can’t show alerts.',
};

export default function AlertsSwitch() {
	const [s, setS] = useState<PushState | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const [tested, setTested] = useState('');
	useEffect(() => { pushState().then(setS).catch(() => setS('unsupported')); }, []);
	if (!s) return null;
	return (
		<>
			<div className="switch-row">
				<label htmlFor="alerts">Turn alerts on this phone</label>
				<span className="switch"><input id="alerts" type="checkbox" role="switch" checked={s === 'on'} disabled={busy || (s !== 'on' && s !== 'off')}
					onChange={async e => { setBusy(true); setError(''); try { setS(e.target.checked ? await enablePush() : await disablePush()); } catch (err) { setError((err as Error).message); } finally { setBusy(false); } }} /><span /></span>
			</div>
			<p className="hint">{NOTE[s]}</p>
			{s === 'on' && (
				<button type="button" className="btn btn-secondary" disabled={busy} onClick={async () => {
					setBusy(true); setError(''); setTested('');
					try { const r = await api<{ sent: number }>('/api/push/test', {}); setTested(`Test alert sent to ${r.sent} ${r.sent === 1 ? 'device' : 'devices'}. It should pop up in a few seconds.`); }
					catch (err) { setError((err as Error).message); } finally { setBusy(false); }
				}}>Send a Test Alert</button>
			)}
			{tested && <div className="ok-banner" role="status">{tested}</div>}
			{error && <div className="error-banner" role="alert">{error}</div>}
		</>
	);
}
