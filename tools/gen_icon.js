// Silo app icon (SVG). Usage: node tools/gen_icon.js   -> public/icons/icon.svg + mask.svg
// Then render the PNG sizes with: node tools/render_icons.js (uses the locally installed Chrome).
// Mark: a rounded speech bubble whose inner shape is a silo (cylinder + dome) in Stone Blue, with a Scarlet
// signal dot, on Egyptian Blue. Full-bleed, so it also works as a maskable icon.
const fs = require('fs');
const path = require('path');

const EGYPTIAN = '#03203D', STONE = '#639CC5', SCARLET = '#E32F33';

function mark({ bg = true } = {}) {
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
${bg ? `<rect width="512" height="512" fill="${EGYPTIAN}"/>
<circle cx="256" cy="256" r="236" fill="#0A2E52"/>` : ''}
<path d="M256 104c-88 0-156 58-156 136 0 41 19 77 50 102l-14 58c-2 8 7 14 14 10l66-36c13 3 26 4 40 4 88 0 156-58 156-138S344 104 256 104Z" fill="#FFFFFF"/>
<path d="M210 330V218c0-26 21-48 46-48s46 22 46 48v112z" fill="${STONE}"/>
<path d="M210 250h92M210 290h92" stroke="${EGYPTIAN}" stroke-width="10" stroke-linecap="round" opacity=".35"/>
<circle cx="338" cy="166" r="22" fill="${SCARLET}"/>
</svg>`;
}

const out = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'icon.svg'), mark());
console.log('public/icons/icon.svg written');
