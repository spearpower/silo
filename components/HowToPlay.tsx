'use client';
// How to play PicknPlay (Classic and Super), following rules.MD. Used on /how-to-play and in the table menu.
// The house-rule options an admin can change are read from the server, so the text matches the real game.
import { useEffect, useState } from 'react';
import { api } from '@/lib/client';
import { DEFAULT_RULES, RuleOptions, VARIANTS } from '@/lib/rules';
import type { Variant } from '@/lib/card-codes';

export default function HowToPlay({ variant }: { variant?: Variant }) {
	const [shown, setShown] = useState<Variant>(variant || 'classic');
	const [rules, setRules] = useState<RuleOptions>(DEFAULT_RULES);
	useEffect(() => { api<{ rules?: RuleOptions }>('/api/settings').then(s => s.rules && setRules(s.rules)).catch(() => {}); }, []);
	const sup = shown === 'super';
	const cutBelow = sup ? rules.superCutBelow : rules.classicCutBelow;
	return (
		<div className="howto">
			<p><b>PicknPlay</b> is a shedding card game: match the top card of the discard pile by <b>suit or rank</b>, use special cards to change the play, and be the first to <b>empty your hand</b>, or end the game with a <b>cut</b> while your hand is low.</p>

			<div className="segmented" role="radiogroup" aria-label="Variant" style={{ margin: '12px 0' }}>
				{VARIANTS.map(v => <label key={v.id}><input type="radio" name="howto-variant" checked={shown === v.id} onChange={() => setShown(v.id)} /><span>{v.short}{variant === v.id ? ' · this game' : ''}</span></label>)}
			</div>
			<p className="small" style={{ marginTop: 0 }}>{VARIANTS.find(v => v.id === shown)!.blurb}</p>

			<h3>Setting up</h3>
			<ul>
				<li>{sup ? '54 cards: the standard 52 plus two Jokers.' : 'A standard 52-card deck, no Jokers.'} Everyone gets <b>7 cards</b>.</li>
				<li>One card is turned face up as the <b>cutter card</b>. It stays visible under the draw pile. Its <b>suit</b> tells you which 7 can cut.</li>
				<li>The top card of the draw pile starts the discard pile{rules.startDiscard === 'nonSpecial' ? ' (special cards are put back and another is turned)' : ''}.</li>
			</ul>

			<h3>Your turn</h3>
			<ol>
				<li><b>Play one card</b> that matches the top card’s <b>suit</b> or <b>rank</b>. Playable cards are lifted in your hand: tap one to play it.</li>
				<li>Can’t (or don’t want to)? Tap the <b>draw pile</b> to draw one card. If it fits, you may play it straight away, or <b>Keep</b> it and end your turn.</li>
				<li>When the draw pile runs out, {rules.emptyDeck === 'reshuffle' ? 'the discard pile is shuffled into a new draw pile (its top card stays).' : 'the game ends and hands are counted, like a cut.'}</li>
			</ol>

			<h3>Special cards</h3>
			<table className="pts"><tbody>
				<tr><td><b>2</b></td><td>The next player draws 2, unless they play another 2 and pass it on (it grows by 2 each time). Only the <b>Ace of Spades (A♠)</b> cancels it.</td></tr>
				{sup && <tr><td><b>3</b></td><td>The next player draws 3, or passes it on with another 3 (+3 each). Only the <b>A♠</b> cancels it.</td></tr>}
				{sup && <tr><td><b>Joker</b></td><td>The next player draws 5, or passes it on with the other Joker (+5). Only the <b>A♠</b> cancels it. {rules.jokerOnAnything ? 'A Joker can go on any card and keeps the suit being followed.' : 'A Joker can only go on a Joker.'}</td></tr>}
				<tr><td><b>8</b></td><td>With 2 players: play again. With more: the next player is <b>skipped</b>.</td></tr>
				<tr><td><b>Jack</b></td><td>With 2 players: play again. With more: the <b>direction of play reverses</b>.</td></tr>
				<tr><td><b>Ace</b></td><td>Goes on any card except a 2, and you <b>ask for a suit</b> the next player must follow. The <b>A♠</b> is special: it also cools off any draw penalty. When it does, you don’t ask for a suit, so the next player can play any card.</td></tr>
			</tbody></table>
			<p className="small">Facing a penalty you can only pass it on, cool it off with the A♠, or <b>draw the whole amount</b>{rules.penaltyResponse === 'draw' ? ', and that ends your turn' : ' and then play on'}.</p>

			<h3>Cutting</h3>
			<p>Play the <b>7 of the cutter’s suit</b> and tap <b>Cut</b> to end the game at once. Everyone adds up the cards left in their hand and the <b>lowest total wins</b>. Careful: the cutter can lose!
				{cutBelow !== null && <> In {sup ? 'Super' : 'Classic'} you may only cut when your own hand, after the 7, totals <b>below {cutBelow}</b>.</>}
				{rules.cutTie === 'share' ? ' A tie for lowest shares the win.' : ' If the cutter ties for lowest, the cutter wins.'}</p>
			<table className="pts"><tbody>
				<tr><td>2</td><td>20 points</td></tr>
				<tr><td>Ace</td><td>15 points{sup && <> · <b>A♠ 60 points</b></>}</td></tr>
				<tr><td>King · Queen · Jack</td><td>13 · 12 · 11 points</td></tr>
				<tr><td>3 to 10</td><td>Face value</td></tr>
				{sup && <tr><td>Joker</td><td>{rules.jokerPoints} points (house rule)</td></tr>}
			</tbody></table>

			<h3>Winning</h3>
			<p><b>Go out</b> (play your last card) and you win outright. You can also win a <b>cut</b> by holding the lowest hand. Everyone earns leaderboard points for their place: with 4 players, 1st gets 4, 2nd gets 3, and so on. Games with Virtual Friends are practice and don’t count.</p>

			<h3>Fair play</h3>
			<ul>
				<li>The server checks every move, so nobody can peek at your hand or play out of turn.</li>
				<li>With a turn timer, a turn that runs out draws a card for you and passes.</li>
				<li>Miss <b>3 turns in a row</b> and you’re taken out so the table can carry on.</li>
				<li>The host can remove players or end the game, always with a reason.</li>
			</ul>
		</div>
	);
}
