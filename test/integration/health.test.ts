import {
	applyD1Migrations,
	createExecutionContext,
	env,
	waitOnExecutionContext,
} from 'cloudflare:test';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import worker from '../../worker/index';

describe('GET /api/health (integration, real workerd + local D1 — AR-1/AR-2)', () => {
	beforeAll(async () => {
		await applyD1Migrations(env.DB, inject('migrations'));
	});

	it('returns HTTP 200 with { status: "ok" } — not the SPA fallback', async () => {
		const request = new Request('http://example.com/api/health');
		const ctx = createExecutionContext();

		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toContain('application/json');
		expect(await response.json()).toEqual({ status: 'ok' });
	});
});
