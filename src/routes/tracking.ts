import { Hono } from 'hono';
import { z } from 'zod';
import { EFFECTIVE_STATES, MILESTONES, PLAY_STATUSES } from '../core';
import { createDb } from '../repositories/db';
import { changePlayStatus, logMilestone } from '../services';
import { type AuthVariables, requireAuth } from './auth';

/**
 * The tracking write boundary (Stories 2.1/2.2): the play-status PATCH and the
 * milestone POST, both user-scoped behind `requireAuth` (AD-13) and
 * Zod-validated in and out (AR-26). Only the five play statuses are accepted on
 * the PATCH — clearing the status to null happens exclusively as the milestone
 * write's auto-clear inside `core/` (AR-21).
 */

const playStatusBodySchema = z.object({
	playStatus: z.enum(PLAY_STATUSES),
});

const milestoneBodySchema = z.object({
	milestone: z.enum(MILESTONES),
});

// Shared by both writes: every tracking mutation answers with the new
// effective state, and the SPA refetches the shelf for everything else.
const trackingResponseSchema = z.object({
	effectiveState: z.enum(EFFECTIVE_STATES),
});

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

	return c.json(trackingResponseSchema.parse({ effectiveState }), 200);
});

trackingRoute.post('/games/:gameId/milestones', requireAuth, async (c) => {
	const body = milestoneBodySchema.safeParse(
		await c.req.json().catch(() => null),
	);
	if (!body.success) {
		return c.json({ error: 'invalid milestone' }, 400);
	}

	// `today` is resolved here, not in `core/` — the milestone function stays
	// pure and takes the date as an input (AD-3).
	const today = new Date().toISOString().slice(0, 10);
	const effectiveState = await logMilestone(
		createDb(c.env.DB),
		c.get('userId'),
		c.req.param('gameId'),
		body.data.milestone,
		today,
	);
	if (!effectiveState) {
		return c.json({ error: 'not found' }, 404);
	}

	return c.json(trackingResponseSchema.parse({ effectiveState }), 200);
});
