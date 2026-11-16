// PicknPlay rules: the variants, the configurable "items to agree before play" (rules.MD §5),
// and the pure matching logic shared by the server engine, the Virtual Friends and the board.
// rules.MD is the authority; anything it leaves open lives in RuleOptions with a documented default.
import { BLACK_SPADE_ACE, Card, isJoker, isRed, rankOf, Suit, suitOf, Variant } from './card-codes';

export interface VariantInfo { id: Variant; name: string; short: string; blurb: string; deck: number }

export const VARIANTS: VariantInfo[] = [
	{ id: 'classic', name: 'PicknPlay Classic', short: 'Classic', deck: 52, blurb: 'The classic game with 52 cards and no Jokers. Hit the next player with a 2. Only the Ace of Spades can stop it.' },
	{ id: 'super', name: 'PicknPlay Super', short: 'Super', deck: 54, blurb: 'Adds two Jokers. A 2 makes the next player draw 2, a 3 draws 3 and a Joker draws 5. Only the Ace of Spades stops any of them.' },
];
export const variantInfo = (v: unknown): VariantInfo => VARIANTS.find(x => x.id === v) || VARIANTS[0];
export const asVariant = (x: unknown): Variant => (x === 'super' ? 'super' : 'classic');

/**
 * The rule decisions rules.MD leaves open. Admins change them on the Admin page; each game keeps the
 * options it started with (a snapshot in its state), so a change never alters a game in progress.
 */
export interface RuleOptions {
	/** Super cut threshold (rules.MD §3.4 / §5.1): the cutter's own hand, after playing the 7, must total below this. null = no threshold. */
	superCutBelow: number | null;
	/** The same idea for Classic (rules.MD sets none): null = no threshold. */
	classicCutBelow: number | null;
	/** §5.2: a player who can't (or won't) answer a penalty draws the whole amount; then their turn ends ('draw') or they play on ('drawThenPlay'). */
	penaltyResponse: 'draw' | 'drawThenPlay';
	/** §5.3: when the draw pile runs out, reshuffle the discard pile under its top card ('reshuffle'), or end the game and count hands ('count'). */
	emptyDeck: 'reshuffle' | 'count';
	/** §5.4: the opening discard is the top card of the draw pile; 'nonSpecial' re-buries special cards (2, 3, Joker, 8, J, A, the cut 7). */
	startDiscard: 'nonSpecial' | 'any';
	/** §5.5: several players tied on the lowest count: all share the win ('share'), or the player who cut wins the tie ('cutter'). */
	cutTie: 'share' | 'cutter';
	/** rules.MD gives Jokers no point value: what a Joker counts when hands are totalled. */
	jokerPoints: number;
	/** rules.MD doesn't say what a Joker may be played on: on any card (true) or only on a Joker (false). */
	jokerOnAnything: boolean;
}

export const DEFAULT_RULES: RuleOptions = {
	superCutBelow: 60,
	classicCutBelow: null,
	penaltyResponse: 'draw',
	emptyDeck: 'reshuffle',
	startDiscard: 'nonSpecial',
	cutTie: 'share',
	jokerPoints: 50,
	jokerOnAnything: true,
};

const intOrNull = (x: unknown, dflt: number | null, min: number, max: number) => {
	if (x === null) return null;
	const n = Number(x);
	return Number.isInteger(n) && n >= min && n <= max ? n : dflt;
};

/** Accept only known values; anything else falls back to the default. */
export function cleanRules(raw: unknown): RuleOptions {
	const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
	const d = DEFAULT_RULES;
	return {
		superCutBelow: 'superCutBelow' in r ? intOrNull(r.superCutBelow, d.superCutBelow, 1, 500) : d.superCutBelow,
		classicCutBelow: 'classicCutBelow' in r ? intOrNull(r.classicCutBelow, d.classicCutBelow, 1, 500) : d.classicCutBelow,
		penaltyResponse: r.penaltyResponse === 'drawThenPlay' ? 'drawThenPlay' : 'draw',
		emptyDeck: r.emptyDeck === 'count' ? 'count' : 'reshuffle',
		startDiscard: r.startDiscard === 'any' ? 'any' : 'nonSpecial',
		cutTie: r.cutTie === 'cutter' ? 'cutter' : 'share',
		jokerPoints: intOrNull(r.jokerPoints, d.jokerPoints, 0, 200) ?? d.jokerPoints,
		jokerOnAnything: typeof r.jokerOnAnything === 'boolean' ? r.jokerOnAnything : d.jokerOnAnything,
	};
}

export const cutThreshold = (variant: Variant, rules: RuleOptions) => (variant === 'super' ? rules.superCutBelow : rules.classicCutBelow);

// ---------- Penalties ----------

export type PenaltyKind = '2' | '3' | 'X';
export interface Penalty { kind: PenaltyKind; amount: number }

/** The draw penalty a card starts or adds to in this variant, or null. */
export function penaltyOf(c: Card, variant: Variant): { kind: PenaltyKind; amount: number } | null {
	if (rankOf(c) === '2') return { kind: '2', amount: 2 };
	if (variant !== 'super') return null;
	if (rankOf(c) === '3') return { kind: '3', amount: 3 };
	if (isJoker(c)) return { kind: 'X', amount: 5 };
	return null;
}

/**
 * Cool-off: only the Ace of Spades (A♠) cancels a draw penalty, whether it was made with 2s, 3s or Jokers.
 * Cancelling doesn't name a suit: the next player may play any card.
 */
export function cancels(c: Card, _p: Penalty): boolean {
	return c === BLACK_SPADE_ACE;
}

/**
 * Super only: facing a 3 penalty, the 2 of the same suit as the 3 on top softens it. The player throws the 2
 * and picks up the rest (the penalty minus 2). The 2 starts no new penalty.
 */
export function softens(c: Card, t: Pick<Table, 'variant' | 'penalty' | 'top'>): boolean {
	return t.variant === 'super' && t.penalty?.kind === '3' && rankOf(c) === '2' && !!t.top && rankOf(t.top) === '3' && suitOf(c) === suitOf(t.top);
}

export const penaltyName = (k: PenaltyKind) => (k === 'X' ? 'Joker' : k);

/** Cards with an effect: never chosen as the opening discard under the 'nonSpecial' rule. */
export function isSpecial(c: Card, variant: Variant, cutterSuit: Suit | null): boolean {
	const r = rankOf(c);
	if (r === '2' || r === '8' || r === 'J' || r === 'A') return true;
	if (variant === 'super' && (r === '3' || isJoker(c))) return true;
	return r === '7' && suitOf(c) === cutterSuit;
}

// ---------- What may be played ----------

export interface Table {
	variant: Variant;
	rules: RuleOptions;
	top: Card | null;          // top of the discard pile
	suit: Suit | null;         // suit to follow (the top card's, or the one named with an Ace)
	penalty: Penalty | null;   // draw penalty waiting for the player on turn
	open?: boolean;            // a penalty was just cancelled: any card may be played
}

/**
 * May `c` go on the discard pile now?
 *  - A penalty is waiting: only a matching penalty card (passes it on) or the A♠ (cancels it).
 *  - Right after a cancel (open table): any card.
 *  - An Ace goes on anything except a 2.
 *  - A Joker (Super) goes on anything (rule option). After it, the next card must match the Joker's colour:
 *    any black card (♠ ♣) on the black Joker, any red card (♥ ♦) on the red Joker (or another Joker, or an Ace).
 *  - Otherwise: same suit as the suit to follow, or same rank as the top card.
 */
export function canPlay(t: Table, c: Card): boolean {
	if (t.penalty) {
		const p = penaltyOf(c, t.variant);
		if (p && p.kind === t.penalty.kind) return true;
		if (softens(c, t)) return true;
		return cancels(c, t.penalty);
	}
	if (!t.top || t.open) return true;
	if (isJoker(c)) return t.rules.jokerOnAnything || isJoker(t.top);
	if (rankOf(c) === 'A') return rankOf(t.top) !== '2';
	if (isJoker(t.top)) return isRed(c) === isRed(t.top);   // Joker on top: follow its colour
	if (t.suit && suitOf(c) === t.suit) return true;
	return !isJoker(t.top) && rankOf(c) === rankOf(t.top);
}

export const legalCards = (t: Table, hand: Card[]) => hand.filter(c => canPlay(t, c));

/** The 7 whose suit matches the cutter card. */
export const cutSeven = (cutter: Card | null): Card | null => (cutter && suitOf(cutter) ? `7${suitOf(cutter)}` : null);
