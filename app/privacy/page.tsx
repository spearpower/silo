import Link from 'next/link';
import { NavBar } from '@/components/ui';

// Public: readable before and after signing in (middleware lists /privacy as public).
export const metadata = { title: 'Privacy Policy · PicknPlay', description: 'What PicknPlay collects, why, who can see it, and how to delete your account.' };

const UPDATED = '15 November 2026';

export default function PrivacyPage() {
	return (
		<div className="app">
			<NavBar title="Privacy" back="/" backLabel="Back" />
			<main className="policy">
				<h1 className="large-title">Privacy Policy</h1>
				<p className="subtitle">PicknPlay · last updated {UPDATED}</p>

				<p>PicknPlay is a card game you play with friends and Virtual Friends. This page explains, in plain words, what the game keeps about you, why, who can see it, and how to delete it. We don’t sell your data, we don’t show ads, and we don’t use tracking or analytics tools.</p>

				<h2>What we collect</h2>
				<h3>Your account</h3>
				<ul>
					<li><b>Username, full name and avatar</b> you choose.</li>
					<li><b>Email and phone</b> — only if you add them (both are optional).</li>
					<li><b>Your password</b> — stored only as a one-way scrambled code (bcrypt), so nobody, including admins, can read it.</li>
					<li><b>When you last signed in and were last active</b> — to show friends that you’re online and to help admins with support.</li>
				</ul>
				<h3>Your games</h3>
				<ul>
					<li><b>The games you play</b>: your seat, cards, moves, hand points, final places and leaderboard points, monthly champion titles, and the reason given when someone leaves, is removed, or a game is ended.</li>
					<li><b>Table chat and emoji reactions</b> you send. Everyone at that table can read them.</li>
				</ul>
				<h3>Friends</h3>
				<ul>
					<li><b>Friend requests, friends and table invites</b> you send or receive. Old invites are cleared after 7 days.</li>
				</ul>
				<h3>Only if you turn them on</h3>
				<ul>
					<li><b>Phone alerts</b>: your browser gives us a delivery address from its push service (Google, Apple or Mozilla, depending on your phone). Alerts carry short text such as “Your turn in game 1095.” Turn them off any time in Account.</li>
					<li><b>Voice chat</b>: when an admin has switched voice on and <i>you</i> tap the microphone, your voice is sent live to the players at your table through LiveKit, our voice service. PicknPlay does not record or store voice. You can mute or leave at any time.</li>
				</ul>
				<h3>When something goes wrong</h3>
				<ul>
					<li><b>Error reports</b>: if a screen crashes, the page, the error message, your browser type and your username are written to our server logs so we can fix it.</li>
				</ul>
				<h3>On your device</h3>
				<ul>
					<li>A <b>sign-in cookie</b> that keeps you signed in for up to 30 days.</li>
					<li><b>Your settings</b> (sound, card sort, chat read marker, which tab you last used) stored on your phone only.</li>
				</ul>

				<h2>Why we use it</h2>
				<ul>
					<li>To run the game: tables, turns, scores, the leaderboard, friends and invites.</li>
					<li>To keep it fair and safe: the away rule, leave/remove/end reasons, and admin tools for suspending accounts.</li>
					<li>To help you: password resets by an admin, and fixing errors you hit.</li>
				</ul>

				<h2>Who can see what</h2>
				<ul>
					<li><b>Other players</b> see your username, avatar, your play at their table, your table chat, your scores and leaderboard points. Friends also see when you’re online or were last seen.</li>
					<li><b>Nobody sees your hand</b> during a game — not other players, and not admins watching a table.</li>
					<li><b>Admins</b> can see account details (name, email, phone, last seen, number of games) to help players, reset passwords and suspend accounts that break the rules.</li>
				</ul>

				<h2>Where it’s kept</h2>
				<ul>
					<li><b>Supabase</b> — the game database, in London (UK).</li>
					<li><b>Vercel</b> — runs the app (in London) and keeps short-lived server logs.</li>
					<li><b>LiveKit</b> — carries voice chat while it’s happening, if you use it.</li>
					<li><b>Your phone’s push service</b> — delivers alerts, if you turn them on.</li>
				</ul>
				<p>Everything travels over encrypted connections (HTTPS). The database can only be reached by the PicknPlay server, not directly from browsers.</p>

				<h2>How long we keep it</h2>
				<p>As long as your account exists. Finished games stay in the game history so everyone’s scores remain correct. Games nobody has touched for 24 hours are closed, and old invites are cleared after 7 days.</p>

				<h2>Your choices</h2>
				<ul>
					<li>Change your username, name, email, phone, avatar and password in <b>Account</b>.</li>
					<li>Turn phone alerts on or off, and mute or leave voice chat whenever you like.</li>
					<li><b>Delete your account</b> at any time — see below.</li>
				</ul>

				<h2>Deleting your account</h2>
				<p>Go to <b>Account → Delete my account</b>, enter your password and type DELETE. Straight away:</p>
				<ul>
					<li>You leave any game you’re in (the others carry on) and your waiting rooms close.</li>
					<li>Your name, email, phone, avatar and password are erased, and you’re signed out everywhere.</li>
					<li>Your chat messages, leaderboard points, monthly titles, friends, invites and phone-alert subscriptions are deleted.</li>
					<li>If you never played a game, your account is removed entirely. If you did, your seat in other players’ finished games stays as an anonymous “Deleted” player with no personal details, so their game history and scores still add up. It can never be signed in to.</li>
					<li>Your username becomes free for someone else to use. Deleting can’t be undone.</li>
				</ul>

				<h2>Changes</h2>
				<p>If we change this policy, we’ll update the date at the top. Big changes will be shown in the app.</p>

				<h2>Questions</h2>
				<p>Ask a PicknPlay admin, or contact the person who invited you to PicknPlay.</p>

				<p className="hint" style={{ marginTop: 24 }}><Link href="/how-to-play" style={{ color: 'var(--gold)' }}>How to Play</Link></p>
			</main>
		</div>
	);
}
