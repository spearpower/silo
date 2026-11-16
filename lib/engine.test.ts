// Engine tests: every rule in rules.MD for PicknPlay Classic and PicknPlay Super, plus the rule options.
import { describe, expect, it } from 'vitest';
import { apply, autoPlay, countCards, finish, GameState, HAND_SIZE, newGame, removePlayer, viewFor } from './engine';
import { botTurn } from './bot';
import { cardPoints, deckFor, handPoints } from './card-codes';
import { canPlay, cleanRules, DEFAULT_RULES, isSpecial, RuleOptions } from './rules';
import type { Variant } from './card-codes';

/** A hand-built table: players 1..n, player 1 on turn, given hands / top card / suit. */
function table(o: {
	variant?: Variant; hands: string[][]; top: string; suit?: string; cutter?: string; deck?: string[];
	penalty?: GameState['penalty']; rules?: Partial<RuleOptions>; direction?: 1 | -1; turn?: number;
}): GameState {
	const variant = o.variant || 'classic';
	const order = o.hands.map((_, i) => i + 1);
	const players: GameState['players'] = {};
	order.forEach((id, i) => { players[String(id)] = { id, hand: [...o.hands[i]] }; });
	const used = new Set([...o.hands.flat(), o.top, ...(o.deck || [])]);
	const cutter = o.cutter || '9C';
	const deck = o.deck ? [...o.deck] : deckFor(variant).filter(c => !used.has(c) && c !== cutter).concat(used.has(cutter) ? [] : [cutter]);
	return {
		variant, rules: { ...DEFAULT_RULES, ...(o.rules || {}) }, order, direction: o.direction || 1,
		deck, discard: [o.top], cutter, suit: (o.suit || o.top.slice(-1)) as GameState['suit'], penalty: o.penalty || null,
		players, turn: o.turn || 1, step: 'play', drawn: null, moves: 0, stuck: 0, seq: 0, events: [], log: [], finished: null,
	};
}
const hand = (s: GameState, id: number) => s.players[String(id)].hand;

describe('deck and deal', () => {
	it('Classic: 52 cards, no Jokers; Super: 54 with two Jokers', () => {
		expect(deckFor('classic')).toHaveLength(52);
		expect(deckFor('classic').some(c => c.startsWith('X'))).toBe(false);
		expect(deckFor('super')).toHaveLength(54);
		expect(deckFor('super').filter(c => c.startsWith('X'))).toEqual(['XR', 'XB']);
		expect(new Set(deckFor('super')).size).toBe(54);
	});

	for (const variant of ['classic', 'super'] as Variant[]) {
		it(`${variant}: deals 7 cards each, a visible cutter at the bottom and a separate opening discard`, () => {
			for (let k = 0; k < 40; k++) {
				const s = newGame(variant, [1, 2, 3, 4], DEFAULT_RULES);
				for (const id of s.order) expect(hand(s, id)).toHaveLength(HAND_SIZE);
				expect(countCards(s)).toBe(variant === 'super' ? 54 : 52);
				expect(s.deck[s.deck.length - 1]).toBe(s.cutter);           // face up under the draw pile
				expect(s.cutter.startsWith('X')).toBe(false);                // the cutter needs a suit
				expect(s.discard).toHaveLength(1);
				expect(s.discard[0]).not.toBe(s.cutter);                     // cutter is not the first discard
				expect(isSpecial(s.discard[0], variant, s.cutter.slice(-1) as never)).toBe(false); // default: plain opening card
				expect(s.order).toContain(s.turn);
				const all = [...s.deck, ...s.discard, ...s.order.flatMap(id => hand(s, id))];
				expect(new Set(all).size).toBe(all.length);                  // no duplicates
			}
		});
	}

	it('needs 2–6 players', () => {
		expect(() => newGame('classic', [1], DEFAULT_RULES)).toThrow();
		expect(() => newGame('classic', [1, 2, 3, 4, 5, 6, 7], DEFAULT_RULES)).toThrow();
		expect(newGame('super', [1, 2, 3, 4, 5, 6], DEFAULT_RULES).order).toHaveLength(6);
	});
});

describe('matching', () => {
	it('plays a card of the same suit or the same rank', () => {
		const s = table({ hands: [['5H', '9S', 'KC'], ['3D']], top: '9H' });
		apply(s, 1, { type: 'play', card: '5H' });        // suit
		expect(s.discard[0]).toBe('5H');
		expect(s.turn).toBe(2);
		const t = table({ hands: [['9S', 'KC'], ['3D']], top: '9H' });
		apply(t, 1, { type: 'play', card: '9S' });        // rank
		expect(t.suit).toBe('S');
	});

	it('refuses a card that matches neither suit nor rank', () => {
		const s = table({ hands: [['KC', '4D'], ['3D']], top: '9H' });
		expect(() => apply(s, 1, { type: 'play', card: 'KC' })).toThrow(/Hearts/);
	});

	it('refuses cards you do not hold, and playing out of turn', () => {
		const s = table({ hands: [['5H'], ['6H']], top: '9H' });
		expect(() => apply(s, 1, { type: 'play', card: '7H' })).toThrow(/not in your hand/);
		expect(() => apply(s, 2, { type: 'play', card: '6H' })).toThrow(/not your turn/);
		expect(() => apply(s, 99, { type: 'draw' })).toThrow(/not in this game/);
	});
});

describe('Ace', () => {
	it('goes on any card except a 2, and names the suit to follow', () => {
		const s = table({ hands: [['AD', '4C'], ['5S', '5C']], top: '9H' });
		expect(() => apply(s, 1, { type: 'play', card: 'AD' })).toThrow(/Name a suit/);
		apply(s, 1, { type: 'play', card: 'AD', suit: 'S' });
		expect(s.suit).toBe('S');
		expect(canPlay({ variant: 'classic', rules: DEFAULT_RULES, top: 'AD', suit: 'S', penalty: null }, '5S')).toBe(true);
		expect(canPlay({ variant: 'classic', rules: DEFAULT_RULES, top: 'AD', suit: 'S', penalty: null }, '5D')).toBe(false);
	});

	it('cannot be played on a 2 (when no penalty is waiting)', () => {
		const s = table({ hands: [['AH', '4C'], ['5S']], top: '2H' });
		expect(() => apply(s, 1, { type: 'play', card: 'AH', suit: 'H' })).toThrow(/Ace can’t be played on a 2/);
	});
});

describe('2: draw two (both variants)', () => {
	it('makes the next player draw 2, then their turn ends', () => {
		const s = table({ hands: [['2H', '4C'], ['5S', '6S'], ['7D']], top: '9H' });
		apply(s, 1, { type: 'play', card: '2H' });
		expect(s.penalty).toEqual({ kind: '2', amount: 2 });
		expect(s.turn).toBe(2);
		expect(() => apply(s, 2, { type: 'play', card: '5S' })).toThrow(/Play a 2 or the Ace of Spades/);
		apply(s, 2, { type: 'draw' });
		expect(hand(s, 2)).toHaveLength(4);
		expect(s.penalty).toBeNull();
		expect(s.turn).toBe(3);
	});

	it('stacks: each 2 adds 2 and passes it on', () => {
		const s = table({ hands: [['2H', '4C'], ['2S', '6S'], ['2D', '7D'], ['8C', '9C']], top: '9H' });
		apply(s, 1, { type: 'play', card: '2H' });
		apply(s, 2, { type: 'play', card: '2S' });
		apply(s, 3, { type: 'play', card: '2D' });
		expect(s.penalty).toEqual({ kind: '2', amount: 6 });
		apply(s, 4, { type: 'draw' });
		expect(hand(s, 4)).toHaveLength(8);
	});

	it('only the Ace of Spades cancels a 2 penalty; other Aces can’t answer it', () => {
		for (const ace of ['AH', 'AD', 'AC']) {
			const s = table({ hands: [['2H', '4C'], [ace, '6S'], ['7D']], top: '9H' });
			apply(s, 1, { type: 'play', card: '2H' });
			expect(() => apply(s, 2, { type: 'play', card: ace, suit: 'D' })).toThrow(/Ace of Spades/);
		}
		const s = table({ hands: [['2H', '4C'], ['AS', '6S'], ['7D', 'KC']], top: '9H' });
		apply(s, 1, { type: 'play', card: '2H' });
		apply(s, 2, { type: 'play', card: 'AS' });           // no suit needed: cancelling doesn't ask
		expect(s.penalty).toBeNull();
		expect(s.open).toBe(true);
		expect(s.turn).toBe(3);
		expect(hand(s, 2)).toEqual(['6S']);
		expect(s.events.some(e => e.t === 'play' && e.card === 'AS' && 'suit' in e)).toBe(false);
	});

	it('after the A♠ cancels, the next player may play any card; then normal matching resumes', () => {
		const s = table({ hands: [['2H', '4C'], ['AS', '6S'], ['7D', 'KC'], ['9D', '5H']], top: '9H' });
		apply(s, 1, { type: 'play', card: '2H' });
		apply(s, 2, { type: 'play', card: 'AS', suit: 'H' });   // a suit sent along is ignored
		expect(viewFor(s, 3).playable.sort()).toEqual(['7D', 'KC']);
		apply(s, 3, { type: 'play', card: 'KC' });               // a club on the A♠: fine
		expect(s.open).toBe(false);
		expect(s.suit).toBe('C');
		expect(() => apply(s, 4, { type: 'play', card: '5H' })).toThrow();
	});

	it('an Ace played without a penalty still names a suit', () => {
		const s = table({ hands: [['AS', '4C'], ['5D', '6S'], ['7D']], top: '9H' });
		expect(() => apply(s, 1, { type: 'play', card: 'AS' })).toThrow(/Name a suit/);
		apply(s, 1, { type: 'play', card: 'AS', suit: 'D' });
		expect(s.suit).toBe('D');
		expect(s.open).toBe(false);
	});

	it('rule option drawThenPlay: after drawing the penalty the same player plays on', () => {
		const s = table({ hands: [['2H', '4C'], ['5S', '6S'], ['7D']], top: '9H', rules: { penaltyResponse: 'drawThenPlay' } });
		apply(s, 1, { type: 'play', card: '2H' });
		apply(s, 2, { type: 'draw' });
		expect(s.turn).toBe(2);
		expect(s.penalty).toBeNull();
	});
});

describe('PicknPlay Super penalties', () => {
	it('3 = draw 3, stacks by 3; a 2 cannot answer a 3', () => {
		const s = table({ variant: 'super', hands: [['3H', '4C'], ['3S', '2S'], ['2D', '7D'], ['8C']], top: '9H' });
		apply(s, 1, { type: 'play', card: '3H' });
		expect(s.penalty).toEqual({ kind: '3', amount: 3 });
		expect(() => apply(s, 2, { type: 'play', card: '2S' })).toThrow();
		apply(s, 2, { type: 'play', card: '3S' });
		expect(s.penalty).toEqual({ kind: '3', amount: 6 });
		apply(s, 3, { type: 'draw' });
		expect(hand(s, 3)).toHaveLength(8);
	});

	it('Joker = draw 5, stacks by 5 (two Jokers = 10)', () => {
		const s = table({ variant: 'super', hands: [['XR', '4C'], ['XB', '2S'], ['7D']], top: '9H' });
		apply(s, 1, { type: 'play', card: 'XR' });
		expect(s.penalty).toEqual({ kind: 'X', amount: 5 });
		expect(s.suit).toBe('H');                 // a Joker keeps the suit being followed
		apply(s, 2, { type: 'play', card: 'XB' });
		expect(s.penalty).toEqual({ kind: 'X', amount: 10 });
		apply(s, 3, { type: 'draw' });
		expect(hand(s, 3)).toHaveLength(11);
	});

	it('only the Ace of Spades cancels a 3 or Joker penalty', () => {
		for (const first of ['3H', 'XR']) {
			const s = table({ variant: 'super', hands: [[first, '4C'], ['AH', 'AS', '6S'], ['7D']], top: '9H' });
			apply(s, 1, { type: 'play', card: first });
			expect(() => apply(s, 2, { type: 'play', card: 'AH', suit: 'H' })).toThrow(/Ace of Spades/);
			apply(s, 2, { type: 'play', card: 'AS' });
			expect(s.penalty).toBeNull();
			expect(s.open).toBe(true);
			expect(s.turn).toBe(3);
		}
	});

	it('in Super too, only the A♠ cancels a 2 penalty', () => {
		const s = table({ variant: 'super', hands: [['2H', '4C'], ['AD', 'AS', '6S'], ['7D']], top: '9H' });
		apply(s, 1, { type: 'play', card: '2H' });
		expect(() => apply(s, 2, { type: 'play', card: 'AD', suit: 'S' })).toThrow(/Ace of Spades/);
		apply(s, 2, { type: 'play', card: 'AS' });
		expect(s.penalty).toBeNull();
	});

	it('after a Joker is picked up, the next card follows the Joker’s colour', () => {
		// black Joker: any black card (spades or clubs) fits, red cards don't
		const b = table({ variant: 'super', hands: [['XB', '4C'], ['KD', '2S'], ['5C', '9H', 'QS']], top: '9H' });
		apply(b, 1, { type: 'play', card: 'XB' });
		apply(b, 2, { type: 'draw' });                                   // picks the 5
		expect(viewFor(b, 3).playable.sort()).toEqual(['5C', 'QS']);
		expect(() => apply(b, 3, { type: 'play', card: '9H' })).toThrow(/black/);
		apply(b, 3, { type: 'play', card: 'QS' });
		expect(b.suit).toBe('S');
		// red Joker: any red card (hearts or diamonds) fits, black cards don't
		const r = table({ variant: 'super', hands: [['XR', '4C'], ['KS', '2S'], ['5D', '9C', 'QH']], top: '9S' });
		apply(r, 1, { type: 'play', card: 'XR' });
		apply(r, 2, { type: 'draw' });
		expect(viewFor(r, 3).playable.sort()).toEqual(['5D', 'QH']);
		expect(() => apply(r, 3, { type: 'play', card: '9C' })).toThrow(/red/);
	});

	it('in Classic a 3 has no effect', () => {
		const s = table({ hands: [['3H', '4C'], ['5H'], ['7D']], top: '9H' });
		apply(s, 1, { type: 'play', card: '3H' });
		expect(s.penalty).toBeNull();
		expect(s.turn).toBe(2);
	});

	it('rule option jokerOnAnything=false: a Joker only goes on a Joker', () => {
		const t = { variant: 'super' as const, rules: { ...DEFAULT_RULES, jokerOnAnything: false }, suit: 'H' as const, penalty: null };
		expect(canPlay({ ...t, top: '9H' }, 'XR')).toBe(false);
		expect(canPlay({ ...t, top: 'XB' }, 'XR')).toBe(true);
	});
});

describe('8 and Jack', () => {
	it('8 with more than two players skips the next player', () => {
		const s = table({ hands: [['8H', '4C'], ['5H'], ['6H'], ['7H']], top: '9H' });
		apply(s, 1, { type: 'play', card: '8H' });
		expect(s.turn).toBe(3);
		expect(s.events.some(e => e.t === 'skip' && e.target === 2)).toBe(true);
	});

	it('Jack with more than two players reverses direction', () => {
		const s = table({ hands: [['JH', '4C'], ['5H'], ['6H'], ['7H', 'KS']], top: '9H' });
		apply(s, 1, { type: 'play', card: 'JH' });
		expect(s.direction).toBe(-1);
		expect(s.turn).toBe(4);
		apply(s, 4, { type: 'play', card: '7H' });
		expect(s.turn).toBe(3);
	});

	it('8 or Jack in a two-player game gives another play', () => {
		for (const c of ['8H', 'JH']) {
			const s = table({ hands: [[c, '4H', 'KC'], ['5S']], top: '9H' });
			apply(s, 1, { type: 'play', card: c });
			expect(s.turn).toBe(1);
			expect(s.step).toBe('play');
			apply(s, 1, { type: 'play', card: '4H' });
			expect(s.turn).toBe(2);
		}
	});

	it('two players: unable to make the extra play, you draw by the normal rule', () => {
		const s = table({ hands: [['8H', 'KC'], ['5S']], top: '9H', deck: ['QD', '3S', '9C'] });
		apply(s, 1, { type: 'play', card: '8H' });
		apply(s, 1, { type: 'draw' });                // QD doesn't fit hearts: turn passes
		expect(hand(s, 1)).toEqual(['KC', 'QD']);
		expect(s.turn).toBe(2);
	});
});

describe('drawing', () => {
	it('draws one card; a playable drawn card may be played at once or kept (pass)', () => {
		const s = table({ hands: [['KC'], ['5S'], ['6C']], top: '9H', deck: ['4H', '7S', '9C'] });
		apply(s, 1, { type: 'draw' });
		expect(s.step).toBe('drawn');
		expect(s.drawn).toBe('4H');
		expect(() => apply(s, 1, { type: 'play', card: 'KC' })).toThrow(/only play the card you just drew/);
		expect(() => apply(s, 1, { type: 'draw' })).toThrow(/already drawn/i);
		apply(s, 1, { type: 'play', card: '4H' });
		expect(s.turn).toBe(2);

		const t = table({ hands: [['KC'], ['5S'], ['6C']], top: '9H', deck: ['4H', '7S', '9C'] });
		apply(t, 1, { type: 'draw' });
		apply(t, 1, { type: 'pass' });
		expect(hand(t, 1)).toEqual(['KC', '4H']);
		expect(t.turn).toBe(2);
	});

	it('an unplayable drawn card ends the turn; pass is only allowed after drawing', () => {
		const s = table({ hands: [['KC'], ['5S']], top: '9H', deck: ['4S', '7S', '9C'] });
		expect(() => apply(s, 1, { type: 'pass' })).toThrow();
		apply(s, 1, { type: 'draw' });
		expect(s.turn).toBe(2);
	});

	it('empty draw pile: the discard pile is reshuffled under its top card', () => {
		const s = table({ hands: [['KC'], ['5S']], top: '9H', deck: [] });
		s.discard = ['9H', '3D', '4D', '5D'];
		apply(s, 1, { type: 'draw' });
		expect(s.discard).toEqual(['9H']);
		expect(hand(s, 1)).toHaveLength(2);
		expect(s.deck).toHaveLength(2);
	});

	it('rule option emptyDeck=count: the game ends and the lowest hand wins', () => {
		const s = table({ hands: [['KC'], ['5S']], top: '9H', deck: [], rules: { emptyDeck: 'count' } });
		s.discard = ['9H', '3D'];
		apply(s, 1, { type: 'draw' });
		expect(s.finished?.how).toBe('count');
		expect(s.finished?.standings[0].id).toBe(2);
	});

	it('a penalty draws as many cards as remain when the piles run short', () => {
		const s = table({ hands: [['2H', 'KC'], ['5S']], top: '9H', deck: ['3C'] });
		apply(s, 1, { type: 'play', card: '2H' });
		apply(s, 2, { type: 'draw' });
		expect(hand(s, 2)).toHaveLength(3); // 3C + the reshuffled 9H
	});
});

describe('cutter and cutting', () => {
	it('only the 7 of the cutter suit can cut; the game ends and the lowest hand wins', () => {
		const s = table({ hands: [['7C', '3C', 'KD'], ['KH', 'QH'], ['4H', '2S']], top: '9C', cutter: '10C' });
		expect(() => apply(s, 1, { type: 'play', card: '3C', cut: true })).toThrow(/Only the 7♣/);
		apply(s, 1, { type: 'play', card: '7C', cut: true });
		const f = s.finished!;
		expect(f.how).toBe('cut');
		expect(f.by).toBe(1);
		// 1: 3+13 = 16, 2: 13+12 = 25, 3: 4+20 = 24
		expect(f.standings.map(x => [x.id, x.points, x.rank])).toEqual([[1, 16, 1], [3, 24, 2], [2, 25, 3]]);
		expect(f.standings[0].award).toBe(3);
		expect(s.turn).toBeNull();
	});

	it('the cut 7 must itself be a legal play', () => {
		const s = table({ hands: [['7C', '3C'], ['KH']], top: '9H', cutter: '10C' });
		expect(() => apply(s, 1, { type: 'play', card: '7C', cut: true })).toThrow();
	});

	it('the cutter can lose a cut: lowest hand wins, not the cutter', () => {
		const s = table({ hands: [['7C', 'KC', 'KD'], ['3H']], top: '9C', cutter: '10C' });
		apply(s, 1, { type: 'play', card: '7C', cut: true });
		expect(s.finished!.standings[0].id).toBe(2);
	});

	it('playing the cut 7 without cutting is a normal play', () => {
		const s = table({ hands: [['7C', '3C'], ['KH'], ['4C']], top: '9C', cutter: '10C' });
		apply(s, 1, { type: 'play', card: '7C' });
		expect(s.finished).toBeNull();
		expect(s.turn).toBe(2);
	});

	it('Super: the cutter must hold below 60 points after playing the 7 (default threshold)', () => {
		const s = table({ variant: 'super', hands: [['7C', 'AS', '4D'], ['KH'], ['4H']], top: '9C', cutter: '10C' });
		expect(() => apply(s, 1, { type: 'play', card: '7C', cut: true })).toThrow(/fewer than 60/); // 60 + 4 = 64
		const t = table({ variant: 'super', hands: [['7C', 'KD', 'QD', 'JD', '10D', '9S'], ['KH'], ['4H']], top: '9C', cutter: '10C' });
		apply(t, 1, { type: 'play', card: '7C', cut: true }); // 13+12+11+10+9 = 55 < 60
		expect(t.finished?.how).toBe('cut');
	});

	it('Classic has no cut threshold by default', () => {
		const s = table({ hands: [['7C', 'KD', 'QD', 'JD', '10D', '9S', '2H'], ['KH']], top: '9C', cutter: '10C' });
		apply(s, 1, { type: 'play', card: '7C', cut: true }); // 75 points
		expect(s.finished?.how).toBe('cut');
	});

	it('ties for lowest share the win by default; option cutTie=cutter gives it to the cutter', () => {
		const s = table({ hands: [['7C', '5D'], ['5H'], ['KH']], top: '9C', cutter: '10C' });
		apply(s, 1, { type: 'play', card: '7C', cut: true });
		expect(s.finished!.standings.filter(x => x.rank === 1).map(x => x.id).sort()).toEqual([1, 2]);
		const t = table({ hands: [['7C', '5D'], ['5H'], ['KH']], top: '9C', cutter: '10C', rules: { cutTie: 'cutter' } });
		apply(t, 1, { type: 'play', card: '7C', cut: true });
		expect(t.finished!.standings.filter(x => x.rank === 1).map(x => x.id)).toEqual([1]);
	});
});

describe('scoring', () => {
	it('Classic values: 2=20, A=15, J=11, Q=12, K=13, others face value', () => {
		expect(['2H', 'AS', 'AH', 'JD', 'QC', 'KS', '10H', '3D'].map(c => cardPoints(c, 'classic', 50))).toEqual([20, 15, 15, 11, 12, 13, 10, 3]);
	});
	it('Super: Black Spade Ace = 60, other Aces = 15, Jokers = the Joker points option', () => {
		expect(cardPoints('AS', 'super', 50)).toBe(60);
		expect(cardPoints('AH', 'super', 50)).toBe(15);
		expect(cardPoints('XR', 'super', 50)).toBe(50);
		expect(handPoints(['AS', '2H', 'KC'], 'super', 50)).toBe(93);
		expect(handPoints(['AS', '2H', 'KC'], 'classic', 50)).toBe(48);
	});
});

describe('going out', () => {
	it('emptying your hand wins at once, even with a special card', () => {
		const s = table({ hands: [['2H'], ['5S', 'KD'], ['6C']], top: '9H' });
		apply(s, 1, { type: 'play', card: '2H' });
		expect(s.finished?.how).toBe('out');
		expect(s.finished?.standings[0]).toMatchObject({ id: 1, rank: 1, points: 0, award: 3 });
		expect(s.penalty).toBeNull();
		expect(() => apply(s, 2, { type: 'draw' })).toThrow(/finished/);
	});
});

describe('timeouts, leaving, privacy', () => {
	it('a timeout draws (or takes the penalty) and passes the turn', () => {
		const s = table({ hands: [['2H', 'KC'], ['5S'], ['6C']], top: '9H' });
		apply(s, 1, { type: 'play', card: '2H' });
		autoPlay(s);
		expect(hand(s, 2)).toHaveLength(3);
		expect(s.turn).toBe(3);
		expect(s.missed?.['2']).toBe(1);
	});

	it('a player who leaves gives their cards back to the draw pile, cutter stays at the bottom', () => {
		const s = newGame('super', [1, 2, 3], DEFAULT_RULES);
		const total = countCards(s);
		const out = s.turn!;
		removePlayer(s, out, 'left');
		expect(countCards(s)).toBe(total);
		expect(s.deck[s.deck.length - 1]).toBe(s.cutter);
		expect(s.turn).not.toBe(out);
		expect(s.order).toHaveLength(2);
	});

	it('a player’s view never contains other hands or the draw pile', () => {
		const s = newGame('super', [1, 2, 3], DEFAULT_RULES);
		const v = viewFor(s, 1);
		const json = JSON.stringify(v);
		for (const id of [2, 3]) for (const c of hand(s, id)) expect(v.hand).not.toContain(c);
		expect(json).not.toContain('"deck"');
		expect(v.players.every(p => !('hand' in p))).toBe(true);
		expect(v.deckCount).toBe(s.deck.length);
		// the hand-built events never include a drawn card
		apply(s, s.turn!, { type: 'draw' });
		expect(JSON.stringify(s.events.filter(e => e.t === 'draw'))).not.toMatch(/"card"/);
	});

	it('playable cards are computed for the player on turn only', () => {
		const s = table({ hands: [['5H', 'KC'], ['6H']], top: '9H' });
		expect(viewFor(s, 1).playable).toEqual(['5H']);
		expect(viewFor(s, 2).playable).toEqual([]);
	});
});

describe('rule options', () => {
	it('unknown values fall back to the defaults', () => {
		expect(cleanRules({ superCutBelow: 'x', emptyDeck: 'nope', jokerPoints: -5 })).toEqual(DEFAULT_RULES);
		expect(cleanRules({ superCutBelow: null, cutTie: 'cutter' })).toMatchObject({ superCutBelow: null, cutTie: 'cutter' });
	});
	it('startDiscard=any allows a special opening card (except Jokers)', () => {
		let special = 0;
		for (let k = 0; k < 200; k++) {
			const s = newGame('super', [1, 2], { ...DEFAULT_RULES, startDiscard: 'any' });
			expect(s.discard[0].startsWith('X')).toBe(false);
			if (isSpecial(s.discard[0], 'super', s.cutter.slice(-1) as never)) special++;
		}
		expect(special).toBeGreaterThan(0);
	});
});

describe('full games with Virtual Friends', () => {
	for (const variant of ['classic', 'super'] as Variant[]) {
		for (const level of ['easy', 'normal', 'smart'] as const) {
			it(`${variant} / ${level}: 2–6 bots always finish, every card accounted for`, { timeout: 30000 }, () => {
				for (let g = 0; g < 60; g++) {
					const n = 2 + (g % 5);
					const s = newGame(variant, Array.from({ length: n }, (_, i) => i + 1), DEFAULT_RULES);
					s.bots = [...s.order];
					s.botLevel = level;
					const total = countCards(s);
					let turns = 0;
					while (!s.finished && turns < 3000) {
						botTurn(s, s.turn!);
						expect(countCards(s)).toBe(total);
						turns++;
					}
					if (!s.finished) finish(s, 'blocked', null);
					expect(s.finished).not.toBeNull();
					expect(s.finished!.standings.some(x => x.rank === 1)).toBe(true);
				}
			});
		}
	}
});
