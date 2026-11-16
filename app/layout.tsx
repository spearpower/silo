import type { Metadata, Viewport } from 'next';
import PwaClient from '@/components/PwaClient';
import './globals.css';

export const metadata: Metadata = {
	title: { default: 'PicknPlay', template: '%s · PicknPlay' },
	description: 'PicknPlay — the match-and-shed card game. Classic and Super, with 2–6 friends in real time.',
	manifest: '/manifest.webmanifest',
	icons: {
		icon: [{ url: '/icons/favicon-32.png', sizes: '32x32', type: 'image/png' }, { url: '/icons/icon.svg', type: 'image/svg+xml' }],
		apple: '/icons/apple-touch-icon.png',
	},
	appleWebApp: { capable: true, title: 'PicknPlay', statusBarStyle: 'black-translucent' },
	formatDetection: { telephone: false },
	other: { 'mobile-web-app-capable': 'yes' },
};

export const viewport: Viewport = {
	width: 'device-width',
	initialScale: 1,
	viewportFit: 'cover',
	themeColor: '#0B4A30',
	colorScheme: 'dark',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en">
			<body>
				{children}
				<PwaClient />
			</body>
		</html>
	);
}
