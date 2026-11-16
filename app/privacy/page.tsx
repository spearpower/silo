import Link from 'next/link';
import { NavBar } from '@/components/ui';

// Public: readable before and after signing in (middleware lists /privacy as public).
export const metadata = { title: 'Privacy Policy · PicknPlay', description: 'What PicknPlay keeps about you, why, who can see it, and how to delete your account.' };

const UPDATED = '16 November 2026';

export default function PrivacyPage() {
	return (
		<div className="app">
			<NavBar title="Privacy" back="/" backLabel="Back" />
			<main className="policy">
				<h1 className="large-title">Privacy Policy</h1>
				<p className="subtitle">PicknPlay · last updated {UPDATED}</p>

				<p>PicknPlay is a card game you play with friends, or with our computer players (Virtual Friends). This page tells you, in everyday words, what we keep about you, why we keep it, who can see it, and how to delete it. We don’t sell your data. We don’t show ads. We don’t use tracking or analytics tools.</p>

				<h2>What we keep</h2>
				<h3>Your account</h3>
				<ul>
					<li>The <b>username, full name and picture</b> you choose.</li>
					<li>Your <b>email and phone number</b>, but only if you add them. Both are optional.</li>
					<li>Your <b>password</b>, scrambled one way (bcrypt). Nobody can read it, not even an admin.</li>
					<li><b>When you last signed in and were last active</b>, so your friends can see you’re around and an admin can help if something goes wrong.</li>
				</ul>
				<h3>Your games</h3>
				<ul>
					<li><b>The games you play</b>: your seat, cards, moves, hand points, where you finished, your leaderboard points and monthly titles. If someone leaves, is removed, or a game is ended early, we keep the reason given.</li>
					<li>The <b>table chat and emoji reactions</b> you send. Everyone at that table can read them.</li>
				</ul>
				<h3>Friends</h3>
				<ul>
					<li><b>Friend requests, friends and table invites</b> you send or receive. Old invites are cleared after 7 days.</li>
				</ul>
				<h3>Only if you switch them on</h3>
				<ul>
					<li><b>Phone alerts</b>: your browser gives us an address from its push service (Google, Apple or Mozilla, depending on your phone) so we can send you short messages like “Your turn in game 1095.” You can turn them off any time in Account.</li>
					<li><b>Voice chat</b>: if an admin has turned voice on and <i>you</i> tap the microphone, your voice goes live to the players at your table through LiveKit, our voice service. We never record or keep it. You can mute or leave whenever you like.</li>
				</ul>
				<h3>When something breaks</h3>
				<ul>
					<li><b>Error reports</b>: if a screen crashes, we log the page, the error, your browser type and your username so we can fix it.</li>
				</ul>
				<h3>On your phone or computer</h3>
				<ul>
					<li>A <b>sign-in cookie</b> that keeps you signed in for up to 30 days.</li>
					<li><b>Your settings</b> (sound and volume, how your cards are sorted, which chat messages you’ve read, the tab you used last). These stay on your device.</li>
				</ul>

				<h2>Why we use it</h2>
				<ul>
					<li>To run the game: tables, turns, scores, the leaderboard, friends and invites.</li>
					<li>To keep things fair: the away rule, the reasons for leaving or removing someone, and tools that let admins suspend accounts.</li>
					<li>To help you: an admin can reset your password, and we can fix errors you run into.</li>
				</ul>

				<h2>Who can see what</h2>
				<ul>
					<li><b>Other players</b> see your username, picture, how you play at their table, your table chat, your scores and your leaderboard points. Your friends can also see when you’re online or when you were last around.</li>
					<li><b>Nobody sees your cards</b> while a game is on. Not the other players, and not an admin watching the table.</li>
					<li><b>Admins</b> can see account details (name, email, phone, when you were last active, how many games you’ve played) so they can help players, reset passwords and suspend accounts that break the rules.</li>
				</ul>

				<h2>Where it’s kept</h2>
				<ul>
					<li><b>Supabase</b> stores the game database.</li>
					<li><b>Vercel</b> runs the app and keeps server logs for a short time.</li>
					<li><b>LiveKit</b> carries voice chat while you’re talking, if you use it.</li>
					<li><b>Your phone’s push service</b> delivers alerts, if you turn them on.</li>
				</ul>
				<p>Everything travels over encrypted connections (HTTPS). Only the PicknPlay server can reach the database. Browsers can’t.</p>

				<h2>How long we keep it</h2>
				<p>For as long as you have an account. Finished games stay in the history so everyone’s scores still add up. A game nobody has touched for 24 hours is closed, and old invites are cleared after 7 days.</p>

				<h2>Your choices</h2>
				<ul>
					<li>Change your username, name, email, phone, picture and password in <b>Account</b>.</li>
					<li>Turn phone alerts on or off, and mute or leave voice chat whenever you like.</li>
					<li><b>Delete your account</b> whenever you want. Here’s how it works.</li>
				</ul>

				<h2>Deleting your account</h2>
				<p>Go to <b>Account → Delete my account</b>, enter your password and type DELETE. Right away:</p>
				<ul>
					<li>You leave any game you’re in (the others keep playing), and any waiting room you opened closes.</li>
					<li>Your name, email, phone, picture and password are wiped, and you’re signed out on every device.</li>
					<li>Your chat messages, leaderboard points, monthly titles, friends, invites and phone alerts are deleted.</li>
					<li>If you never finished a game, your account disappears completely. If you did, your seat in other people’s finished games stays as an anonymous “Deleted” player with no personal details, so their history and scores still make sense. Nobody can ever sign in to it.</li>
					<li>Your username becomes free for someone else. This can’t be undone.</li>
				</ul>

				<h2>Changes</h2>
				<p>If we change this policy, we’ll update the date at the top. If it’s a big change, we’ll tell you in the app.</p>

				<h2>Questions</h2>
				<p>Ask a PicknPlay admin, or the friend who invited you to PicknPlay.</p>

				<p className="hint" style={{ marginTop: 24 }}><Link href="/how-to-play" style={{ color: 'var(--gold)' }}>How to Play</Link></p>
			</main>
		</div>
	);
}
