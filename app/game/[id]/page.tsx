'use client';
// The PicknPlay table. The server decides everything (lib/engine.ts); this page shows the player's own view,
// lifts the cards they may play, and animates what the others did (from the view's table events).
import Link from 'next/link';
import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, avatar, CARD_BACK, cardSrc, haptic, useGame, type GameData } from '@/lib/client';
import type { Action, GameView, TableEvent } from '@/lib/engine';
import { cardLabel, cardShort, handPoints, isJoker, rankOf, sortHand, SUIT_NAMES, SUIT_SYMBOLS, SUITS, type Suit } from '@/lib/card-codes';
import { penaltyName, variantInfo } from '@/lib/rules';
import { initSound, playSound, playTurnSound, setSoundOn, soundOn } from '@/lib/sound';
import { Bubbles, Confetti, Crown, type Bubble, type BubbleKind } from '@/components/Celebrate';
import TableChat from '@/components/TableChat';
import TableMenu from '@/components/TableMenu';
import WatchBoard from '@/components/WatchBoard';
import VoiceChat from '@/components/VoiceChat';

const REACTIONS = ['👏', '😂', '😮', '🔥', '👍', '😭'];
const SORT_KEY = 'picknplay.sort';
type Sort = 'suit' | 'rank' | 'dealt';
/** Placeholder for a card being drawn (its face is unknown until the server answers). */
const PENDING = '??';
const suitSym = (c: string) => c.replace(/([SHDC])$/, m => SUIT_SYMBOLS[m as Suit]);

export default function GamePage({ params }: { params: Promise<{ id: string }> }) {
	const id = Number(use(params).id);
	const router = useRouter();
	const { data, error: loadError, accept, serverNow, refresh } = useGame(id);
	const [selected, setSelected] = useState<string | null>(null);
	const [toast, setToast] = useState('');
	const [optimistic, setOptimistic] = useState<GameView | null>(null);
	const queue = useRef<Promise<void>>(Promise.resolve());
	const inflight = useRef(0);
	const [fresh, setFresh] = useState<string[]>([]);
	const prevHand = useRef<string[] | null>(null);
	const [sort, setSortState] = useState<Sort>('suit');
	useEffect(() => { try { const v = localStorage.getItem(SORT_KEY); if (v === 'suit' || v === 'rank' || v === 'dealt') setSortState(v); } catch { /* ignore */ } }, []);
	const setSort = (next: Sort) => { setSortState(next); try { localStorage.setItem(SORT_KEY, next); } catch { /* ignore */ } };
	const [trayOpen, setTrayOpen] = useState(false);
	const [floats, setFloats] = useState<{ key: number; emoji: string; x: number; y: number }[]>([]);
	const floatSeq = useRef(0);
	const [left, setLeft] = useState<number | null>(null);
	const reported = useRef<string | null>(null);
	const wasMyTurn = useRef(false);
	const [sound, setSound] = useState(true);
	useEffect(() => { initSound(); setSound(soundOn()); try { localStorage.setItem('picknplay.playedOnce', '1'); } catch { /* ignore */ } }, []);
	const [bubbles, setBubbles] = useState<Bubble[]>([]);
	const [menuOpen, setMenuOpen] = useState(false);
	const [peek, setPeek] = useState<null | { x: number; y: number; w: number; h: number; cards: string[] }>(null);
	const [choose, setChoose] = useState<null | { card: string; kind: 'ace' | 'cut' }>(null);
	const [voiceOn, setVoiceOn] = useState(false);
	useEffect(() => { api<{ voiceChat: boolean }>('/api/settings').then(s => setVoiceOn(!!s.voiceChat)).catch(() => {}); }, []);
	const [party, setParty] = useState<null | 'win' | 'cut'>(null);
	const bubbleSeq = useRef(0);
	const seenSeq = useRef<number | null>(null);
	const prevCounts = useRef<Record<number, number>>({});
	const bubble = useCallback((text: string, kind: BubbleKind, ms = 2600) => {
		const bid = ++bubbleSeq.current;
		setBubbles(b => [...b.slice(-2), { id: bid, text, kind }]);
		setTimeout(() => setBubbles(b => b.filter(x => x.id !== bid)), ms);
	}, []);

	// What we show: the server's view, or our prediction while moves are on their way
	const view = optimistic ?? data?.view ?? null;
	const viewRef = useRef<GameView | null>(null);
	viewRef.current = view;
	const me = data?.me ?? 0;
	const names = useMemo(() => Object.fromEntries((data?.players || []).map(p => [p.id, p])), [data?.players]);
	const nameOf = useCallback((pid: number) => (pid === me ? 'You' : names[pid]?.username || 'Player'), [names, me]);

	useEffect(() => { if (data?.status === 'lobby') router.replace(`/lobby/${id}`); }, [data?.status, id, router]);

	// briefly highlight cards that just arrived (drawn)
	useEffect(() => {
		const h = view?.hand;
		if (!h) return;
		if (prevHand.current) {
			const added = h.filter(c => !prevHand.current!.includes(c) && c !== PENDING);
			if (added.length) { setFresh(added); const t = setTimeout(() => setFresh([]), 700); prevHand.current = h; return () => clearTimeout(t); }
		}
		prevHand.current = h;
	}, [view?.hand]);

	// ----- table events (same list on every phone): animate and announce what happened -----
	const serverView = data?.view ?? null;
	useEffect(() => {
		const v = serverView;
		if (!v) return;
		if (seenSeq.current === null) { // first load: don't replay old events (a fresh deal gets the dealing sound)
			seenSeq.current = v.seq;
			prevCounts.current = Object.fromEntries(v.players.map(p => [p.id, p.handCount]));
			if (v.moves === 0 && !v.finished) playSound('deal');
			return;
		}
		const fresh = v.events.filter(e => e.n > seenSeq.current!);
		seenSeq.current = v.seq;
		const who = (pid: number) => (pid === me ? 'You' : names[pid]?.username || 'Someone');
		let delay = 0;
		for (const e of fresh as TableEvent[]) {
			const at = delay;
			switch (e.t) {
				case 'play':
					if (e.by !== me) {
						setTimeout(() => { fly(`[data-seat="${e.by}"]`, '[data-drop="discard"]', cardSrc(e.card), 460); playSound('play'); }, at);
						delay += 380;
					}
					if (e.suit && e.by !== me) setTimeout(() => { bubble(`${who(e.by)} called ${SUIT_SYMBOLS[e.suit!]} ${SUIT_NAMES[e.suit!]}`, 'info', 2600); playSound('suit'); }, at + 300);
					if (e.cut) setTimeout(() => { bubble(`✂️ ${who(e.by)} cut with ${suitSym(e.card)}!`, 'round', 3600); playSound('cut'); haptic([40, 30, 80]); }, at + 200);
					break;
				case 'draw':
					if (e.by !== me) {
						for (let k = 0; k < Math.min(e.count, 5); k++) setTimeout(() => { fly('[data-drop="deck"]', `[data-seat="${e.by}"]`, CARD_BACK, 420); playSound('draw'); }, at + k * 140);
						delay += 200 + Math.min(e.count, 5) * 140;
					}
					if (e.penalty) setTimeout(() => bubble(`${who(e.by)} ${e.by === me ? 'draw' : 'drew'} ${e.count} cards`, 'skip', 2400), at);
					break;
				case 'penalty':
					setTimeout(() => {
						bubble(e.target === me ? `Draw ${e.amount}! ${penaltyName(e.kind)} played on you` : `Draw ${e.amount} → ${who(e.target)}`, 'skip', 2800);
						playSound(e.target === me ? 'hit' : 'penalty');
						if (e.target === me) haptic([60, 40, 60]);
					}, at + 150);
					break;
				case 'cancel': setTimeout(() => { bubble(`🛡️ ${who(e.by)} cancelled the draw ${e.amount}`, 'phase', 2800); playSound('cancel'); }, at + 150); break;
				case 'skip': setTimeout(() => { bubble(e.target === me ? `${who(e.by)} skipped you` : `${who(e.target)} is skipped`, 'skip', 2400); playSound('skip'); }, at + 150); break;
				case 'reverse': setTimeout(() => { bubble('🔄 Direction reversed', 'info', 2200); playSound('reverse'); }, at + 150); break;
				case 'again': if (e.by !== me) setTimeout(() => bubble(`${who(e.by)} plays again`, 'info', 2000), at + 150); break;
				case 'reshuffle': setTimeout(() => { bubble('Discard pile reshuffled into a new draw pile', 'info', 2600); playSound('shuffle'); }, at); break;
				case 'timeout': setTimeout(() => bubble(`${who(e.by)} ran out of time`, 'info', 2200), at); break;
				case 'left': setTimeout(() => { bubble(`${who(e.by)} left the table`, 'skip', 3000); playSound('skip'); }, at); break;
			}
		}
		// someone is down to their last card
		if (!v.finished) for (const p of v.players) {
			const before = prevCounts.current[p.id];
			if (p.id !== me && p.handCount === 1 && before !== undefined && before > 1) {
				setTimeout(() => { bubble(`☝️ ${who(p.id)} has one card left!`, 'skip', 2600); playSound('lastcard'); }, delay + 250);
			}
		}
		prevCounts.current = Object.fromEntries(v.players.map(p => [p.id, p.handCount]));
		if (v.finished && fresh.length) {
			const f = v.finished;
			const winners = f.standings.filter(s => s.rank === 1).map(s => s.id);
			const iWon = winners.includes(me);
			setTimeout(() => {
				bubble(iWon ? 'You win!' : `${winners.map(who).join(' & ')} ${winners.length > 1 ? 'win' : 'wins'}!`, 'win', 5000);
				playSound(iWon ? 'win' : 'lose'); haptic(iWon ? [60, 40, 60, 40, 120] : 60); setParty(iWon ? 'win' : 'cut');
			}, delay + (f.how === 'cut' ? 900 : 200));
		}
	}, [serverView, me, names, bubble]);

	useEffect(() => { if (!party) return; const t = setTimeout(() => setParty(null), 4200); return () => clearTimeout(t); }, [party]);

	/** Float an emoji up from someone's seat. */
	const floatEmoji = useCallback((uid: number, emoji: string) => {
		const el = document.querySelector(`[data-seat="${uid}"]`);
		if (!el) return;
		const r = el.getBoundingClientRect();
		const key = ++floatSeq.current;
		setFloats(f => [...f.slice(-7), { key, emoji, x: r.left + r.width / 2 + (Math.random() * 40 - 20), y: r.top + Math.min(r.height / 2, 40) }]);
		setTimeout(() => setFloats(f => f.filter(x => x.key !== key)), 1900);
	}, []);

	useEffect(() => { if (selected && view && !view.playable.includes(selected)) setSelected(null); }, [view, selected]);

	const myTurn = !!view && view.turn === me && !view.finished;

	// Away from the tab: show it in the title, and (if alerts are allowed) a notification on this device
	useEffect(() => {
		const base = `Game ${id} · PicknPlay`;
		const apply = () => { document.title = myTurn && document.visibilityState === 'hidden' ? `🔔 Your turn · ${base}` : base; };
		apply();
		if (myTurn && document.visibilityState === 'hidden' && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
			const pen = viewRef.current?.penalty;
			navigator.serviceWorker?.getRegistration().then(reg => reg?.showNotification(pen ? `Draw ${pen.amount}! Your turn` : 'Your turn', {
				body: pen ? `Answer the penalty or draw in game ${id}.` : `It’s your turn in game ${id}.`,
				icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', tag: `turn-${id}`, data: { url: `/game/${id}` },
			})).catch(() => {});
		}
		document.addEventListener('visibilitychange', apply);
		return () => { document.removeEventListener('visibilitychange', apply); document.title = 'PicknPlay'; };
	}, [myTurn, id]);
	useEffect(() => {
		if (myTurn && !wasMyTurn.current) { haptic([90, 60, 90]); playTurnSound(); if (seenSeq.current !== null) bubble('Your turn!', 'turn', 1600); }
		wasMyTurn.current = myTurn;
	}, [myTurn, bubble]);

	// turn timer (server clock), and report a timeout once when it hits zero
	useEffect(() => {
		if (!data?.deadline || data.status !== 'playing' || !data.isMember) { setLeft(null); return; }
		const tick = () => {
			const s = Math.max(0, Math.ceil((new Date(data.deadline!).getTime() - serverNow()) / 1000));
			setLeft(prev => { if (s !== prev && s > 0 && s <= 5 && viewRef.current?.turn === data.me) playSound('tick'); return s; });
			if (s === 0 && reported.current !== data.deadline) {
				reported.current = data.deadline;
				api<GameData>(`/api/games/${id}/move`, { type: 'timeout' }).then(accept).catch(() => refresh());
			}
		};
		tick();
		const t = setInterval(tick, 250);
		return () => clearInterval(t);
	}, [data?.deadline, data?.status, data?.isMember, id, accept, refresh, serverNow]);

	const say = (msg: string) => { setToast(msg); haptic(8); setTimeout(() => setToast(t => (t === msg ? '' : t)), 2800); };
	const react = (emoji: string) => {
		setTrayOpen(false); haptic(8); floatEmoji(me, emoji);
		api(`/api/games/${id}/chat`, { text: emoji }).catch(e => say((e as Error).message));
	};

	/** Show the predicted result now, send the move in order, and reconcile with the server's answer. */
	const send = useCallback((action: Action) => {
		const cur = viewRef.current;
		const predicted = cur ? predict(cur, me, action) : null;
		if (action.type === 'play') playSound(action.cut ? 'cut' : 'play');
		else if (action.type === 'draw') playSound('draw');
		if (predicted) setOptimistic(predicted);
		setSelected(null);
		inflight.current++;
		queue.current = queue.current.then(async () => {
			try {
				const d = await api<GameData>(`/api/games/${id}/move`, action);
				accept(d);
			} catch (e) {
				inflight.current = 1;
				say((e as Error).message);
				await refresh();
			} finally {
				inflight.current = Math.max(0, inflight.current - 1);
				if (inflight.current === 0) setOptimistic(null);
			}
		});
	}, [id, me, accept, refresh]);

	if (data?.myLeft) {
		const byMe = data.myLeft.by === data.me;
		const away = data.myLeft.by === null;
		return (
			<div className="app centered"><main className="center">
				<div className="brand"><img src="/icons/icon-192.png" alt="" /><h1 className="large-title">{byMe ? 'You left this game' : away ? 'You were taken out' : 'You were removed'}</h1></div>
				<p className="subtitle">{byMe ? `Reason: ${data.myLeft.reason || 'none given'}`
					: away ? `Your turn ran out of time 3 times in a row, so game ${data.id} carried on without you.`
					: `${data.myLeft.byName || 'The host'} removed you from game ${data.id}. Reason: ${data.myLeft.reason || 'none given'}`}</p>
				<Link className="btn btn-primary" href="/">Back to Play</Link>
			</main></div>
		);
	}
	if (data && !view && data.watch) return <WatchBoard data={data} onChanged={refresh} />;
	if (!data || !view || !view.players.some(p => p.id === me)) {
		return (
			<div className="board" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16 }}>
				<div className="thint">{loadError || 'Shuffling and dealing…'}</div>
				{loadError && <Link className="icon-btn gold" href="/continue">Back</Link>}
			</div>
		);
	}

	const top = view.discard[0];
	const others = rotate(view.order, me, view.direction).filter(x => x !== me).map(x => view.players.find(p => p.id === x)!);
	const rc = others.length <= 2 ? Math.max(1, others.length) : others.length <= 4 ? 2 : 3;
	const hand = sort === 'dealt' ? view.hand : [...sortHand(view.hand.filter(c => c !== PENDING), sort), ...view.hand.filter(c => c === PENDING)];
	const realHand = view.hand.filter(c => c !== PENDING);
	const myPoints = handPoints(realHand, view.variant, view.rules.jokerPoints);
	const pen = view.penalty;
	const canDraw = myTurn && view.step === 'play';
	const nextUp = view.turn !== null ? nextOf(view.order, view.turn, view.direction) : null;

	// ----- hint text -----
	let hint = '', hintKind = 'wait';
	if (view.finished) hint = 'Game over';
	else if (data.status === 'ended') hint = 'Game ended';
	else if (myTurn && pen) {
		hintKind = 'skip';
		hint = view.playable.length ? `Draw ${pen.amount}, or pass it on or cancel it` : `Draw ${pen.amount}: tap the draw pile`;
	} else if (myTurn && view.step === 'drawn') { hintKind = 'me'; hint = 'It fits! Play it, or keep it'; }
	else if (myTurn) { hintKind = 'me'; hint = view.playable.length ? (selected ? 'Tap again (or the pile) to play' : 'Your turn · tap a lifted card') : 'No card fits · tap the draw pile'; }
	else if (view.turn) hint = names[view.turn]?.isBot ? `${nameOf(view.turn)} is thinking…` : `${nameOf(view.turn)}’s turn`;

	// ----- actions -----
	const playCard = (card: string) => {
		if (rankOf(card) === 'A') { setChoose({ card, kind: 'ace' }); return; }
		if (card === view.cutSeven) { setChoose({ card, kind: 'cut' }); return; }
		fly(`[data-card="${card}"]`, '[data-drop="discard"]', cardSrc(card));
		send({ type: 'play', card });
	};
	const tapCard = (card: string) => {
		if (view.finished || data.status !== 'playing') return;
		if (!myTurn) { setSelected(s => (s === card ? null : card)); return say('Wait for your turn'); }
		if (!view.playable.includes(card)) {
			playSound('error');
			if (view.step === 'drawn') return say('You can only play the card you just drew, or keep it');
			if (pen) return say(pen.kind === '2' ? `Only a 2 or an Ace can answer this. Or draw ${pen.amount}.` : `Only a ${penaltyName(pen.kind)} or the A♠ can answer this. Or draw ${pen.amount}.`);
			if (rankOf(card) === 'A') return say('An Ace can’t go on a 2');
			return say(`That one doesn’t fit. Play ${SUIT_SYMBOLS[view.suit]} ${SUIT_NAMES[view.suit]} or a ${top ? (isJoker(top) ? 'Joker' : rankOf(top)) : ''}`);
		}
		haptic(6);
		if (selected === card) playCard(card);
		else setSelected(card);
	};
	const tapDeck = () => {
		if (!myTurn) return say('Wait for your turn');
		if (!canDraw) return say('You’ve already drawn. Play that card or keep it.');
		fly('[data-drop="deck"]', '.hand', CARD_BACK);
		send({ type: 'draw' });
	};
	const openPeek = () => {
		const el = document.querySelector('[data-drop="discard"]');
		if (!el || !view.discard.length) return;
		const r = el.getBoundingClientRect();
		haptic(10);
		setPeek({ x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, cards: [...view.discard].reverse() });
	};
	const tapDiscard = () => { if (myTurn && selected) playCard(selected); else openPeek(); };
	const lastLog = (view.log[0] || '').replace(/\{(\d+)\}/g, (_, x) => nameOf(Number(x)));

	return (
		<div className={`board pnp${myTurn ? ' myturn' : ''}`}>
			{/* Other players, in the order play goes round */}
			<section className={`rivals${others.length >= 4 ? ' compact' : ''}`} style={{ ['--rc' as string]: rc }} aria-label="Other players">
				{others.map(r => (
					<div key={r.id} data-seat={r.id} className={`rival${view.turn === r.id ? ' turn' : ''}${view.finished?.standings.find(s => s.id === r.id)?.rank === 1 ? ' won' : ''}`}>
						{view.turn === r.id && !view.finished && <span className="ribbon">{names[r.id]?.isBot ? 'Thinking…' : 'Playing'}</span>}
						{!view.finished && nextUp === r.id && view.turn !== r.id && <span className="ribbon next">Next</span>}
						{view.finished?.standings.find(s => s.id === r.id)?.rank === 1 && <span className="badge crown-badge"><Crown size={22} title="Winner" /></span>}
						<div className="top">
							<img className="av" src={avatar(names[r.id]?.photo || 'na.png')} alt="" />
							<div className="who">
								<span className="nm">{nameOf(r.id)}{names[r.id]?.isBot && <> <span className="vf-badge">Virtual</span></>}{names[r.id] && !names[r.id].online && !names[r.id].isBot && <> <span className="off-badge">offline</span></>}</span>
								<span className="st">{r.handCount} {r.handCount === 1 ? 'card' : 'cards'}{view.turn === r.id && !names[r.id]?.isBot && left !== null ? ` · ${left}s` : ''}</span>
							</div>
						</div>
						<div className="fan" aria-hidden="true">{Array.from({ length: Math.min(r.handCount, 9) }, (_, k) => <img key={k} src={CARD_BACK} alt="" />)}</div>
						{r.handCount <= 2 && !view.finished && <span className="last-cards">{r.handCount === 1 ? 'Last card!' : '2 cards left'}</span>}
					</div>
				))}
			</section>

			{/* The table: draw pile with the cutter under it, discard pile, what to follow */}
			<section className="table-center">
				<div className="hintrow">
					<div className={`thint ${hintKind}`} role="status" aria-live="polite">{hint}</div>
					{left !== null && view.turn === me && <div className={`timer${left <= 8 ? ' low' : ''}`} aria-label={`${left} seconds left`}>{left}</div>}
				</div>
				<div className="piles">
					<div className="pilewrap">
						<button type="button" data-drop="deck" className={`pile deck${canDraw ? ' go' : ''}${pen && myTurn ? ' danger' : ''}`} onClick={tapDeck}
							aria-label={`Draw pile, ${view.deckCount} cards${pen && myTurn ? `. Tap to draw ${pen.amount}` : ''}`}>
							{view.cutterInDeck && <img className="cutter-under" src={cardSrc(view.cutter)} alt="" />}
							{view.deckCount > 0 ? <img src={CARD_BACK} alt="" /> : <span className="empty-msg">Empty</span>}
							<span className="count">{view.deckCount}</span>
						</button>
						<span className="pile-label">{pen && myTurn ? `Draw ${pen.amount}` : 'Draw'}</span>
					</div>
					<div className="pilewrap">
						<button type="button" data-drop="discard" className={`pile${!top ? ' empty' : ''}${myTurn && selected ? ' drop' : ''}`} onClick={tapDiscard}
							aria-label={top ? `Discard pile, top card ${cardLabel(top)}${myTurn && selected ? `. Tap to play ${cardLabel(selected)}` : ''}` : 'Discard pile, empty'}>
							{view.discard[2] && <img className="under u2" src={cardSrc(view.discard[2])} alt="" />}
							{view.discard[1] && <img className="under u1" src={cardSrc(view.discard[1])} alt="" />}
							{top && <img key={top} className="drop-in" src={cardSrc(top)} alt="" />}
						</button>
						<span className="pile-label">Discard</span>
					</div>
				</div>
				<div className="table-chips">
					<span className={`chip suit s-${view.suit}`} title="Suit to follow">Follow <b>{SUIT_SYMBOLS[view.suit]}</b> {SUIT_NAMES[view.suit]}</span>
					<span className="chip cutter" title={`Cutter card: ${cardLabel(view.cutter)}${view.cutterInDeck ? '' : ' (drawn)'}`}>✂️ <b>{suitSym(view.cutSeven)}</b> cuts{view.cutBelow !== null ? ` · under ${view.cutBelow}` : ''}</span>
					<span className="chip dir" title="Direction of play">{view.direction === 1 ? '↻' : '↺'} {view.direction === 1 ? 'Clockwise' : 'Reversed'}</span>
					{pen && <span className="chip pen">Draw {pen.amount} · {penaltyName(pen.kind)}{pen.kind === '2' ? ' (any Ace stops it)' : ' (A♠ stops it)'}</span>}
				</div>
				{lastLog && <div className="footnote" style={{ margin: 0 }}>{lastLog}</div>}
			</section>

			{/* Buttons for the moment */}
			<div className="actions">
				{myTurn && view.step === 'drawn' && view.drawn && (
					<>
						<button type="button" className="icon-btn gold" onClick={() => playCard(view.drawn!)}>Play {cardShort(view.drawn)}</button>
						<button type="button" className="icon-btn" onClick={() => send({ type: 'pass' })}>Keep it</button>
					</>
				)}
				{myTurn && view.step === 'play' && selected && (
					<button type="button" className="icon-btn gold" onClick={() => playCard(selected)}>Play {cardShort(selected)}</button>
				)}
				{myTurn && pen && view.step === 'play' && <button type="button" className="icon-btn danger" onClick={tapDeck}>Draw {pen.amount}</button>}
				<button type="button" className="icon-btn" onClick={() => setSort(sort === 'suit' ? 'rank' : sort === 'rank' ? 'dealt' : 'suit')} aria-label={`Sort hand, now by ${sort}`}>
					⇅ {sort === 'suit' ? 'Suit' : sort === 'rank' ? 'Rank' : 'Dealt'}
				</button>
			</div>

			{/* My hand */}
			<section className="hand" data-seat={me} style={{ ['--n' as string]: hand.length }} aria-label={`Your hand, ${realHand.length} cards, ${myPoints} points`}>
				{hand.map(c => c === PENDING ? (
					<span key={c} className="card pending" aria-label="Drawing a card…"><img src={CARD_BACK} alt="" /></span>
				) : (
					<button key={c} type="button" data-card={c}
						className={`card${view.playable.includes(c) ? ' ok' : myTurn ? ' dim' : ''}${selected === c ? ' sel' : ''}${fresh.includes(c) ? ' arrive' : ''}${c === view.cutSeven ? ' cut7' : ''}`}
						aria-pressed={selected === c} aria-label={`${cardLabel(c)}${view.playable.includes(c) ? ', can be played' : ''}${c === view.cutSeven ? ', the cut seven' : ''}`}
						onClick={() => tapCard(c)}>
						<img src={cardSrc(c)} alt="" />
					</button>
				))}
			</section>

			<footer className="gbar">
				<Link href="/" aria-label="Leave the table. Your game is saved; rejoin from Continue.">
					<svg viewBox="0 0 12 20" aria-hidden="true"><path d="M10 2 2 10l8 8" /></svg>Menu
				</Link>
				<span className="me-info"><b>{names[me]?.username}</b> · {variantInfo(view.variant).short} · {realHand.length} cards</span>
				<span title="Points in your hand (lowest wins a cut)">{myPoints} pts</span>
				{data.status === 'playing' && <button type="button" onClick={() => setTrayOpen(o => !o)} aria-label="Send a reaction" aria-expanded={trayOpen} style={{ fontSize: 19, padding: '0 6px' }}>😊</button>}
				{data.status === 'playing' && <button type="button" onClick={() => setMenuOpen(true)} aria-label="Table options: rules, leave, remove a player, end game" style={{ fontSize: 22, letterSpacing: 1 }}>⋯</button>}
				<button type="button" aria-pressed={sound} aria-label={sound ? 'Sounds on. Tap to mute.' : 'Sounds off. Tap to unmute.'}
					onClick={() => { const on = !sound; setSound(on); setSoundOn(on); }}>
					<svg viewBox="0 0 24 24" aria-hidden="true" style={{ width: 20, height: 20, strokeWidth: 2 }}>
						<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
						{!sound && <path d="M3 3l18 18" />}
					</svg>
				</button>
			</footer>

			<VoiceChat gameId={id} enabled={voiceOn && data.status === 'playing'} />
			<TableChat gameId={id} me={me} people={names} chatLast={data.chatLast || 0} onEmoji={floatEmoji} />
			{trayOpen && (
				<>
					<div className="tray-backdrop" onClick={() => setTrayOpen(false)} />
					<div className="react-tray" role="group" aria-label="Reactions">
						{REACTIONS.map(e => <button key={e} type="button" onClick={() => react(e)} aria-label={`Send ${e}`}>{e}</button>)}
					</div>
				</>
			)}
			{choose?.kind === 'ace' && (
				<SuitSheet card={choose.card} cancelling={!!pen} onClose={() => setChoose(null)} onPick={suit => {
					setChoose(null);
					fly(`[data-card="${choose.card}"]`, '[data-drop="discard"]', cardSrc(choose.card));
					send({ type: 'play', card: choose.card, suit });
				}} />
			)}
			{choose?.kind === 'cut' && (
				<CutSheet card={choose.card} after={myPoints - handPoints([choose.card], view.variant, view.rules.jokerPoints)} below={view.cutBelow}
					others={others.map(o => ({ name: nameOf(o.id), cards: o.handCount }))}
					onClose={() => setChoose(null)} onPick={cut => {
						setChoose(null);
						fly(`[data-card="${choose.card}"]`, '[data-drop="discard"]', cardSrc(choose.card));
						send({ type: 'play', card: choose.card, ...(cut ? { cut: true } : {}) });
					}} />
			)}
			{peek && <DiscardSpread peek={peek} onClose={() => setPeek(null)} />}
			{floats.map(f => <span key={f.key} className="float-emoji" style={{ left: f.x, top: f.y }} aria-hidden="true">{f.emoji}</span>)}
			<Bubbles items={bubbles} allTop={!!view.finished} />
			{party && <Confetti big={party === 'win'} />}
			{toast && <div className="toast" role="alert">{toast}</div>}
			{view.finished && <FinishedSheet data={data} view={view} nameOf={nameOf} />}
			{data.status === 'ended' && !view.finished && <EndedSheet data={data} nameOf={nameOf} />}
			{menuOpen && (
				<TableMenu variant={data.variant} gameId={id} me={me} canManage={!!data.canManage} players={data.players.filter(p => view.order.includes(p.id))} inGame
					onClose={() => setMenuOpen(false)}
					onDone={what => { setMenuOpen(false); if (what === 'left') router.replace('/'); else refresh(); }} />
			)}
		</div>
	);
}

function SuitSheet({ card, cancelling, onPick, onClose }: { card: string; cancelling: boolean; onPick: (s: Suit) => void; onClose: () => void }) {
	return (
		<div className="sheet-backdrop" onClick={onClose}>
			<div className="sheet" role="dialog" aria-modal="true" aria-label="Name a suit" onClick={e => e.stopPropagation()}>
				<div className="grabber" />
				<h2>{cardShort(card)}: name the suit</h2>
				<p className="subtitle center">{cancelling ? 'Your Ace cancels the draw penalty. ' : ''}The next player must follow the suit you name.</p>
				<div className="suit-grid">
					{SUITS.map(s => (
						<button key={s} type="button" className={`suit-btn s-${s}`} onClick={() => onPick(s)} aria-label={SUIT_NAMES[s]}>
							<span className="sym">{SUIT_SYMBOLS[s]}</span><span>{SUIT_NAMES[s]}</span>
						</button>
					))}
				</div>
				<button type="button" className="btn btn-plain" onClick={onClose}>Cancel</button>
			</div>
		</div>
	);
}

function CutSheet({ card, after, below, others, onPick, onClose }: {
	card: string; after: number; below: number | null; others: { name: string; cards: number }[];
	onPick: (cut: boolean) => void; onClose: () => void;
}) {
	const allowed = below === null || after < below;
	return (
		<div className="sheet-backdrop" onClick={onClose}>
			<div className="sheet" role="dialog" aria-modal="true" aria-label="Cut or play" onClick={e => e.stopPropagation()}>
				<div className="grabber" />
				<h2>✂️ Cut with {suitSym(card)}?</h2>
				<p className="subtitle center">Cutting ends the game now. Everyone counts their hand and the <b>lowest total wins</b>.
					After this card your hand is worth <b>{after}</b> points{below !== null ? <> (you need under <b>{below}</b> to cut)</> : ''}.</p>
				<p className="footnote center">{others.map(o => `${o.name}: ${o.cards} ${o.cards === 1 ? 'card' : 'cards'}`).join(' · ')}</p>
				<div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
					<button type="button" className="btn btn-primary" disabled={!allowed} onClick={() => onPick(true)}>{allowed ? 'Cut!' : `Can’t cut with ${after} points`}</button>
					<button type="button" className="btn btn-secondary" onClick={() => onPick(false)}>Just play it</button>
					<button type="button" className="btn btn-plain" onClick={onClose}>Cancel</button>
				</div>
			</div>
		</div>
	);
}

function FinishedSheet({ data, view, nameOf }: { data: GameData; view: GameView; nameOf: (id: number) => string }) {
	const router = useRouter();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const f = view.finished!;
	const st = f.standings;
	const winners = st.filter(s => s.rank === 1);
	const isHost = data.me === data.hostId;
	const myAward = st.find(s => s.id === data.me)?.award ?? 0;
	const how = f.how === 'out' ? `${nameOf(f.by!)} played their last card.`
		: f.how === 'cut' ? `${nameOf(f.by!)} cut with ${suitSym(view.cutSeven)}. Lowest hand wins.`
		: f.how === 'count' ? 'The draw pile ran out. Lowest hand wins.'
		: 'Nobody could move. Lowest hand wins.';
	return (
		<div className="sheet-backdrop">
			<div className="sheet results" role="dialog" aria-modal="true" aria-label="Results">
				<div className="grabber" />
				<div className="winner-crown"><Crown size={56} title="Winner" /></div>
				<h2>{winners.some(w => w.id === data.me) ? (winners.length > 1 ? 'You share the win!' : 'You win!') : `${winners.map(w => nameOf(w.id)).join(' & ')} ${winners.length > 1 ? 'win' : 'wins'}!`}</h2>
				<p className="subtitle center">{how}<br />{data.practice
					? 'This was a practice game with Virtual Friends, so no leaderboard points.'
					: <>You earned <b style={{ color: 'var(--gold)' }}>{myAward}</b> {myAward === 1 ? 'point' : 'points'} for the monthly leaderboard.</>}</p>
				<div className="list">
					{st.map(s => (
						<div key={s.id} className={`list-row${s.id === data.me ? ' me' : ''}`}>
							<span className="rank">{s.rank}</span>
							<span className="main">
								<span className="title">{nameOf(s.id)}{s.rank === 1 && <> <Crown size={16} /></>}{f.by === s.id && f.how === 'cut' && ' ✂️'}</span>
								<span className="res-cards">{s.cards.length ? s.cards.map(c => <img key={c} className="mini" src={cardSrc(c)} alt={cardLabel(c)} />) : <span className="sub">No cards left</span>}</span>
							</span>
							<span className="meta"><b>{s.points}</b> pts{!data.practice && <><br /><span style={{ color: 'var(--gold)' }}>+{s.award}</span></>}</span>
						</div>
					))}
				</div>
				<div style={{ marginTop: 16 }}>
					{isHost ? (
						<button className="btn btn-primary" type="button" disabled={busy} onClick={async () => {
							setBusy(true);
							try { const { id } = await api<{ id: number }>(`/api/games/${data.id}/again`, {}); router.push(`/lobby/${id}`); }
							catch (e) { setError((e as Error).message); setBusy(false); }
						}}>Play Again</button>
					) : data.nextGameId ? (
						<Link className="btn btn-primary" href={`/lobby/${data.nextGameId}`}>Join the Next Game</Link>
					) : (
						<p className="footnote center">Waiting for the host to start another game…</p>
					)}
					<Link className="btn btn-plain" href="/">Back to Play</Link>
					{error && <div className="error-banner">{error}</div>}
				</div>
			</div>
		</div>
	);
}

function EndedSheet({ data, nameOf }: { data: GameData; nameOf: (id: number) => string }) {
	const router = useRouter();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const by = data.ended?.by;
	return (
		<div className="sheet-backdrop">
			<div className="sheet" role="dialog" aria-modal="true" aria-label="Game ended">
				<div className="grabber" />
				<h2>Game ended</h2>
				<p className="subtitle center">{by ? `${by === data.me ? 'You' : data.ended?.byName || nameOf(by)} ended the game.` : 'The game ended.'} Reason: <b>{data.ended?.reason || 'none given'}</b><br />No leaderboard points were given.</p>
				<div style={{ marginTop: 16 }}>
					{data.me === data.hostId && (
						<button className="btn btn-primary" type="button" disabled={busy} onClick={async () => {
							setBusy(true);
							try { const { id } = await api<{ id: number }>(`/api/games/${data.id}/again`, {}); router.push(`/lobby/${id}`); }
							catch (e) { setError((e as Error).message); setBusy(false); }
						}}>Play Again</button>
					)}
					{data.me !== data.hostId && data.nextGameId && <Link className="btn btn-primary" href={`/lobby/${data.nextGameId}`}>Join the Next Game</Link>}
					<Link className="btn btn-plain" href="/">Back to Play</Link>
					{error && <div className="error-banner">{error}</div>}
				</div>
			</div>
		</div>
	);
}

/** The discard pile fanned out: newest on the right, back to a stack after 2 seconds (or a tap). */
function DiscardSpread({ peek, onClose }: { peek: { x: number; y: number; w: number; h: number; cards: string[] }; onClose: () => void }) {
	const [open, setOpen] = useState(false);
	const closeRef = useRef(onClose);
	closeRef.current = onClose;
	useEffect(() => {
		const a = requestAnimationFrame(() => setOpen(true));
		const t1 = setTimeout(() => setOpen(false), 2000);
		const t2 = setTimeout(() => closeRef.current(), 2350);
		return () => { cancelAnimationFrame(a); clearTimeout(t1); clearTimeout(t2); };
	}, []);
	const n = peek.cards.length;
	const w = Math.min(peek.w, 74), h = w / 0.667;
	const vw = typeof window === 'undefined' ? 390 : window.innerWidth;
	const step = Math.min(w * 0.62, (vw - 32 - w) / Math.max(1, n - 1));
	const span = step * (n - 1);
	const left = Math.max(16, Math.min(vw - 16 - span - w, peek.x - span / 2 - w / 2));
	return (
		<div className="peek-backdrop" onClick={onClose} role="dialog" aria-label="Discard pile, newest on the right">
			<div className="sr-only" aria-live="polite">Discard pile, oldest to newest: {peek.cards.map(cardLabel).join(', ')}</div>
			{peek.cards.map((c, i) => {
				const fanX = left + i * step - (peek.x - w / 2);
				const rot = (i - (n - 1) / 2) * 3;
				return (
					<img key={c + i} className={`peek-card${i === n - 1 ? ' newest' : ''}`} src={cardSrc(c)} alt=""
						style={{ left: peek.x - w / 2, top: peek.y - h / 2, width: w, height: h, zIndex: 90 + i,
							transform: open ? `translate(${fanX}px, -8px) rotate(${rot}deg)` : 'translate(0,0) rotate(0deg)' }} />
				);
			})}
			<div className="peek-caption" style={{ top: peek.y + h / 2 + 10, opacity: open ? 1 : 0 }}>Last {n} {n === 1 ? 'card' : 'cards'} · newest on the right</div>
		</div>
	);
}

/** Seats starting with me, in the direction play goes. */
function rotate(order: number[], me: number, direction: 1 | -1) {
	const i = order.indexOf(me);
	if (i < 0) return order;
	const n = order.length;
	return Array.from({ length: n }, (_, k) => order[(((i + k * direction) % n) + n) % n]);
}
const nextOf = (order: number[], id: number, direction: 1 | -1) => {
	const n = order.length, i = order.indexOf(id);
	return order[(((i + direction) % n) + n) % n];
};

/** Predict the visible result of my move, so the card moves at once. The server's answer replaces it. */
function predict(v: GameView, me: number, a: Action): GameView | null {
	const n: GameView = { ...v, hand: [...v.hand], discard: [...v.discard], players: v.players.map(p => ({ ...p })) };
	const mine = n.players.find(p => p.id === me);
	if (!mine) return null;
	switch (a.type) {
		case 'play': {
			const i = n.hand.indexOf(a.card);
			if (i < 0) return null;
			n.hand.splice(i, 1);
			n.discard = [a.card, ...n.discard].slice(0, 8);
			mine.handCount = n.hand.length;
			n.playable = [];
			n.drawn = null;
			if (a.suit) n.suit = a.suit;
			else if (!isJoker(a.card)) n.suit = a.card.slice(-1) as Suit;
			return n;
		}
		case 'draw':
			n.hand.push(PENDING);
			n.deckCount = Math.max(0, n.deckCount - 1);
			n.playable = [];
			return n;
		case 'pass':
			n.playable = [];
			n.drawn = null;
			n.turn = nextOf(n.order, me, n.direction);
			return n;
		default:
			return null;
	}
}

/** Animate a card image flying from one element to another (skipped when reduced motion is on). */
function fly(fromSel: string, toSel: string, src: string, duration = 300) {
	if (typeof window === 'undefined' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
	const from = document.querySelector(fromSel), to = document.querySelector(toSel);
	if (!from || !to) return;
	const a = from.getBoundingClientRect(), b = to.getBoundingClientRect();
	const cardLike = (r: DOMRect) => r.width > 0 && r.width / r.height < 0.9;
	const pile = document.querySelector('[data-drop="deck"]')?.getBoundingClientRect();
	const size = cardLike(a) ? { w: a.width, h: a.height } : cardLike(b) ? { w: b.width, h: b.height } : pile ? { w: pile.width, h: pile.height } : { w: 60, h: 90 };
	const startX = a.left + a.width / 2 - size.w / 2, startY = a.top + a.height / 2 - size.h / 2;
	const img = document.createElement('img');
	img.src = src; img.className = 'flyer'; img.alt = '';
	Object.assign(img.style, { left: `${startX}px`, top: `${startY}px`, width: `${size.w}px`, height: `${size.h}px` });
	document.body.appendChild(img);
	const intoHand = toSel === '.hand';
	const tx = (intoHand ? b.right - size.w - 12 : b.left + b.width / 2 - size.w / 2) - startX;
	const ty = (intoHand ? b.bottom - size.h - 6 : b.top + b.height / 2 - size.h / 2) - startY;
	const startScale = cardLike(a) ? 1 : 0.55;
	const endScale = intoHand ? 1 : cardLike(b) ? Math.max(0.45, Math.min(1, b.height / size.h)) : 0.55;
	const anim = img.animate(
		[{ transform: `translate(0,0) scale(${startScale}) rotate(0deg)`, opacity: cardLike(a) ? 1 : 0.4 },
		 { transform: `translate(${tx * 0.5}px, ${ty * 0.5}px) scale(${(startScale + endScale) / 2 + 0.1}) rotate(${tx > 0 ? 6 : -6}deg)`, opacity: 1, offset: 0.5 },
		 { transform: `translate(${tx}px, ${ty}px) scale(${endScale}) rotate(0deg)`, opacity: cardLike(b) || intoHand ? 1 : 0.4 }],
		{ duration, easing: 'cubic-bezier(.2,.8,.2,1)' },
	);
	anim.onfinish = () => img.remove();
	anim.oncancel = () => img.remove();
}
