// Virtual Friend difficulty, shown in the waiting room and on the practice page.
export const LEVELS = [
	{ v: 'easy', label: 'Easy', note: 'Relaxed: they play any card that fits and sometimes miss a cut.' },
	{ v: 'normal', label: 'Normal', note: 'They dump high cards, keep their Aces and cut when their hand is low.' },
	{ v: 'smart', label: 'Smart', note: 'They also pass penalties on and skip or reverse when you are about to go out.' },
] as const;
