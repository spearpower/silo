// Usage: node tools/gen_icon.js public/icons/icon.svg  (then render the PNGs: node tools/render_icons.js)
// PicknPlay app icon as SVG (full-bleed so it also works as a maskable icon): a fanned Ace of Spades
// and 7 of Hearts on green felt, with the PicknPlay name.
const fs = require('fs');
const out = process.argv[2] || 'public/icons/icon.svg';
const SERIF = `Georgia,'Times New Roman',serif`;
const SANS = `ui-rounded,'SF Pro Rounded','Arial Rounded MT Bold','Segoe UI',Roboto,Helvetica,Arial,sans-serif`;
const SPADE = 'M0 -40 C18 -18 40 -4 40 14 C40 30 24 38 10 30 C14 40 18 48 24 54 L-24 54 C-18 48 -14 40 -10 30 C-24 38 -40 30 -40 14 C-40 -4 -18 -18 0 -40 Z';
const HEART = 'M0 40 C-22 20 -42 4 -42 -14 C-42 -30 -28 -40 -14 -38 C-6 -37 -2 -32 0 -26 C2 -32 6 -37 14 -38 C28 -40 42 -30 42 -14 C42 4 22 20 0 40 Z';
const card = (x, y, rot, rank, suitPath, color) => `
<g transform="translate(${x} ${y}) rotate(${rot})">
  <rect x="-84" y="-118" width="168" height="236" rx="18" fill="#FFFDF7" stroke="#0A3F29" stroke-width="3"/>
  <text x="-58" y="-74" text-anchor="middle" font-family="${SERIF}" font-weight="700" font-size="44" fill="${color}">${rank}</text>
  <g transform="translate(0 12) scale(1.25)"><path d="${suitPath}" fill="${color}"/></g>
</g>`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
<defs><radialGradient id="f" cx="50%" cy="40%" r="75%"><stop offset="0" stop-color="#16804F"/><stop offset="1" stop-color="#083D27"/></radialGradient></defs>
<rect width="512" height="512" fill="url(#f)"/>
${card(200, 236, -13, 'A', SPADE, '#111')}
${card(316, 236, 13, '7', HEART, '#C8102E')}
<text x="256" y="452" text-anchor="middle" font-family="${SANS}" font-weight="900" font-size="66" fill="#F2C14E" letter-spacing="1">PicknPlay</text>
</svg>`;
fs.writeFileSync(out, svg);
console.log('icon written');
