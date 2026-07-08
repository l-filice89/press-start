import { Hono } from 'hono';
import { z } from 'zod';
import { EFFECTIVE_STATES, PLAY_STATUSES } from '../core';
import { createDb } from '../repositories/db';
import { changePlayStatus } from '../services';
import { type AuthVariables, requireAuth } from './auth';

/**
 * The play-status write boundary (Story 2.1). One user-scoped PATCH behind
 * `requireAuth` (AD-13), Zod-validated in and out (AR-26). Only the five play
 * statuses are accepted — clearing the status to null belongs to the milestone
 * flow (Story 2.2), which must go through the invariant guard (AD-12/FR-3).
 */

const playStatusBodySchema = z.object({
	playStatus: z.enum(PLAY_STATUSES),
});

const playStatusResponseSchema = z.object({
	effectiveState: z.enum(EFFECTIVE_STATES),
});

export type PlayStatusResponse = z.infer<typeof playStatusResponseSchema>;

type TrackingEnv = { Bindings: Env; Variables: AuthVariables };

export const trackingRoute = new Hono<TrackingEnv>();

trackingRoute.patch('/games/:gameId/play-status', requireAuth, async (c) => {
	const body = playStatusBodySchema.safeParse(
		await c.req.json().catch(() => null),
	);
	if (!body.success) {
		return c.json({ error: 'invalid play status' }, 400);
	}

	// `today` is resolved here, not in `core/` — the transition function stays
	// pure and takes the date as an input (AD-3).
	const today = new Date().toISOString().slice(0, 10);
	const effectiveState = await changePlayStatus(
		createDb(c.env.DB),
		c.get('userId'),
		c.req.param('gameId'),
		body.data.playStatus,
		today,
	);
	if (!effectiveState) {
		return c.json({ error: 'not found' }, 404);
	}

	return c.json(playStatusResponseSchema.parse({ effectiveState }), 200);
});
