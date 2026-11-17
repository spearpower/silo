import Link from 'next/link';

export const metadata = { title: 'Privacy & security' };

// Plain-language description of how Silo actually protects data. Keep it accurate: Silo is NOT end-to-end encrypted.
export default function PrivacyPage() {
	return (
		<main className="prose">
			<p><Link href="/">← Back to Silo</Link></p>
			<h1>Privacy &amp; security</h1>
			<p>Silo is a private space for people who know each other. This page explains what we store and who can see it.</p>

			<h2>Who can see your messages</h2>
			<ul>
				<li>Only the people in a conversation can read it. This is enforced by the database itself (row-level security), not only by the app.</li>
				<li>People added to a group later see messages from the moment they joined, not earlier ones. People who leave or are removed lose access.</li>
				<li>Silo admins handle reports and can suspend accounts. The app gives them no way to read your chats.</li>
			</ul>

			<h2>Encryption: what Silo does and doesn’t do</h2>
			<ul>
				<li>Everything between your device and Silo travels over encrypted connections (HTTPS/TLS and secure WebSockets).</li>
				<li>Stored data is encrypted at rest by our database provider (Supabase).</li>
				<li>Voice calls run through LiveKit over encrypted connections (DTLS-SRTP). Calls are not recorded.</li>
				<li><b>Silo is not end-to-end encrypted.</b> Messages are stored on our servers so they can sync across your devices, which means the people who operate Silo’s infrastructure could technically access stored data. We don’t look at it, and the app has no feature for it.</li>
			</ul>

			<h2>What we store</h2>
			<ul>
				<li>Your account: email, display name, username, optional photo and “about” line.</li>
				<li>Your friends, blocks, group memberships and settings.</li>
				<li>Messages and when they were delivered and read (read receipts can be switched off).</li>
				<li>Basic call records (who called, when, how long). No call audio.</li>
				<li>If you allow notifications: a technical address for each device, used only to send you alerts.</li>
			</ul>

			<h2>Your controls</h2>
			<ul>
				<li>Hide your online status and last seen, turn off read receipts, and choose who can start a chat with you.</li>
				<li>Notifications don’t show message text unless you switch that on.</li>
				<li>Block or report anyone. Blocking stops messages and calls both ways and hides you from their search.</li>
				<li>Delete your account any time in Settings. Your profile and memberships are removed; messages you already sent stay in their chats, shown as from a deleted account.</li>
			</ul>
		</main>
	);
}
