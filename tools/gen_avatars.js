// Generates the original PicknPlay avatar faces: public/avatars/f01.svg .. f24.svg
// Usage: node tools/gen_avatars.js public/avatars
const fs = require('fs');
const path = require('path');
const out = process.argv[2] || 'public/avatars';
fs.mkdirSync(out, { recursive: true });

const BG = ['#2457C5', '#D7263D', '#178A4C', '#F0B21C', '#6B3FA0', '#0E7C86', '#C2571A', '#8E1F5B'];
const SKIN = ['#5C3A21', '#8D5524', '#A86B3C', '#C68642', '#E0AC69', '#F1C27D'];
const HAIR = ['#1B1B1B', '#3B2314', '#6A3E1F', '#B5651D', '#2B2B2B', '#D9B38C'];
const INK = '#1B1B1B';

function hair(kind, c) {
	switch (kind) {
		case 'afro': return `<circle cx="60" cy="50" r="38" fill="${c}"/>`;
		case 'short': return `<path d="M28 52 Q30 20 60 20 Q90 20 92 52 Q84 34 60 34 Q36 34 28 52Z" fill="${c}"/>`;
		case 'bun': return `<circle cx="60" cy="18" r="11" fill="${c}"/><path d="M28 54 Q28 24 60 24 Q92 24 92 54 Q80 36 60 36 Q40 36 28 54Z" fill="${c}"/>`;
		case 'braids': return `<path d="M27 56 Q26 22 60 22 Q94 22 93 56 Q82 34 60 34 Q38 34 27 56Z" fill="${c}"/><circle cx="25" cy="66" r="7" fill="${c}"/><circle cx="25" cy="80" r="6" fill="${c}"/><circle cx="95" cy="66" r="7" fill="${c}"/><circle cx="95" cy="80" r="6" fill="${c}"/>`;
		case 'beanie': return `<path d="M26 54 Q26 18 60 18 Q94 18 94 54Z" fill="${c}"/><rect x="24" y="46" width="72" height="10" rx="5" fill="#F6F3EA" opacity=".9"/><circle cx="60" cy="16" r="6" fill="#F6F3EA"/>`;
		case 'side': return `<path d="M28 56 Q26 20 62 20 Q94 22 92 50 Q78 30 48 38 Q34 42 28 56Z" fill="${c}"/>`;
		default: return '';
	}
}

function eyes(kind) {
	switch (kind) {
		case 'happy': return `<path d="M42 62 Q47 56 52 62" stroke="${INK}" stroke-width="3.5" fill="none" stroke-linecap="round"/><path d="M68 62 Q73 56 78 62" stroke="${INK}" stroke-width="3.5" fill="none" stroke-linecap="round"/>`;
		case 'glasses': return `<circle cx="47" cy="61" r="8" fill="#ffffff55" stroke="${INK}" stroke-width="3"/><circle cx="73" cy="61" r="8" fill="#ffffff55" stroke="${INK}" stroke-width="3"/><path d="M55 61 H65" stroke="${INK}" stroke-width="3"/><circle cx="47" cy="61" r="2.8" fill="${INK}"/><circle cx="73" cy="61" r="2.8" fill="${INK}"/>`;
		case 'wink': return `<circle cx="47" cy="61" r="3.6" fill="${INK}"/><path d="M68 62 Q73 57 78 62" stroke="${INK}" stroke-width="3.5" fill="none" stroke-linecap="round"/>`;
		default: return `<circle cx="47" cy="61" r="3.6" fill="${INK}"/><circle cx="73" cy="61" r="3.6" fill="${INK}"/>`;
	}
}

function mouth(kind) {
	switch (kind) {
		case 'open': return `<path d="M48 76 Q60 92 72 76Z" fill="#7A1F1F"/><path d="M52 77 H68" stroke="#fff" stroke-width="3" stroke-linecap="round"/>`;
		case 'o': return `<ellipse cx="60" cy="80" rx="5" ry="6" fill="#7A1F1F"/>`;
		case 'grin': return `<path d="M46 76 Q60 88 74 76" stroke="${INK}" stroke-width="3.5" fill="none" stroke-linecap="round"/><path d="M44 74 l4 3 M76 74 l-4 3" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>`;
		default: return `<path d="M48 77 Q60 86 72 77" stroke="${INK}" stroke-width="3.5" fill="none" stroke-linecap="round"/>`;
	}
}

const HAIRS = ['afro', 'short', 'bun', 'braids', 'beanie', 'side', 'none', 'short'];
const EYES = ['dots', 'happy', 'glasses', 'wink'];
const MOUTHS = ['smile', 'open', 'grin', 'o'];

for (let i = 0; i < 24; i++) {
	const bg = BG[i % BG.length];
	const skin = SKIN[(i * 5) % SKIN.length];
	const h = HAIRS[(i * 3) % HAIRS.length];
	const hc = h === 'beanie' ? BG[(i + 3) % BG.length] : HAIR[(i * 7) % HAIR.length];
	const e = EYES[(i + Math.floor(i / 4)) % EYES.length];
	const m = MOUTHS[(i * 3 + 1) % MOUTHS.length];
	const back = h === 'afro' ? hair('afro', hc) : '';
	const front = h === 'afro' ? '' : hair(h, hc);
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120">
<rect width="120" height="120" fill="${bg}"/>
<circle cx="60" cy="140" r="46" fill="${bg}" opacity="0"/>
<path d="M22 120 Q22 96 60 96 Q98 96 98 120Z" fill="#F6F3EA" opacity=".9"/>
${back}
<circle cx="24" cy="66" r="7" fill="${skin}"/><circle cx="96" cy="66" r="7" fill="${skin}"/>
<circle cx="60" cy="64" r="34" fill="${skin}"/>
${front}
${eyes(e)}
<circle cx="40" cy="72" r="4.5" fill="#E8735A" opacity=".35"/><circle cx="80" cy="72" r="4.5" fill="#E8735A" opacity=".35"/>
${mouth(m)}
</svg>`;
	fs.writeFileSync(path.join(out, `f${String(i + 1).padStart(2, '0')}.svg`), svg);
}
console.log('avatars written: 24');
