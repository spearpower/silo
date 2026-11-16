// PicknPlay game engine: takes a state + an action, returns the new state or throws a GameError.
// Pure (no I/O): the server applies every move here inside a locked database transaction, and the
// rules are unit-tested directly (lib/engine.test.ts). rules.MD is the specification.
import { randomInt } from 'crypto';
import { Card, cardShort, handPoints, isJoker, isSuit, newDeck, pick, rankOf, shuffle, Suit, suitOf, SUIT_NAMES, Variant } from './cards';
import { canPlay, cancels, cutSeven, cutThreshold, isSpecial, Penalty, penaltyName, penaltyOf, RuleOptions, Table } from './rules';

export class GameError extends Error {
	constructor(message: string, public status = 400) { super(message); }
}

/** 'play' = play a card or draw; 'drawn' = drew a playable card: play that card or pass. */
export type Step = 'play' | 'drawn';
export type BotLevel = 'easy' | 'normal' | 'smart';

export const HAND_SIZE = 7;
/** A person whose turn times out this many times in a row is taken out of the game. */
export const AWAY_TURNS = 3;
/** Recent table events kept in the state (the board animates the ones it hasn't seen). */
const EVENTS_KEPT = 16;

export interface PlayerState { id: number; hand: Card[] }

/** Something everyone at the table saw happen. Never contains a card nobody else could see. */
export type TableEvent = { n: number; by: number } & (
	| { t: 'play'; card: Card; suit?: Suit; cut?: boolean }
	| { t: 'draw'; count: number; penalty?: boolean }
	| { t: 'pass' }
	| { t: 'penalty'; kind: Penalty['kind']; amount: number; target: number }
	| { t: 'cancel'; kind: Penalty['kind']; amount: number }
	| { t: 'skip'; target: number }
	| { t: 'reverse' }
	| { t: 'again' }
	| { t: 'reshuffle' }
	| { t: 'timeout' }
	| { t: 'left' }
);

export interface Standing { id: number; points: number; cards: Card[]; rank: number; award: number }

export interface Finish {
	how: 'out' | 'cut' | 'count' | 'blocked';   // count = draw pile ran out (rule option); blocked = nobody could move
	by: number | null;                          // who went out / cut
	threshold: number | null;                   // cut threshold that applied
	standings: Standing[];                      // rank 1 = winner(s)
}

export interface GameState {
	variant: Variant;
	rules: RuleOptions;            // snapshot taken when the game started
	order: number[];               // seating (user ids); play goes round in `direction`
	direction: 1 | -1;
	deck: Card[];                  // index 0 = top of the draw pile; the cutter sits face up at the bottom until drawn
	discard: Card[];               // index 0 = top
	cutter: Card;                  // its suit names the 7 that can cut; stays visible all game
	suit: Suit;                    // suit to follow
	penalty: Penalty | null;       // draw penalty waiting for the player on turn
	players: Record<string, PlayerState>;
	turn: number | null;
	step: Step;
	drawn: Card | null;            // the playable card just drawn (step 'drawn')
	moves: number;                 // cards played so far
	stuck: number;                 // turns in a row nobody could play or draw (blocked-game guard)
	seq: number;                   // event counter
	events: TableEvent[];          // newest last
	log: string[];                 // short readable history, newest first ({id} = player)
	finished: Finish | null;
	bots?: number[];               // Virtual Friends at this table (played by lib/bot.ts)
	botLevel?: BotLevel;
	missed?: Record<string, number>; // turns in a row each person ran out of time
}

export type Action =
	| { type: 'play'; card: Card; suit?: Suit; cut?: boolean }
	| { type: 'draw' }
	| { type: 'pass' }
	| { type: 'timeout' };

// ---------- helpers ----------

const P = (s: GameState, id: number) => {
	const p = s.players[String(id)];
	if (!p) throw new GameError('You are not in this game', 403);
	return p;
};
const who = (id: number) => `{${id}}`;
const log = (s: GameState, msg: string) => { s.log.unshift(msg); s.log.length = Math.min(s.log.length, 8); };
type NewEvent = TableEvent extends unknown ? (TableEvent extends infer E ? (E extends TableEvent ? Omit<E, 'n'> : never) : never) : never;
function event(s: GameState, e: NewEvent) {
	s.seq += 1;
	s.events.push({ ...e, n: s.seq } as TableEvent);
	if (s.events.length > EVENTS_KEPT) s.events.splice(0, s.events.length - EVENTS_KEPT);
}

export const tableOf = (s: GameState): Table => ({ variant: s.variant, rules: s.rules, top: s.discard[0] ?? null, suit: s.suit, penalty: s.penalty });
export const pointsOf = (s: GameState, hand: Card[]) => handPoints(hand, s.variant, s.rules.jokerPoints);

/** The player `k` seats away in the direction of play. */
export function nextFrom(s: GameState, id: number, k = 1): number {
	const n = s.order.length;
	const i = s.order.indexOf(id);
	return s.order[(((i + k * s.direction) % n) + n) % n];
}

function begin(s: GameState, id: number) {
	s.turn = id;
	s.step = 'play';
	s.drawn = null;
}

// ---------- Setup ----------

export function newGame(variant: Variant, playerIds: number[], rules: RuleOptions): GameState {
	if (playerIds.length < 2) throw new GameError('You need at least 2 players to start');
	if (playerIds.length > 6) throw new GameError('A table seats at most 6 players');
	const order = shuffle([...playerIds]);
	const deck = newDeck(variant);
	const players: Record<string, PlayerState> = {};
	for (const id of order) players[String(id)] = { id, hand: [] };
	for (let k = 0; k < HAND_SIZE; k++) for (const id of order) players[String(id)].hand.push(deck.shift()!);

	// Cutter card: revealed and kept face up at the bottom of the draw pile (rules.MD §2.1.4–5). It needs a suit, so not a Joker.
	const ci = deck.findIndex(c => !isJoker(c));
	const [cutter] = deck.splice(ci, 1);
	deck.push(cutter);

	// Opening discard (rules.MD §5.4 left open): the top card of the draw pile; special cards are buried again (default)
	let top = deck.shift()!;
	for (let tries = 0; tries < 80 && (isJoker(top) || (rules.startDiscard === 'nonSpecial' && isSpecial(top, variant, suitOf(cutter)))); tries++) {
		deck.splice(1 + randomInt(Math.max(1, deck.length - 2)), 0, top); // back in, above the cutter
		top = deck.shift()!;
	}

	const s: GameState = {
		variant, rules, order, direction: 1, deck, discard: [top], cutter, suit: suitOf(top)!, penalty: null,
		players, turn: null, step: 'play', drawn: null, moves: 0, stuck: 0, seq: 0, events: [], log: [], finished: null,
	};
	begin(s, pick(order));
	log(s, `Cards dealt · cutter ${cardShort(cutter)}`);
	return s;
}

/** Turn the discard pile (all but its top card) into a new draw pile. False when there is nothing to reshuffle. */
function refill(s: GameState): boolean {
	if (s.deck.length > 0) return true;
	if (s.discard.length <= 1) return false;
	const [top, ...rest] = s.discard;
	s.deck = shuffle(rest);
	s.discard = [top];
	event(s, { t: 'reshuffle', by: s.turn ?? 0 });
	log(s, 'Discard pile reshuffled into a new draw pile');
	return true;
}

/** Draw up to `n` cards. Returns the cards, or null when the game ended because the draw pile ran out (rule 'count'). */
function take(s: GameState, p: PlayerState, n: number): Card[] | null {
	const got: Card[] = [];
	for (let k = 0; k < n; k++) {
		if (s.deck.length === 0) {
			if (s.rules.emptyDeck === 'count') { finish(s, 'count', null); return null; }
			if (!refill(s)) break;
		}
		got.push(s.deck.shift()!);
	}
	p.hand.push(...got);
	return got;
}

// ---------- Actions ----------

/** Applies one action for `me`. Mutates and returns `s`. */
export function apply(s: GameState, me: number, a: Action): GameState {
	if (s.finished) throw new GameError('This game has finished');
	const p = P(s, me);
	if (s.missed?.[String(me)]) delete s.missed[String(me)]; // they're here: reset the away count
	if (s.turn !== me) throw new GameError('It is not your turn');

	switch (a.type) {
		case 'play': return play(s, p, a.card, a.suit, !!a.cut);
		case 'draw': return draw(s, p);
		case 'pass': {
			if (s.step !== 'drawn') throw new GameError('You can only pass after drawing a card you could play');
			event(s, { t: 'pass', by: me });
			begin(s, nextFrom(s, me));
			return s;
		}
		case 'timeout': throw new GameError('Use autoPlay for timeouts');
		default: throw new GameError('Unknown move');
	}
}

function play(s: GameState, p: PlayerState, card: Card, suit: Suit | undefined, cut: boolean): GameState {
	const me = p.id;
	if (typeof card !== 'string' || !p.hand.includes(card)) throw new GameError('That card is not in your hand');
	if (s.step === 'drawn' && card !== s.drawn) throw new GameError('You can only play the card you just drew, or keep it');
	const t = tableOf(s);
	if (!canPlay(t, card)) {
		if (s.penalty) {
			const k = s.penalty.kind;
			throw new GameError(k === '2' ? `Play a 2 or an Ace, or draw ${s.penalty.amount}` : `Play a ${penaltyName(k)} or the Black Spade Ace, or draw ${s.penalty.amount}`);
		}
		if (rankOf(card) === 'A') throw new GameError('An Ace can’t be played on a 2');
		throw new GameError(`Play a ${SUIT_NAMES[s.suit]} card or a matching rank`);
	}
	const isAce = rankOf(card) === 'A';
	if (isAce && !isSuit(suit)) throw new GameError('Name a suit for your Ace');

	const remaining = p.hand.filter(c => c !== card);
	const seven = cutSeven(s.cutter);
	let cutting = false;
	if (cut) {
		if (card !== seven) throw new GameError(`Only the ${cardShort(seven!)} can cut`);
		const limit = cutThreshold(s.variant, s.rules);
		const total = pointsOf(s, remaining);
		if (limit !== null && total >= limit) throw new GameError(`You can cut only with fewer than ${limit} points left in your hand (you would have ${total})`);
		cutting = true;
	}

	// The card goes on the pile
	p.hand = remaining;
	s.discard.unshift(card);
	s.moves += 1;
	s.stuck = 0;
	s.drawn = null;
	if (isAce) s.suit = suit!;
	else if (!isJoker(card)) s.suit = suitOf(card)!;          // a Joker keeps the suit being followed
	event(s, { t: 'play', by: me, card, ...(isAce ? { suit } : {}), ...(cutting ? { cut: true } : {}) });
	log(s, `${who(me)} played ${cardShort(card)}${isAce ? ` · calls ${SUIT_NAMES[suit!]}` : ''}`);

	// Penalties: pass it on (matching card), cancel it (allowed Ace) or start one
	const pen = penaltyOf(card, s.variant);
	if (s.penalty && isAce && cancels(card, s.penalty)) {
		event(s, { t: 'cancel', by: me, kind: s.penalty.kind, amount: s.penalty.amount });
		log(s, `${who(me)} cancelled the draw ${s.penalty.amount}`);
		s.penalty = null;
	} else if (pen) {
		s.penalty = { kind: pen.kind, amount: (s.penalty?.amount || 0) + pen.amount };
	}

	// Going out wins outright (even with a special card); a cut ends the game and hands are counted
	if (p.hand.length === 0) { s.penalty = null; finish(s, 'out', me); return s; }
	if (cutting) { s.penalty = null; finish(s, 'cut', me); return s; }

	const r = rankOf(card);
	const two = s.order.length === 2;
	if ((r === '8' || r === 'J') && two) {
		// Two players: an 8 or a Jack gives another play
		event(s, { t: 'again', by: me });
		begin(s, me);
		return s;
	}
	if (r === '8') {
		const skipped = nextFrom(s, me, 1);
		event(s, { t: 'skip', by: me, target: skipped });
		log(s, `${who(skipped)} was skipped`);
		begin(s, nextFrom(s, me, 2));
		return s;
	}
	if (r === 'J') {
		s.direction = s.direction === 1 ? -1 : 1;
		event(s, { t: 'reverse', by: me });
		log(s, 'Direction of play reversed');
	}
	const next = nextFrom(s, me, 1);
	if (s.penalty) event(s, { t: 'penalty', by: me, kind: s.penalty.kind, amount: s.penalty.amount, target: next });
	begin(s, next);
	return s;
}

function draw(s: GameState, p: PlayerState): GameState {
	const me = p.id;
	if (s.step !== 'play') throw new GameError('You’ve already drawn. Play that card or keep it.');

	if (s.penalty) {
		const amount = s.penalty.amount;
		const got = take(s, p, amount);
		if (got === null) return s; // game ended (draw pile ran out)
		s.penalty = null;
		event(s, { t: 'draw', by: me, count: got.length, penalty: true });
		log(s, `${who(me)} drew ${got.length} (penalty)`);
		if (s.rules.penaltyResponse === 'drawThenPlay') { begin(s, me); return s; }
		begin(s, nextFrom(s, me));
		return s;
	}

	const got = take(s, p, 1);
	if (got === null) return s;
	if (got.length === 0) {
		// Nothing left anywhere to draw: the turn passes. If nobody can move for a whole round, count the hands.
		s.stuck += 1;
		log(s, `${who(me)} could not draw · no cards left`);
		event(s, { t: 'pass', by: me });
		if (s.stuck >= s.order.length) { finish(s, 'blocked', null); return s; }
		begin(s, nextFrom(s, me));
		return s;
	}
	event(s, { t: 'draw', by: me, count: 1 });
	log(s, `${who(me)} drew a card`);
	const card = got[0];
	if (canPlay(tableOf(s), card)) {
		// May play it at once (rules.MD §2.2.5) or pass
		s.step = 'drawn';
		s.drawn = card;
		return s;
	}
	begin(s, nextFrom(s, me));
	return s;
}

// ---------- Timeouts, leaving ----------

/** Plays the minimum turn for whoever's turn it is (turn timer ran out): draw (or take the penalty), then pass. */
export function autoPlay(s: GameState): GameState {
	if (s.finished || s.turn === null) return s;
	const id = s.turn;
	const person = !s.bots?.includes(id);
	const missedBefore = s.missed?.[String(id)] || 0;
	event(s, { t: 'timeout', by: id });
	log(s, `${who(id)} ran out of time`);
	if (s.step === 'play') apply(s, id, { type: 'draw' });
	if (!s.finished && s.turn === id) {
		if (s.step === 'drawn') apply(s, id, { type: 'pass' });
		else begin(s, nextFrom(s, id)); // e.g. 'drawThenPlay' after a penalty
	}
	if (person && s.players[String(id)] && !s.finished) s.missed = { ...(s.missed || {}), [String(id)]: missedBefore + 1 };
	return s;
}

/** The person this many turns away (or more) should be taken out. */
export function awayPlayer(s: GameState, id: number | null): number | null {
	if (id === null || s.finished || !s.players[String(id)] || s.bots?.includes(id)) return null;
	return (s.missed?.[String(id)] || 0) >= AWAY_TURNS ? id : null;
}

/**
 * Take a player out of a game in progress (they left, or were removed). Their cards are shuffled back
 * into the draw pile (above the face-up cutter), so every card stays in play. Returns how many players are left.
 */
export function removePlayer(s: GameState, id: number, note: string): number {
	const p = s.players[String(id)];
	if (!p) throw new GameError('That player is not in this game', 404);
	const next = s.order.length > 1 ? nextFrom(s, id) : null;
	const bottom = s.deck.length && s.deck[s.deck.length - 1] === s.cutter ? s.deck.pop()! : null;
	s.deck = shuffle([...s.deck, ...p.hand]);
	if (bottom) s.deck.push(bottom);
	delete s.players[String(id)];
	s.order = s.order.filter(x => x !== id);
	if (s.bots) s.bots = s.bots.filter(x => x !== id);
	if (s.missed) delete s.missed[String(id)];
	event(s, { t: 'left', by: id });
	log(s, `${who(id)} ${note}`);
	if (s.turn === id) {
		s.penalty = null; // the penalty was aimed at them, not at the next player
		if (s.order.length >= 2 && next !== null) begin(s, next);
	}
	if (s.order.length < 2) s.turn = null;
	return s.order.length;
}

// ---------- Game end ----------

/** Ends the game and ranks everyone. Lowest hand total wins a count; the player who went out always wins. */
export function finish(s: GameState, how: Finish['how'], by: number | null): void {
	const rows = s.order.map(id => ({ id, cards: [...s.players[String(id)].hand], points: pointsOf(s, s.players[String(id)].hand) }));
	const sorted = [...rows].sort((a, b) => {
		if (how === 'out') { if (a.id === by) return -1; if (b.id === by) return 1; }
		return a.points - b.points;
	});
	// Ranks: equal points share a place ("1, 1, 3"). Going out is always a clear 1st.
	const ranks = new Map<number, number>();
	sorted.forEach((r, i) => {
		const prev = sorted[i - 1];
		const tied = prev && prev.points === r.points && !(how === 'out' && (prev.id === by || r.id === by));
		ranks.set(r.id, tied ? ranks.get(prev.id)! : i + 1);
	});
	// Cut tie rule option: the player who cut wins a tie for lowest
	if (how === 'cut' && s.rules.cutTie === 'cutter' && by !== null && ranks.get(by) === 1) {
		const shared = sorted.filter(r => ranks.get(r.id) === 1 && r.id !== by);
		for (const r of shared) ranks.set(r.id, 2);
	}
	const n = rows.length;
	const standings = sorted
		.map(r => ({ ...r, rank: ranks.get(r.id)! }))
		.sort((a, b) => a.rank - b.rank || (a.id === by ? -1 : b.id === by ? 1 : 0))
		.map(r => ({ id: r.id, points: r.points, cards: r.cards, rank: r.rank, award: n - r.rank + 1 }));
	s.finished = { how, by, threshold: how === 'cut' ? cutThreshold(s.variant, s.rules) : null, standings };
	s.turn = null;
	s.penalty = null;
	s.drawn = null;
	const winners = standings.filter(x => x.rank === 1).map(x => who(x.id)).join(' & ');
	log(s, how === 'out' ? `${who(by!)} went out and wins`
		: how === 'cut' ? `${who(by!)} cut · ${winners} ${standings.filter(x => x.rank === 1).length > 1 ? 'share the win' : 'wins'}`
		: how === 'count' ? `Draw pile ran out · ${winners} wins on points`
		: `Nobody could move · ${winners} wins on points`);
}

// ---------- What one player is allowed to see ----------

export interface PlayerView { id: number; handCount: number }

export interface GameView {
	variant: Variant;
	rules: RuleOptions;
	myId: number;
	turn: number | null;
	step: Step;
	direction: 1 | -1;
	hand: Card[];                     // only my own cards
	drawn: Card | null;               // the card I just drew (my turn only)
	playable: Card[];                 // cards I may play right now (server-checked again on play)
	players: PlayerView[];            // others: card counts only
	order: number[];
	deckCount: number;
	cutter: Card;
	cutterInDeck: boolean;            // still face up under the draw pile
	cutSeven: Card;
	cutBelow: number | null;
	discard: Card[];                  // top few (everyone saw them played)
	suit: Suit;
	penalty: Penalty | null;
	moves: number;
	seq: number;
	events: TableEvent[];
	log: string[];
	finished: Finish | null;          // after the game, hands are shown to everyone
}

export const PEEK_CARDS = 8;

export function viewFor(s: GameState, me: number): GameView {
	const mine = s.players[String(me)];
	const myTurn = s.turn === me && !!mine && !s.finished;
	const playable = !myTurn ? [] : s.step === 'drawn' ? (s.drawn && canPlay(tableOf(s), s.drawn) ? [s.drawn] : []) : mine.hand.filter(c => canPlay(tableOf(s), c));
	return {
		variant: s.variant, rules: s.rules, myId: me,
		turn: s.turn, step: s.step, direction: s.direction,
		hand: mine ? [...mine.hand] : [],
		drawn: myTurn ? s.drawn : null,
		playable,
		players: s.order.map(id => ({ id, handCount: s.players[String(id)].hand.length })),
		order: s.order,
		deckCount: s.deck.length,
		cutter: s.cutter,
		cutterInDeck: s.deck.length > 0 && s.deck[s.deck.length - 1] === s.cutter,
		cutSeven: cutSeven(s.cutter)!,
		cutBelow: cutThreshold(s.variant, s.rules),
		discard: s.discard.slice(0, PEEK_CARDS),
		suit: s.suit,
		penalty: s.penalty,
		moves: s.moves,
		seq: s.seq,
		events: s.events,
		log: s.log,
		finished: s.finished,
	};
}

/** Every card is somewhere exactly once (52 or 54). Used by tests and as a server-side sanity check. */
export function countCards(s: GameState): number {
	let n = s.deck.length + s.discard.length;
	for (const id of s.order) n += s.players[String(id)].hand.length;
	return n;
}
