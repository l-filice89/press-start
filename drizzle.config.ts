import { defineConfig } from 'drizzle-kit';

/**
 * `drizzle-kit generate` emits versioned SQL from `src/schema/` into
 * `migrations/`. Migrations are applied via `wrangler d1 migrations apply`
 * (CI/CD or local CLI) — never at Worker startup (AD-16).
 */
export default defineConfig({
	dialect: 'sqlite',
	schema: './src/schema/index.ts',
	out: './migrations',
});
