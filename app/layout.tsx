import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import PwaClient from '@/components/PwaClient';
import './globals.css';

const inter = Inter({ subsets: ['latin'], display: 'swap', variable: '--font-inter' });

export const metadata: Metadata = {
	title: { default: 'Silo', template: '%s · Silo' },
	description: 'A private social space for people who know each other. Messages, groups and voice calls with your close friends.',
	applicationName: 'Silo',
	manifest: '/manifest.webmanifest',
	icons: {
		icon: [{ url: '/icons/favicon-32.png', sizes: '32x32', type: 'image/png' }, { url: '/icons/icon.svg', type: 'image/svg+xml' }],
		apple: '/icons/apple-touch-icon.png',
	},
	appleWebApp: { capable: true, title: 'Silo', statusBarStyle: 'default' },
	formatDetection: { telephone: false },
	robots: { index: false, follow: false },
	other: { 'mobile-web-app-capable': 'yes' },
};

export const viewport: Viewport = {
	width: 'device-width',
	initialScale: 1,
	viewportFit: 'cover',
	themeColor: [
		{ media: '(prefers-color-scheme: light)', color: '#F4F7FA' },
		{ media: '(prefers-color-scheme: dark)', color: '#010F1E' },
	],
};

// Applies the saved theme choice before first paint (no flash). Values: 'light' | 'dark' | absent = follow device.
const themeScript = `try{var t=localStorage.getItem('silo.theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en" className={inter.variable} suppressHydrationWarning>
			<head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
			<body>
				{children}
				<PwaClient />
			</body>
		</html>
	);
}
