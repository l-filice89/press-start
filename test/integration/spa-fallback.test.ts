import {
	createExecutionContext,
	env,
	waitOnExecutionContext,
} from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../../worker/index';

/**
 * Regression coverage for the "SPA deep link" I/O scenario (DW-1): the
 * `app.all('*')` fallback in `worker/index.ts` forwards any non-`/api/*`
 * route to `env.ASSETS.fetch`, which serves the SPA shell.
 *
 * `vitest-pool-workers` binds no `ASSETS` (no assets directory is wired into
 * `wrangler.jsonc` for tests, and doing so would risk the `@cloudflare/vite-plugin`
 * production build). So we hand the Worker a test-only stub `ASSETS` at call
 * time — `{ ...env, ASSETS: spy }` — which is enough to exercise the Worker's
 * own routing decision (deep route → ASSETS, `/api/*` → JSON, never ASSETS)
 * without touching any production config.
 */

const SPA_SHELL = '<!doctype html><title>PRESS START</title>';

function makeAssetsSpy() {
	const spy = {
		calls: 0,
		lastUrl: '' as string,
		fetch: async (request: Request) => {
			spy.calls++;
			spy.lastUrl = request.url;
			return new Response(SPA_SHELL, {
				status: 200,
				headers: { 'content-type': 'text/html' },
			});
		},
	};
	return spy;
}

async function fetchWith(
	assets: ReturnType<typeof makeAssetsSpy>,
	request: Request,
) {
	const ctx = createExecutionContext();
	const response = await worker.fetch(request, { ...env, ASSETS: assets }, ctx);
	await waitOnExecutionContext(ctx);
	return response;
}

describe('SPA deep-link ASSETS fallback (integration, real workerd — DW-1)', () => {
	it('falls through a non-/api/* deep client route to the ASSETS SPA shell', async () => {
		const assets = makeAssetsSpy();
		const response = await fetchWith(
			assets,
			new Request('http://example.com/shelf/some/deep/route'),
		);

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toContain('text/html');
		expect(await response.text()).toBe(SPA_SHELL);
		// The Worker forwarded the original request to ASSETS exactly once.
		expect(assets.calls).toBe(1);
		expect(assets.lastUrl).toBe('http://example.com/shelf/some/deep/route');
	});

	it('resolves a matched /api/* route to JSON without touching ASSETS', async () => {
		const assets = makeAssetsSpy();
		const response = await fetchWith(
			assets,
			new Request('http://example.com/api/health'),
		);

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toContain('application/json');
		expect(await response.json()).toEqual({ status: 'ok' });
		// API-before-fallback invariant: /api/* must never reach the SPA shell.
		expect(assets.calls).toBe(0);
	});

	it('resolves an unmatched /api/* route to 404 JSON without touching ASSETS', async () => {
		const assets = makeAssetsSpy();
		const response = await fetchWith(
			assets,
			new Request('http://example.com/api/does-not-exist'),
		);

		expect(response.status).toBe(404);
		expect(response.headers.get('content-type')).toContain('application/json');
		expect(await response.json()).toEqual({ error: 'not found' });
		// API-before-fallback invariant: even an unknown /api/* path stays JSON,
		// never the SPA shell.
		expect(assets.calls).toBe(0);
	});
});
