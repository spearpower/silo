// Usage: node tools/fetch_cards.js [public/cards] [--from <folder of already-downloaded SVGs>]
// Puts the 52 face cards in public/cards as <rank><suit>.svg (AS.svg, 10H.svg, QD.svg…).
// Source: Wikimedia Commons, "English pattern <rank> of <suit>.svg" — CC0 / public domain.
// Wikimedia rate-limits bulk downloads (HTTP 429), so files are fetched slowly and the script can be re-run;
// cards already present are skipped. The Jokers and the card back are drawn by tools/gen_cards.js.
const fs = require('fs');
const path = require('path');

const out = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'public/cards';
const fromIdx = process.argv.indexOf('--from');
const from = fromIdx > 0 ? process.argv[fromIdx + 1] : null;
const RANKS = { ace: 'A', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10', jack: 'J', queen: 'Q', king: 'K' };
const SUITS = { spades: 'S', hearts: 'H', diamonds: 'D', clubs: 'C' };
const UA = 'card-asset-fetch/1.0 (one-off asset download)';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function directUrls(titles) {
	const url = 'https://commons.wikimedia.org/w/api.php?' + new URLSearchParams({ action: 'query', prop: 'imageinfo', iiprop: 'url', format: 'json', titles: titles.join('|') });
	const d = await (await fetch(url, { headers: { 'User-Agent': UA } })).json();
	const map = {};
	for (const p of Object.values(d.query.pages)) map[p.title] = p.imageinfo[0].url;
	return map;
}

(async () => {
	fs.mkdirSync(out, { recursive: true });
	const want = [];
	for (const [sn, s] of Object.entries(SUITS)) for (const [rn, r] of Object.entries(RANKS)) want.push({ code: `${r}${s}`, file: `English_pattern_${rn}_of_${sn}.svg`, title: `File:English pattern ${rn} of ${sn}.svg` });
	const missing = want.filter(w => !fs.existsSync(path.join(out, `${w.code}.svg`)));
	// 1) copy from a local folder of downloaded originals
	if (from) for (const w of missing) {
		const src = path.join(from, w.file);
		if (fs.existsSync(src) && /<svg/.test(fs.readFileSync(src, 'utf8').slice(0, 2000))) fs.copyFileSync(src, path.join(out, `${w.code}.svg`));
	}
	const still = want.filter(w => !fs.existsSync(path.join(out, `${w.code}.svg`)));
	if (!still.length || from) { console.log(`${52 - still.length}/52 face cards in ${out}`); return; }
	// 2) download the rest, slowly
	const urls = { ...(await directUrls(still.slice(0, 26).map(w => w.title))), ...(still.length > 26 ? await directUrls(still.slice(26).map(w => w.title)) : {}) };
	for (const w of still) {
		for (let attempt = 0; attempt < 4; attempt++) {
			const res = await fetch(urls[w.title], { headers: { 'User-Agent': UA } });
			if (res.ok) { fs.writeFileSync(path.join(out, `${w.code}.svg`), Buffer.from(await res.arrayBuffer())); console.log('got', w.code); break; }
			const wait = Number(res.headers.get('retry-after') || 60) * 1000;
			console.log(`${res.status} for ${w.code}, waiting ${wait / 1000}s`);
			await sleep(wait + 5000);
		}
		await sleep(6000);
	}
})();
