// Usage: node tools/gen_cards.js public/cards
// Draws PicknPlay's own card art that the public-domain English-pattern deck doesn't include:
// the two Jokers (XR red, XB black) and the card back. Same 360×540 rounded card as the deck.
// The 52 face cards themselves come from Wikimedia Commons ("English pattern <rank> of <suit>.svg",
// CC0 / public domain) — see tools/fetch_cards.sh and the README credits.
const fs = require('fs');
const path = require('path');
const out = process.argv[2] || 'public/cards';
fs.mkdirSync(out, { recursive: true });

const FONT = `Georgia,'Times New Roman',serif`;
const frame = inner => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 540" width="360" height="540">
<rect x="0.5" y="0.5" width="359" height="539" rx="30" ry="30" fill="#fff" stroke="#000" stroke-width="1"/>
${inner}
</svg>`;

/** A jester's cap with three bells: the Joker picture. */
const cap = (main, alt) => `
<g transform="translate(180 282) scale(0.8)">
  <path d="M-92 52 C-96 -10 -120 -60 -150 -86 C-100 -86 -60 -50 -40 -6 C-40 -60 -20 -110 0 -132 C20 -110 40 -60 40 -6 C60 -50 100 -86 150 -86 C120 -60 96 -10 92 52 Z" fill="${main}" stroke="#111" stroke-width="3" stroke-linejoin="round"/>
  <path d="M-40 -6 C-30 20 30 20 40 -6 L40 52 L-40 52 Z" fill="${alt}" opacity=".9"/>
  <rect x="-100" y="46" width="200" height="34" rx="10" fill="#F2C14E" stroke="#111" stroke-width="3"/>
  <g fill="#F2C14E" stroke="#111" stroke-width="3">
    <circle cx="-150" cy="-86" r="14"/><circle cx="0" cy="-132" r="14"/><circle cx="150" cy="-86" r="14"/>
  </g>
  <g fill="#111"><circle cx="-60" cy="63" r="6"/><circle cx="-20" cy="63" r="6"/><circle cx="20" cy="63" r="6"/><circle cx="60" cy="63" r="6"/></g>
  <path d="M-58 120 Q0 160 58 120" fill="none" stroke="${main}" stroke-width="8" stroke-linecap="round"/>
</g>`;

const star = (x, y, r, fill) => {
	const pts = [];
	for (let i = 0; i < 10; i++) {
		const a = (Math.PI / 5) * i - Math.PI / 2, rr = i % 2 ? r * 0.45 : r;
		pts.push(`${(x + rr * Math.cos(a)).toFixed(1)},${(y + rr * Math.sin(a)).toFixed(1)}`);
	}
	return `<polygon points="${pts.join(' ')}" fill="${fill}"/>`;
};

/** "JOKER" written down the corner, as on real Jokers (and upside down in the opposite corner). */
const corner = color => {
	const letters = 'JOKER'.split('').map((ch, i) => `<text x="0" y="${i * 30}" text-anchor="middle" font-family="${FONT}" font-weight="700" font-size="30" fill="${color}">${ch}</text>`).join('');
	return `<g transform="translate(30 46)">${letters}${star(0, 160, 14, color)}</g>
<g transform="translate(330 494) rotate(180)">${letters}${star(0, 160, 14, color)}</g>`;
};

function joker(color, alt, label) {
	return frame(`${corner(color)}
<rect x="62" y="62" width="236" height="416" rx="14" fill="none" stroke="${color}" stroke-width="3"/>
${cap(color, alt)}
<text x="180" y="122" text-anchor="middle" font-family="${FONT}" font-weight="700" font-size="34" letter-spacing="4" fill="${color}">JOKER</text>
<text x="180" y="462" text-anchor="middle" font-family="${FONT}" font-style="italic" font-size="20" fill="#555">${label}</text>`);
}

function back() {
	// Felt green with a gold lattice and the PicknPlay mark
	let lattice = '';
	for (let i = -540; i <= 540; i += 36) {
		lattice += `<line x1="${i}" y1="0" x2="${i + 540}" y2="540"/><line x1="${i + 540}" y1="0" x2="${i}" y2="540"/>`;
	}
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 540" width="360" height="540">
<defs>
  <clipPath id="c"><rect x="20" y="20" width="320" height="500" rx="18"/></clipPath>
  <radialGradient id="g" cx="50%" cy="45%" r="70%"><stop offset="0" stop-color="#16804F"/><stop offset="1" stop-color="#0A3F29"/></radialGradient>
</defs>
<rect x="0.5" y="0.5" width="359" height="539" rx="30" fill="#fff" stroke="#000" stroke-width="1"/>
<rect x="20" y="20" width="320" height="500" rx="18" fill="url(#g)"/>
<g clip-path="url(#c)" stroke="#F2C14E" stroke-opacity=".28" stroke-width="2">${lattice}</g>
<rect x="20" y="20" width="320" height="500" rx="18" fill="none" stroke="#F2C14E" stroke-width="4"/>
<ellipse cx="180" cy="270" rx="96" ry="128" fill="#0A3F29" stroke="#F2C14E" stroke-width="5"/>
<text x="180" y="290" text-anchor="middle" font-family="${FONT}" font-weight="700" font-size="60" fill="#F2C14E">PnP</text>
<path d="M120 312 H240" stroke="#F2C14E" stroke-width="3"/><path d="M120 228 H240" stroke="#F2C14E" stroke-width="3"/>
</svg>`;
}

fs.writeFileSync(path.join(out, 'XR.svg'), joker('#C8102E', '#F7D1D7', 'PicknPlay'));
fs.writeFileSync(path.join(out, 'XB.svg'), joker('#111111', '#D9D9D9', 'PicknPlay'));
fs.writeFileSync(path.join(out, 'back.svg'), back());
console.log('Jokers and back written to', out);
