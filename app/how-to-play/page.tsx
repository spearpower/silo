import { NavBar } from '@/components/ui';
import HowToPlay from '@/components/HowToPlay';

export const metadata = { title: 'How to Play · PicknPlay' };

export default function HowToPlayPage() {
	return (
		<div className="app">
			<NavBar title="How to Play" back="/" backLabel="Play" />
			<main>
				<h1 className="large-title">How to Play</h1>
				<HowToPlay />
			</main>
		</div>
	);
}
