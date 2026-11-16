'use client';
// Table chat: a floating button on the right edge (middle of the screen) that opens a side panel.
// Messages are public to the players at this table. New messages ping through the game feed (chatLast).
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, avatar, haptic } from '@/lib/client';
import { playSound } from '@/lib/sound';

interface Msg { id: number; userId: number; body: string; at: string; pending?: boolean }
interface Person { username: string; photo: string; isBot?: boolean }

const QUICK = ['👍', '😂', '🔥', '😮', '😭', '👑', '🎉', '🙏'];
const MORE = ['😀', '😁', '😅', '🤣', '😊', '😍', '😎', '🤔', '😏', '😬', '🙄', '😴', '😤', '😡', '🥳', '🤯', '🥶', '🤝',
	'👏', '🙌', '💪', '👀', '✌️', '🤞', '👋', '❤️', '💔', '💯', '⭐', '⚡', '🍀', '🎯', '🃏', '🏆', '😈', '🤡'];

const isEmojiOnly = (s: string) => {
	const t = s.replace(/\s/g, '');
	return t.length > 0 && Array.from(t).length <= 6 && /^(\p{Extended_Pictographic}|\p{Emoji_Component}|‍|️)+$/u.test(t);
};
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export default function TableChat({ gameId, me, people, chatLast, onEmoji }: { gameId: number; me: number; people: Record<number, Person>; chatLast: number; onEmoji?: (userId: number, emoji: string) => void }) {
	const [open, setOpen] = useState(false);
	const [msgs, setMsgs] = useState<Msg[]>([]);
	const [text, setText] = useState('');
	const [picker, setPicker] = useState(false);
	const [error, setError] = useState('');
	const [preview, setPreview] = useState<Msg | null>(null);
	const [readId, setReadId] = useState<number | null>(null);
	const lastId = useRef(0);
	const loaded = useRef(false);
	const fetching = useRef(false);
	const listRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const KEY = `picknplay.chatRead.${gameId}`;

	const fetchNew = useCallback(async () => {
		if (fetching.current) return;
		fetching.current = true;
		try {
			const { messages } = await api<{ messages: Msg[] }>(`/api/games/${gameId}/chat?after=${lastId.current}`);
			if (!loaded.current && !messages.length) {
				// empty chat on first load: from now on, every new message counts as unread
				loaded.current = true;
				let stored = 0;
				try { stored = Number(localStorage.getItem(KEY)) || 0; } catch { /* ignore */ }
				setReadId(stored);
				return;
			}
			if (!messages.length) return;
			lastId.current = Math.max(lastId.current, ...messages.map(m => m.id));
			setMsgs(prev => {
				const known = new Set(prev.filter(m => !m.pending).map(m => m.id));
				const fresh = messages.filter(m => !known.has(m.id));
				// drop my pending copies that the server has now confirmed
				const pendingLeft = prev.filter(m => m.pending && !fresh.some(f => f.userId === m.userId && f.body === m.body));
				return [...prev.filter(m => !m.pending), ...fresh, ...pendingLeft].slice(-150);
			});
			if (!loaded.current) {
				loaded.current = true;
				let stored = 0;
				try { stored = Number(localStorage.getItem(KEY)) || 0; } catch { /* ignore */ }
				setReadId(stored || lastId.current); // first visit: everything so far counts as read
				return;
			}
			const incoming = messages.filter(m => m.userId !== me);
			// emoji-only messages also float up from the sender's seat (reactions)
			for (const m of incoming) if (isEmojiOnly(m.body)) onEmoji?.(m.userId, m.body);
			const words = incoming.filter(m => !isEmojiOnly(m.body));
			if (incoming.length) {
				playSound('chat');
				if (!open && words.length) { setPreview(words[words.length - 1]); haptic(15); }
			}
		} catch { /* the feed will try again */ }
		finally { fetching.current = false; }
	}, [gameId, me, open, KEY, onEmoji]);

	// first load, then whenever the table feed says there's a newer message
	useEffect(() => { if (!loaded.current || chatLast > lastId.current) fetchNew(); }, [chatLast, fetchNew]);

	// reading: opening the panel marks everything as read
	useEffect(() => {
		if (!open || !loaded.current) return;
		setReadId(lastId.current);
		try { localStorage.setItem(KEY, String(lastId.current)); } catch { /* ignore */ }
		setPreview(null);
		requestAnimationFrame(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); });
	}, [open, msgs.length, KEY]);

	useEffect(() => { if (!preview) return; const t = setTimeout(() => setPreview(null), 3500); return () => clearTimeout(t); }, [preview]);
	useEffect(() => {
		if (!open) return;
		const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
		window.addEventListener('keydown', esc);
		return () => window.removeEventListener('keydown', esc);
	}, [open]);

	const unread = readId === null ? 0 : msgs.filter(m => !m.pending && m.id > readId && m.userId !== me).length;

	async function send(body: string) {
		const clean = body.trim();
		if (!clean) return;
		setError('');
		const temp: Msg = { id: -Date.now(), userId: me, body: clean, at: new Date().toISOString(), pending: true };
		setMsgs(prev => [...prev, temp]);
		setText(''); setPicker(false); haptic(6);
		if (isEmojiOnly(clean)) onEmoji?.(me, clean);
		requestAnimationFrame(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }));
		try {
			const { message } = await api<{ message: Msg }>(`/api/games/${gameId}/chat`, { text: clean });
			lastId.current = Math.max(lastId.current, message.id);
			setMsgs(prev => prev.map(m => (m.id === temp.id ? message : m)));
			try { localStorage.setItem(KEY, String(message.id)); } catch { /* ignore */ }
			setReadId(r => Math.max(r || 0, message.id));
		} catch (e) {
			setMsgs(prev => prev.filter(m => m.id !== temp.id));
			setError((e as Error).message);
			if (!isEmojiOnly(clean)) setText(clean);
		}
	}

	const nameOf = (uid: number) => (uid === me ? 'You' : people[uid]?.username || 'Player');

	return (
		<>
			{/* Floating launcher, right edge, middle of the screen */}
			<button type="button" className={`chat-fab${unread ? ' has-unread' : ''}`} onClick={() => { setOpen(o => !o); setPreview(null); }}
				aria-label={unread ? `Table chat, ${unread} unread` : 'Table chat'} aria-expanded={open}>
				<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.2 3.6c-.5.4-1.3.1-1.3-.6V16A2.5 2.5 0 0 1 4 13.5v-8Z" /><path d="M8 8.5h8M8 11.5h5" /></svg>
				{unread > 0 && <span className="chat-badge">{unread > 9 ? '9+' : unread}</span>}
			</button>
			{preview && !open && (
				<button type="button" className="chat-preview" onClick={() => { setOpen(true); setPreview(null); }}>
					<img src={avatar(people[preview.userId]?.photo || 'na.png')} alt="" />
					<span><b>{nameOf(preview.userId)}</b> {isEmojiOnly(preview.body) ? <span className="big">{preview.body}</span> : preview.body}</span>
				</button>
			)}

			{open && <div className="chat-backdrop" onClick={() => setOpen(false)} />}
			<aside className={`chat-panel${open ? ' open' : ''}`} role="dialog" aria-modal="false" aria-label="Table chat" aria-hidden={!open}>
				<header className="chat-head">
					<b>Table chat</b>
					<span className="sub">Everyone at this table can see these</span>
					<button type="button" className="chat-close" onClick={() => setOpen(false)} aria-label="Close chat">×</button>
				</header>
				<div className="chat-list" ref={listRef} aria-live="polite">
					{msgs.length === 0 && <p className="chat-empty">Say hi to the table 👋<br />Messages and emojis show for everyone playing.</p>}
					{msgs.map((m, i) => {
						const mine = m.userId === me;
						const firstOfRun = i === 0 || msgs[i - 1].userId !== m.userId;
						const emoji = isEmojiOnly(m.body);
						return (
							<div key={m.id} className={`chat-msg${mine ? ' mine' : ''}${m.pending ? ' pending' : ''}`}>
								{!mine && firstOfRun && <img className="chat-av" src={avatar(people[m.userId]?.photo || 'na.png')} alt="" />}
								<div className={`chat-bubble${emoji ? ' emoji' : ''}${!mine && !firstOfRun ? ' cont' : ''}`}>
									{!mine && firstOfRun && <span className="chat-name">{nameOf(m.userId)}</span>}
									<span className="chat-text">{m.body}</span>
									<span className="chat-time">{m.pending ? 'Sending…' : timeOf(m.at)}</span>
								</div>
							</div>
						);
					})}
				</div>
				<div className="chat-quick" role="group" aria-label="Quick emojis">
					{QUICK.map(e => <button key={e} type="button" onClick={() => send(e)} aria-label={`Send ${e}`}>{e}</button>)}
				</div>
				{picker && (
					<div className="chat-picker" role="group" aria-label="More emojis">
						{MORE.map(e => <button key={e} type="button" onClick={() => { setText(t => (Array.from(t + e).length <= 200 ? t + e : t)); inputRef.current?.focus(); }}>{e}</button>)}
					</div>
				)}
				{error && <div className="chat-error" role="alert">{error}</div>}
				<form className="chat-input" onSubmit={e => { e.preventDefault(); send(text); }}>
					<button type="button" className="chat-emoji-btn" aria-label={picker ? 'Hide emojis' : 'Show emojis'} aria-pressed={picker} onClick={() => setPicker(p => !p)}>😊</button>
					<input ref={inputRef} value={text} onChange={e => setText(e.target.value)} maxLength={200} placeholder="Message the table" enterKeyHint="send" autoComplete="off" />
					<button type="submit" className="chat-send" disabled={!text.trim()} aria-label="Send">
						<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12 20 4l-4 16-4-7-8-1Z" /></svg>
					</button>
				</form>
			</aside>
		</>
	);
}
