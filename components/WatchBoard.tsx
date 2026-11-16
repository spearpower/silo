'use client';
// Admin "Watch": a read-only view of a table the admin isn't playing at.
// Shows what everyone at the table can see (card counts, discard pile, cutter, penalty) — never anyone's hand.
import Link from 'next/link';
import { useState } from 'react';
import { avatar, cardSrc, CARD_BACK, type GameData } from '@/lib/client';
import { variantInfo } from '@/lib/rules';
import { cardLabel, SUIT_NAMES, SUIT_SYMBOLS } from '@/lib/card-codes';
import TableMenu from './TableMenu';

export default function WatchBoard({ data, onChanged }: { data: GameData; onChanged: () => void }) {
	const v = data.watch!;
	const [menu, setMenu] = useState(false);
	const person = (id: number) => data.players.find(p => p.id === id);
	const nameOf = (id: number) => person(id)?.username || 'Player';
	const line = (l: string) => l.replace(/\{(\d+)\}/g, (_, x) => nameOf(Number(x)));
	const top = v.discard[0];
	const winners = v.finished?.standings.filter(s => s.rank === 1).map(s => nameOf(s.id)).join(' & ');
	const status = data.status === 'playing' ? (v.turn ? `${nameOf(v.turn)}’s turn` : 'Between turns')
		: data.status === 'finished' ? `Finished · ${winners} won` : data.status === 'ended' ? 'Ended' : data.status;
	return (
		<div className="app watch">
			<header className="navbar">
				<Link className="nav-back" href="/admin/tables"><svg viewBox="0 0 12 20" aria-hidden="true"><path d="M10 2 2 10l8 8" /></svg><span>Tables</span></Link>
				<h1 className="nav-title">Watching game {data.id}</h1>
				<div className="nav-trailing">{data.canManage && data.status === 'playing' && <button type="button" onClick={() => setMenu(true)}>Manage</button>}</div>
			</header>
			<main>
				<div className="watch-head">
					<span className="pill live">{data.status === 'playing' ? '● Live' : status}</span>
					<span>{variantInfo(data.variant).name} · {v.moves} cards played{data.practice ? ' · with Virtual Friends' : ''}</span>
				</div>
				<p className="subtitle" style={{ marginTop: 6 }}>{status}. You can see the table, not anyone’s hand.</p>
				<div className="watch-center">
					<div className="pilewrap"><div className="pile">{top ? <img src={cardSrc(top)} alt={`Discard: ${cardLabel(top)}`} /> : null}</div><span className="pile-label">Discard · follow {SUIT_SYMBOLS[v.suit]} {SUIT_NAMES[v.suit]}</span></div>
					<div className="pilewrap"><div className="pile"><img src={CARD_BACK} alt="" /><span className="count">{v.deckCount}</span></div><span className="pile-label">Draw pile</span></div>
					<div className="pilewrap"><div className="pile cutter-pile"><img src={cardSrc(v.cutter)} alt={`Cutter: ${cardLabel(v.cutter)}`} /></div><span className="pile-label">Cutter · {v.cutSeven.replace(/([SHDC])$/, m => SUIT_SYMBOLS[m as 'S'])} cuts</span></div>
				</div>
				{v.open && !v.penalty && <p className="penalty-banner" style={{ background: "var(--mint)" }}>The A♠ cooled a penalty: any card can be played next</p>}
				{v.penalty && <p className="penalty-banner">Draw {v.penalty.amount} waiting for {v.turn ? nameOf(v.turn) : 'the next player'}</p>}
				<div className="watch-players">
					{v.order.map(id => {
						const p = v.players.find(x => x.id === id)!;
						const who = person(id);
						return (
							<div key={id} className={`rival watch-rival${v.turn === id ? ' turn' : ''}`}>
								<div className="top">
									<img className="av" src={avatar(who?.photo || 'na.png')} alt="" />
									<div className="who">
										<span className="nm">{nameOf(id)}{who?.isBot && <> <span className="vf-badge">Virtual</span></>}</span>
										<span className="st">{p.handCount} {p.handCount === 1 ? 'card' : 'cards'}{v.turn === id ? ' · playing' : ''}</span>
									</div>
									<span className={`cnt${p.handCount <= 2 ? ' low' : ''}`} aria-label={`${p.handCount} cards in hand`}>{p.handCount}</span>
								</div>
							</div>
						);
					})}
				</div>
				{v.log.length > 0 && <>
					<div className="section-title">Latest</div>
					<ul className="watch-log">{v.log.map((l, i) => <li key={i}>{line(l)}</li>)}</ul>
				</>}
			</main>
			{menu && <TableMenu variant={data.variant} gameId={data.id} me={data.me} canManage players={data.players.filter(p => !p.left)} inGame={false}
				onClose={() => setMenu(false)} onDone={() => { setMenu(false); onChanged(); }} />}
		</div>
	);
}
