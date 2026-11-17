import Link from 'next/link';
import { supabaseConfigured } from '@/lib/env';

export const metadata = { title: 'Setup' };

// Shown while the deployment has no Supabase settings yet (instead of a crash).
export default function SetupPage() {
	return (
		<div className="auth">
			<div className="auth-main">
				<div className="auth-card">
					<div className="auth-brand"><img src="/icons/icon-192.png" alt="Silo" width={64} height={64} /><h1>Almost there</h1></div>
					{supabaseConfigured ? (
						<p>Silo is connected. <Link href="/signin">Go to sign in</Link>.</p>
					) : (
						<div className="stack">
							<p style={{ margin: 0 }}>This copy of Silo isn’t connected to its Supabase project yet.</p>
							<p className="muted small" style={{ margin: 0 }}>
								Set <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code> (plus the server-only keys listed in
								<code> .env.example</code>) in <code>.env.local</code> or in Vercel → Settings → Environment Variables, then rebuild.
							</p>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
