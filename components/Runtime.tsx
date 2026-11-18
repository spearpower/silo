'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import CallScreen from './CallScreen';
import { hideToast, useStore } from '@/lib/client/store';

/** Everything that floats above the pages: call screens, the incoming-call banner, toasts, connection state. */
export default function Runtime() {
	return (<><CallScreen /><Toast /><Connection /></>);
}

function Connection() {
	const { connection, ready } = useStore(s => ({ connection: s.connection, ready: s.ready }));
	const [show, setShow] = useState(false);
	useEffect(() => {
		if (connection !== 'offline' || !ready) { setShow(false); return; }
		const t = setTimeout(() => setShow(true), 2500); // ignore short blips
		return () => clearTimeout(t);
	}, [connection, ready]);
	return show ? <div className="conn-pill" role="status">Reconnecting…</div> : null;
}

function Toast() {
	const toast = useStore(s => s.toast);
	if (!toast) return null;
	const body = <><span className="bar" /><span className="ellipsis">{toast.text}</span></>;
	return toast.href
		? <Link className="toast" href={toast.href} onClick={hideToast} role="status">{body}</Link>
		: <div className="toast" role="status">{body}</div>;
}
