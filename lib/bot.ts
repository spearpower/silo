// Virtual Friends: computer players. They only ever see what a person in their seat would see
// (their own hand + the table), and every move goes through the same engine checks as a person's.
import { Card, isJoker, rankOf, Suit, SUITS, suitOf } from './card-codes';
import { apply, BotLevel, GameState, nextFrom, pointsOf, tableOf } from './engine';
import { canPlay, cancels, cutSeven, cutThreshold, penaltyOf } from './rules';

const rnd = Math.random;

/** The suit to name with an Ace: the suit we hold most of (Jokers/Aces don't count). */
export function bestSuit(hand: Card[]): Suit {
	const n: Record<string, number> = {};
	for (const c of hand) if (!isJoker(c) && rankOf(c) !== 'A') n[suitOf(c)!] = (n[suitOf(c)!] || 0) + 1;
	return [...SUITS].sort((a, b) => (n[b] || 0) - (n[a] || 0))[0];
}

/** Should we cut now (we hold the playable cut 7)? */
function wantsCut(s: GameState, id: number, level: BotLevel): boolean {
	const p = s.players[String(id)];
	const seven = cutSeven(s.cutter)!;
	const left = pointsOf(s, p.hand.filter(c => c !== seven));
	const limit = cutThreshold(s.variant, s.rules);
	if (limit !== null && left >= limit) return false;
	if (level === 'easy') return rnd() < 0.5;
	// Cut when our hand is small compared to what the others are likely holding (~7 points a card)
	const others = s.order.filter(x => x !== id).map(x => s.players[String(x)].hand.length);
	const bestGuess = Math.min(...others) * (level === 'smart' ? 6 : 8);
	return left <= Math.max(12, bestGuess - 4);
}

/** Pick the card to play from the legal ones. */
function choose(s: GameState, id: number, legal: Card[], level: BotLevel): Card {
	if (level === 'easy') return legal[Math.floor(rnd() * legal.length)];
	const p = s.players[String(id)];
	const next = nextFrom(s, id);
	const nextLow = s.players[String(next)].hand.length <= 2;
	const score = (c: Card) => {
		let v = pointsOf(s, [c]);                                // get rid of expensive cards first
		if (rankOf(c) === 'A') v -= 40;                           // keep Aces: they cancel penalties and change suit
		if (c === 'AS' && s.variant === 'super') v -= 80;         // the Black Spade Ace stops 3s and Jokers
		if (penaltyOf(c, s.variant)) v += level === 'smart' && nextLow ? 40 : 5;
		if (level === 'smart' && (rankOf(c) === '8' || rankOf(c) === 'J')) v += s.order.length === 2 ? 25 : nextLow ? 20 : 0;
		if (!isJoker(c) && rankOf(c) !== 'A') v += 2 * p.hand.filter(x => suitOf(x) === suitOf(c)).length; // keep options open
		if (c === cutSeven(s.cutter)) v -= 30;                    // hold the cut 7 until it's worth cutting
		return v;
	};
	return [...legal].sort((a, b) => score(b) - score(a))[0];
}

/** Play one whole turn for the Virtual Friend whose turn it is. */
export function botTurn(s: GameState, id: number): GameState {
	const level: BotLevel = s.botLevel || 'normal';
	for (let guard = 0; guard < 6 && s.turn === id && !s.finished; guard++) {
		const p = s.players[String(id)];
		const t = tableOf(s);
		if (s.step === 'drawn') {
			const c = s.drawn!;
			if (canPlay(t, c) && (level !== 'easy' || rnd() < 0.8)) apply(s, id, { type: 'play', card: c, suit: rankOf(c) === 'A' ? bestSuit(p.hand.filter(x => x !== c)) : undefined });
			else apply(s, id, { type: 'pass' });
			continue;
		}
		let legal = p.hand.filter(c => canPlay(t, c));
		if (s.penalty && legal.length && level !== 'easy') {
			// Best: pass the penalty on; then cool it with the A♠; then soften a 3 with its matching 2
			const kind = s.penalty.kind;
			const stack = legal.filter(c => penaltyOf(c, s.variant)?.kind === kind);
			const cool = legal.filter(c => cancels(c, s.penalty!));
			legal = stack.length ? stack : cool.length ? cool : legal;
		}
		if (!legal.length) { apply(s, id, { type: 'draw' }); continue; }
		const seven = cutSeven(s.cutter)!;
		if (legal.includes(seven) && wantsCut(s, id, level)) { apply(s, id, { type: 'play', card: seven, cut: true }); continue; }
		const card = choose(s, id, legal, level);
		apply(s, id, { type: 'play', card, suit: rankOf(card) === 'A' ? bestSuit(p.hand.filter(x => x !== card)) : undefined });
	}
	return s;
}
