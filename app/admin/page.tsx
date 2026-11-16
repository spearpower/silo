'use client';
// Admin hub: app-wide switches, the game-rule options rules.MD leaves open, and links to Players and Tables.
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/client';
import { Chevron, ErrorBanner, NavBar, Skeleton } from '@/components/ui';
import type { RuleOptions } from '@/lib/rules';

interface Settings { virtualFriends: boolean; voiceChat: boolean; rules: RuleOptions; voiceReady: boolean; missing?: { voice: string[]; alerts: string[]; dailyJob: string[] } }

export default function AdminPage() {
	const [s, setS] = useState<Settings | null>(null);
	const [error, setError] = useState('');
	const [saved, setSaved] = useState('');

	useEffect(() => { api<Settings>('/api/admin/settings').then(setS).catch(e => setError(e.message)); }, []);

	async function saveRules(patch: Partial<RuleOptions>, msg: string) {
		if (!s) return;
		const before = s;
		setS({ ...s, rules: { ...s.rules, ...patch } }); setError(''); setSaved('');
		try { setS(await api<Settings>('/api/admin/settings', { rules: patch })); setSaved(`${msg}. New games will use this from now on.`); }
		catch (e) { setError((e as Error).message); setS(before); }
	}

	async function toggle(key: 'virtualFriends' | 'voiceChat', on: boolean) {
		if (!s) return;
		const before = s;
		setS({ ...s, [key]: on }); setError(''); setSaved('');
		try {
			const next = await api<Settings>('/api/admin/settings', { [key]: on });
			setS(next);
			setSaved(key === 'virtualFriends'
				? (next.virtualFriends ? 'Virtual Friends are on for everyone' : 'Virtual Friends are off for everyone')
				: (next.voiceChat ? 'Voice chat is on: players can talk at their tables' : 'Voice chat is off'));
		} catch (e) { setError((e as Error).message); setS(before); }
	}

	return (
		<div className="app">
			<NavBar title="Game Settings" back="/account" backLabel="Account" />
			<main>
				<h1 className="large-title">Admin</h1>
				<p className="subtitle">These settings apply to every player.</p>

				<div className="section-title">Manage</div>
				<nav className="group">
					<Link className="row-link" href="/admin/tables">
						<span className="row-ico"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M8 10h8M8 14h5" /></svg></span>
						<span className="row-text"><span className="row-title">Tables</span><span className="row-sub">Live games and open tables · watch or manage</span></span>
						<Chevron />
					</Link>
					<Link className="row-link" href="/admin/players">
						<span className="row-ico"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M17 11a3 3 0 1 0 0-6M21.5 20a5 5 0 0 0-4-4.9" /></svg></span>
						<span className="row-text"><span className="row-title">Players</span><span className="row-sub">Reset passwords, suspend, roles</span></span>
						<Chevron />
					</Link>
				</nav>

				<div className="section-title">Switches</div>
				{!s && !error ? <Skeleton rows={2} label="Loading settings" /> : s && (
					<>
						<div className="switch-row">
							<label htmlFor="vf">Virtual Friends</label>
							<span className="switch"><input id="vf" type="checkbox" role="switch" checked={s.virtualFriends} onChange={e => toggle('virtualFriends', e.target.checked)} /><span /></span>
						</div>
						<p className="hint">Lets people practise against computer players, fills Quick Game tables, and lets hosts add them to empty seats. Games already being played aren’t affected.</p>
						<div className="switch-row">
							<label htmlFor="voice">Voice chat at tables</label>
							<span className="switch"><input id="voice" type="checkbox" role="switch" checked={s.voiceChat} disabled={!s.voiceReady && !s.voiceChat} onChange={e => toggle('voiceChat', e.target.checked)} /><span /></span>
						</div>
						<p className="hint">{s.voiceReady
							? 'Players at the same table can talk (LiveKit, free plan). Each person taps the microphone to join; nobody is heard without choosing to.'
							: <>Voice chat can’t be switched on yet: the server is missing <b>{(s.missing?.voice || []).join(', ') || 'the LiveKit settings'}</b>. Add them in Vercel → Settings → Environment Variables (tick Production), then Redeploy.</>}</p>
					</>
				)}
				<div className="section-title">Game rules</div>
				<p className="hint" style={{ marginTop: 0 }}>rules.MD leaves these points for the players to agree. Each game keeps the rules it started with.</p>
				{s && <RulesForm rules={s.rules} save={saveRules} />}
				{s?.missing && (s.missing.alerts.length > 0 || s.missing.dailyJob.length > 0) && (
					<div className="error-banner" role="status" style={{ marginTop: 14 }}>
						Server settings missing:{s.missing.alerts.length > 0 && <> phone alerts need <b>{s.missing.alerts.join(', ')}</b>;</>}
						{s.missing.dailyJob.length > 0 && <> the daily job needs <b>{s.missing.dailyJob.join(', ')}</b>;</>} add them in Vercel (Production) and Redeploy.
					</div>
				)}
				{saved && <div className="ok-banner" role="status">{saved}</div>}
				<ErrorBanner>{error}</ErrorBanner>
			</main>
		</div>
	);
}

function Choice<T extends string>({ id, label, value, options, onPick, note }: { id: string; label: string; value: T; options: [T, string][]; onPick: (v: T) => void; note: string }) {
	return (
		<div className="rule-opt">
			<div className="rule-label" id={id}>{label}</div>
			<div className="segmented" role="radiogroup" aria-labelledby={id}>
				{options.map(([v, l]) => <label key={v}><input type="radio" name={id} checked={value === v} onChange={() => onPick(v)} /><span>{l}</span></label>)}
			</div>
			<p className="hint">{note}</p>
		</div>
	);
}

function RulesForm({ rules, save }: { rules: RuleOptions; save: (p: Partial<RuleOptions>, msg: string) => void }) {
	const cut = rules.superCutBelow === null ? 'none' : String(rules.superCutBelow);
	return (
		<div className="rules-form">
			<Choice id="r-cut" label="Super: cutting needs a low hand" value={cut} options={[['60', 'Below 60'], ['none', 'No limit']]}
				onPick={v => save({ superCutBelow: v === 'none' ? null : Number(v) }, v === 'none' ? 'Super cuts have no points limit' : 'Super cuts need a hand below 60')}
				note="In PicknPlay Super, the player cutting must have fewer than 60 points left in hand after playing the 7 (rules.MD: “below 60 card value”). Classic has no limit." />
			<Choice id="r-pen" label="Facing a draw penalty you can’t answer" value={rules.penaltyResponse} options={[['draw', 'Draw, turn ends'], ['drawThenPlay', 'Draw, then play']]}
				onPick={v => save({ penaltyResponse: v }, v === 'draw' ? 'Drawing a penalty ends the turn' : 'After drawing a penalty the player plays on')}
				note="Answering with a matching penalty card or an allowed Ace is always possible." />
			<Choice id="r-deck" label="When the draw pile runs out" value={rules.emptyDeck} options={[['reshuffle', 'Reshuffle discards'], ['count', 'End & count']]}
				onPick={v => save({ emptyDeck: v }, v === 'reshuffle' ? 'Empty draw pile: reshuffle the discards' : 'Empty draw pile: the game ends and hands are counted')}
				note="Reshuffle keeps the top discard in place and shuffles the rest into a new draw pile." />
			<Choice id="r-start" label="Opening discard" value={rules.startDiscard} options={[['nonSpecial', 'Plain card'], ['any', 'Any card']]}
				onPick={v => save({ startDiscard: v }, v === 'nonSpecial' ? 'The opening discard is always a plain card' : 'Any card can open the discard pile')}
				note="Plain card: a special card (2, 3, Joker, 8, Jack, Ace or the cut 7) turned up first is put back and another is turned. A special opening card has no effect." />
			<Choice id="r-tie" label="Tie for the lowest hand at a cut" value={rules.cutTie} options={[['share', 'Share the win'], ['cutter', 'Cutter wins']]}
				onPick={v => save({ cutTie: v }, v === 'share' ? 'Tied lowest hands share the win' : 'The cutter wins a tie')}
				note="Players with equal totals share their place." />
			<Choice id="r-jpts" label="Joker value when hands are counted" value={String(rules.jokerPoints)} options={[['0', '0'], ['20', '20'], ['50', '50'], ['60', '60']]}
				onPick={v => save({ jokerPoints: Number(v) }, `Jokers count ${v} points`)}
				note="rules.MD gives Jokers no point value." />
			<Choice id="r-jon" label="A Joker can be played on" value={rules.jokerOnAnything ? 'any' : 'joker'} options={[['any', 'Any card'], ['joker', 'Only a Joker']]}
				onPick={v => save({ jokerOnAnything: v === 'any' }, v === 'any' ? 'Jokers can be played on any card' : 'Jokers can only be played on a Joker')}
				note="rules.MD doesn’t say. A Joker keeps the suit that was being followed." />
		</div>
	);
}
