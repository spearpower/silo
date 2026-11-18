/** @type {import('next').NextConfig} */

// Content Security Policy: the app talks only to itself, its Supabase project and its LiveKit server.
const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const livekit = process.env.LIVEKIT_URL || '';
const origin = u => { try { return new URL(u).host; } catch { return ''; } };
const sbHost = origin(supabase);
const lkHost = origin(livekit.replace(/^wss?:/, 'https:'));
const dev = process.env.NODE_ENV !== 'production';

const csp = [
	"default-src 'self'",
	`script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}`,
	"style-src 'self' 'unsafe-inline'",
	`img-src 'self' data: blob:${sbHost ? ` https://${sbHost}` : ''}`,
	"font-src 'self' data:",
	`connect-src 'self'${sbHost ? ` https://${sbHost} wss://${sbHost}` : ''}${lkHost ? ` https://${lkHost} wss://${lkHost}` : ' https://*.livekit.cloud wss://*.livekit.cloud'}`,
	"media-src 'self' blob:",
	"worker-src 'self'",
	"manifest-src 'self'",
	"frame-ancestors 'none'",
	"base-uri 'self'",
	"form-action 'self'",
	"object-src 'none'",
].join('; ');

const nextConfig = {
	reactStrictMode: true,
	poweredByHeader: false,
	async headers() {
		return [
			{ source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache' }, { key: 'Service-Worker-Allowed', value: '/' }] },
			{ source: '/:path*', headers: [
				{ key: 'Content-Security-Policy', value: csp },
				{ key: 'X-Content-Type-Options', value: 'nosniff' },
				{ key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
				{ key: 'X-Frame-Options', value: 'DENY' },
				{ key: 'Permissions-Policy', value: 'microphone=(self), camera=(self), geolocation=(), payment=()' },
				{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
			] },
		];
	},
};

export default nextConfig;
