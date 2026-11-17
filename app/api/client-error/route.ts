import { NextResponse } from 'next/server';

// Browser errors land here and are written to the server log (Vercel -> Logs). No personal data is stored.
export async function POST(req: Request) {
	const text = (await req.text().catch(() => '')).slice(0, 4000);
	let data: Record<string, unknown> = {};
	try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 500) }; }
	console.error('[client-error]', JSON.stringify(data));
	return new NextResponse(null, { status: 204 });
}
