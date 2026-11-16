import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/http';
import { NavBar, TabBar, Chevron } from '@/components/ui';
import SignOutButton from '@/components/SignOutButton';
import QuickGameButton from '@/components/QuickGameButton';
import PlayExtras from '@/components/PlayExtras';
import { getSettings } from '@/lib/settings';
import { avatarUrl } from '@/lib/avatars';
import { sql } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function PlayPage() {
	const user = await currentUser();
	if (!user) redirect('/signin');
	const { virtualFriends } = await getSettings();
	// name/avatar may have been changed on another device: read the current ones
	const [me] = await sql<{ username: string; photo: string }[]>`select username, photo from users where id = ${user.id}`.catch(() => [user]);
	return (
		<div className="app has-tabs">
			<NavBar trailing={<SignOutButton />} />
			<main>
				<h1 className="large-title">Play</h1>
				<p className="subtitle">Match the suit or rank, hit them with 2s, and cut when your hand is low. 2–6 players, Classic or Super.</p>

				<PlayExtras />

				<Link href="/account" className="profile" aria-label="Your account" style={{ color: 'inherit', textDecoration: 'none' }}>
					<img className="avatar" src={avatarUrl(me?.photo || user.photo)} alt="" />
					<div className="who">
						<div className="hello">Signed in as</div>
						<div className="name">{me?.username || user.username}</div>
					</div>
					<Chevron />
				</Link>

				<Link href="/host" className="btn btn-primary">
					<svg className="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
					Host a Game
				</Link>
				<QuickGameButton friends={virtualFriends} />

				<div className="section-title">Join</div>
				<nav className="group" aria-label="Join or continue">
					<Link className="row-link" href="/join">
						<span className="row-ico"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M17 8v6M14 11h6" /></svg></span>
						<span className="row-text"><span className="row-title">Join a Game</span><span className="row-sub">Open tables, or enter a PIN</span></span>
						<Chevron />
					</Link>
					<Link className="row-link" href="/continue">
						<span className="row-ico"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.3-5.7" /><path d="M4 4v4h4" /><path d="M12 8v4l3 2" /></svg></span>
						<span className="row-text"><span className="row-title">Continue a Game</span><span className="row-sub">Rejoin a game in progress</span></span>
						<Chevron />
					</Link>
				</nav>

				{virtualFriends && (
					<>
						<div className="section-title">Practice</div>
						<nav className="group" aria-label="Practice">
							<Link className="row-link" href="/practice">
								<span className="row-ico"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="8" width="14" height="11" rx="3" /><path d="M12 4v4M9 13h.01M15 13h.01M9.5 16h5" /></svg></span>
								<span className="row-text"><span className="row-title">Play with Virtual Friends</span><span className="row-sub">Start now against 1–5 computer players</span></span>
								<Chevron />
							</Link>
						</nav>
					</>
				)}
				<div className="section-title">Help</div>
				<nav className="group" aria-label="Help">
					<Link className="row-link" href="/how-to-play">
						<span className="row-ico"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5v-15Z" /><path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20v3H6.5" /></svg></span>
						<span className="row-text"><span className="row-title">How to Play</span><span className="row-sub">Matching, special cards, cutting and scoring</span></span>
						<Chevron />
					</Link>
					<Link className="row-link" href="/privacy">
						<span className="row-ico"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 4 6v6c0 4.4 3.4 8.3 8 9 4.6-.7 8-4.6 8-9V6l-8-3Z" /><path d="M9.5 12l1.8 1.8 3.4-3.6" /></svg></span>
						<span className="row-text"><span className="row-title">Privacy Policy</span><span className="row-sub">What we keep and why</span></span>
						<Chevron />
					</Link>
				</nav>
			</main>
			<TabBar />
		</div>
	);
}
