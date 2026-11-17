export default function AuthLayout({ children }: { children: React.ReactNode }) {
	return (
		<div className="auth">
			<aside className="auth-side" aria-hidden="true">
				<img src="/icons/icon-192.png" alt="" width={56} height={56} style={{ borderRadius: 16, marginBottom: 28 }} />
				<h2>A private space for the people <em>you know</em><span className="dot">.</span></h2>
				<p>Messages, groups and voice calls with your close friends. No feeds, no strangers, no noise.</p>
			</aside>
			<div className="auth-main">{children}</div>
		</div>
	);
}
