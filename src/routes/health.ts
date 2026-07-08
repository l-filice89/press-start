import { Hono } from 'hono';
import { z } from 'zod';

/**
 * Zod response schema for GET /api/health — establishes the "Zod at every
 * boundary" pattern (AR-26) even for this trivial route.
 */
const healthResponseSchema = z.object({
	status: z.literal('ok'),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const healthRoute = new Hono<{ Bindings: Env }>();

healthRoute.get('/health', (c) => {
	const body = healthResponseSchema.parse({
		status: 'ok',
	} satisfies HealthResponse);
	return c.json(body, 200);
});
