// PicknPlay card codes: `<rank><suit>` — "AS" (Ace of Spades), "10H", "QD", "7C" — and the two Jokers "XR" / "XB".
// Pure helpers only (no Node imports): safe to use in the browser and on the server.
export type Card = string;
export type Suit = 'S' | 'H' | 'D' | 'C';
export type Variant = 'classic' | 'super';

export const SUITS: Suit[] = ['S', 'H', 'D', 'C'];
export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;
export const JOKERS: Card[] = ['XR', 'XB'];
export const SUIT_NAMES: Record<Suit, string> = { S: 'Spades', H: 'Hearts', D: 'Diamonds', C: 'Clubs' };
export const SUIT_SYMBOLS: Record<Suit, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };
/** Lower-case suit names as stored in games.current_suit / top_card_suit / cutter_suit. */
export const SUIT_DB: Record<Suit, string> = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' };
const RANK_NAMES: Record<string, string> = { A: 'Ace', J: 'Jack', Q: 'Queen', K: 'King' };

/** The Black Spade Ace: worth 60 in PicknPlay Super and the only card that cancels a 3 or Joker penalty. */
export const BLACK_SPADE_ACE: Card = 'AS';

export const isJoker = (c: Card) => c[0] === 'X';
export const rankOf = (c: Card): string => (isJoker(c) ? 'X' : c.slice(0, -1));
export const suitOf = (c: Card): Suit | null => (isJoker(c) ? null : (c.slice(-1) as Suit));
export const isSuit = (x: unknown): x is Suit => typeof x === 'string' && (SUITS as string[]).includes(x);
export const isRed = (c: Card) => c === 'XR' || c.endsWith('H') || c.endsWith('D');

/** Every card of a variant: 52 for Classic, 54 (with both Jokers) for Super. */
export function deckFor(variant: Variant): Card[] {
	const cards: Card[] = [];
	for (const s of SUITS) for (const r of RANKS) cards.push(`${r}${s}`);
	if (variant === 'super') cards.push(...JOKERS);
	return cards;
}

export function isValidCard(c: unknown, variant: Variant): c is Card {
	return typeof c === 'string' && deckFor(variant).includes(c);
}

export function cardLabel(c: Card): string {
	if (c === 'XR') return 'Red Joker';
	if (c === 'XB') return 'Black Joker';
	const r = rankOf(c), s = suitOf(c)!;
	return `${RANK_NAMES[r] || r} of ${SUIT_NAMES[s]}`;
}

/** Short label for chips and logs: "A♠", "10♥", "Joker". */
export function cardShort(c: Card): string {
	if (isJoker(c)) return 'Joker';
	return `${rankOf(c)}${SUIT_SYMBOLS[suitOf(c)!]}`;
}

/** Card image path. Faces are the public-domain English-pattern deck; Jokers and the back are our own. */
export const cardImage = (c: Card) => `/cards/${c}.svg`;
export const CARD_BACK = '/cards/back.svg';

/**
 * Points a card is worth when a cut is counted (lowest total wins).
 * rules.MD: 2 = 20, Ace = 15 (Black Spade Ace = 60 in Super), J = 11, Q = 12, K = 13, 3–10 face value.
 * Jokers have no value in rules.MD: they count `jokerPoints` (a configurable rule, see lib/rules.ts).
 */
export function cardPoints(c: Card, variant: Variant, jokerPoints: number): number {
	if (isJoker(c)) return jokerPoints;
	const r = rankOf(c);
	if (r === 'A') return variant === 'super' && c === BLACK_SPADE_ACE ? 60 : 15;
	if (r === '2') return 20;
	if (r === 'J') return 11;
	if (r === 'Q') return 12;
	if (r === 'K') return 13;
	return Number(r);
}

export function handPoints(hand: Card[], variant: Variant, jokerPoints: number): number {
	return hand.reduce((sum, c) => sum + cardPoints(c, variant, jokerPoints), 0);
}

/** Order for showing a hand: by suit (♠ ♥ ♣ ♦ alternates colours) then rank, Jokers last. */
export function sortHand(hand: Card[], by: 'suit' | 'rank' = 'suit'): Card[] {
	const so: Record<string, number> = { S: 0, H: 1, C: 2, D: 3 };
	const ro = (c: Card) => (isJoker(c) ? 99 : RANKS.indexOf(rankOf(c) as (typeof RANKS)[number]));
	const sk = (c: Card) => (isJoker(c) ? 9 : so[suitOf(c)!]);
	return [...hand].sort((a, b) => (by === 'suit' ? sk(a) - sk(b) || ro(a) - ro(b) : ro(a) - ro(b) || sk(a) - sk(b)) || a.localeCompare(b));
}
