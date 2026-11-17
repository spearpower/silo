import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
	resolve: {
		alias: {
			'@': path.resolve(__dirname),
			// Next.js's guard module throws outside a React Server Components bundle; tests run plain Node.
			'server-only': path.resolve(__dirname, 'tests/unit/empty.ts'),
		},
	},
	test: { include: ['tests/unit/**/*.test.ts'], environment: 'node' },
});
