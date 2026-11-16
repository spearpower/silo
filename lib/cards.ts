// Server-side card utilities (uses Node's crypto RNG). Pure helpers live in card-codes.ts.
import { randomInt } from 'crypto';
import { deckFor, type Card, type Variant } from './card-codes';

export * from './card-codes';

/** A freshly shuffled deck: 52 cards (Classic) or 54 with two Jokers (Super). */
export function newDeck(variant: Variant): Card[] {
	return shuffle(deckFor(variant));
}

/** Fisher–Yates with a cryptographic RNG. */
export function shuffle<T>(arr: T[]): T[] {
	for (let i = arr.length - 1; i > 0; i--) {
		const j = randomInt(i + 1);
		[arr[i], arr[j]] = [arr[j], arr[i]];
	}
	return arr;
}

export const pick = <T>(arr: T[]): T => arr[randomInt(arr.length)];
