import postgres from 'postgres';

// One pooled client per server instance, created on first use (so `next build` works without a DB).
// On Vercel use Supabase's *transaction pooler* URL (port 6543); prepared statements must be off for it.
type Sql = ReturnType<typeof postgres>;

declare global {
	// eslint-disable-next-line no-var
	var __picknplaySql: Sql | undefined;
}

function make(): Sql {
	const url = process.env.DATABASE_URL;
	if (!url) throw new Error('DATABASE_URL is not set (see .env.example)');
	const local = /localhost|127\.0\.0\.1/.test(url);
	return postgres(url, {
		max: local ? 5 : 3,
		prepare: false,
		idle_timeout: 20,
		connect_timeout: 10,
		ssl: local ? false : 'require',
		// ids are bigint in Postgres; they stay far below 2^53, so return plain numbers
		types: { bigint: { to: 20, from: [20], serialize: (x: number) => String(x), parse: (x: string) => Number(x) } },
		transform: { undefined: null },
	});
}

function client(): Sql {
	return globalThis.__picknplaySql ?? (globalThis.__picknplaySql = make());
}

/** Lazy proxy: behaves exactly like the postgres.js `sql` tag. */
export const sql: Sql = new Proxy(function () {} as unknown as Sql, {
	apply: (_t, _this, args) => (client() as unknown as (...a: unknown[]) => unknown)(...args),
	get: (_t, prop) => {
		const c = client() as unknown as Record<string | symbol, unknown>;
		const v = c[prop];
		return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(c) : v;
	},
});
