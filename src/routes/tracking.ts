import { Hono } from 'hono';
import { z } from 'zod';
import {
	EFFECTIVE_STATES,
	type LIFECYCLE_DATE_FIELDS,
	MILESTONES,
	OWNERSHIP_TYPES,
	PLAY_STATUSES,
} from '../core';
import { createDb } from '../repositories/db';
import {
	changeOwnership,
	changePlayStatus,
	editDates,
	logMilestone,
	todayForUser,
} from '../services';
import { type AuthVariables, requireAuth } from './auth';

/**
 * The tracking write boundary (Stories 2.1/2.2/2.4): the play-status,
 * ownership, and lifecycle-dates PATCHes and the milestone POST, all
 * user-scoped behind `requireAuth` (AD-13) and Zod-validated in and out
 * (AR-26). The play-status PATCH accepts the five play statuses or `null`
 * (Story 2.3: clear) — clearing is refused with 409 when it would violate the
 * completion invariant (FR-3/AR-12), decided in `services/`; a date edit that
 * would clear the last milestone of a status-less game gets the same 409.
 */

const playStatusBodySchema = z.object({
	playStatus: z.enum(PLAY_STATUSES).nullable(),
});

const milestoneBodySchema = z.object({
	milestone: z.enum(MILESTONES),
});

const ownershipBodySchema = z
	.object({
		owned: z.boolean().optional(),
		ownershipType: z.enum(OWNERSHIP_TYPES).optional(),
	})
	.refine(
		(body) => body.owned !== undefined || body.ownershipType !== undefined,
		{ message: 'at least one key required' },
	);

// Shape only (`YYYY-MM-DD` or null, at least one of the five keys) — calendar
// validity (2024-13-99) is `core/`'s call, surfaced as the same 400.
const isoDateShape = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/)
	.nullable()
	.optional();
const dateEditsBodySchema = z
	.object({
		wishlistedOn: isoDateShape,
		boughtOn: isoDateShape,
		startedOn: isoDateShape,
		completedOn: isoDateShape,
		platinumOn: isoDateShape,
	} satisfies Record<
		(typeof LIFECYCLE_DATE_FIELDS)[number],
		typeof isoDateShape
	>)
	.refine((body) => Object.values(body).some((value) => value !== undefined), {
		message: 'at least one date key required',
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

	const db = createDb(c.env.DB);
	const userId = c.get('userId');
	// `today` is resolved here in the user's timezone (Epic 2 retro policy),
	// not in `core/` — the transition function stays pure (AD-3).
	const today = await todayForUser(db, userId);
	const effectiveState = await changePlayStatus(
		db,
		userId,
		c.req.param('gameId'),
		body.data.playStatus,
		today,
	);
	if (effectiveState === 'invariant') {
		return c.json({ error: 'completion invariant' }, 409);
	}
	if (!effectiveState) {
		return c.json({ error: 'not found' }, 404);
	}

	return c.json(trackingResponseSchema.parse({ effectiveState }), 200);
});

trackingRoute.patch('/games/:gameId/ownership', requireAuth, async (c) => {
	const body = ownershipBodySchema.safeParse(
		await c.req.json().catch(() => null),
	);
	if (!body.success) {
		return c.json({ error: 'invalid ownership change' }, 400);
	}

	const db = createDb(c.env.DB);
	const userId = c.get('userId');
	// `today` is resolved here in the user's timezone (Epic 2 retro policy),
	// not in `core/` — the ownership function stays pure (AD-3).
	const today = await todayForUser(db, userId);
	const effectiveState = await changeOwnership(
		db,
		userId,
		c.req.param('gameId'),
		body.data,
		today,
	);
	if (effectiveState === 'invalid') {
		// A type on an un-owned game (the type belongs to an owned game).
		return c.json({ error: 'invalid ownership change' }, 400);
	}
	if (!effectiveState) {
		return c.json({ error: 'not found' }, 404);
	}

	return c.json(trackingResponseSchema.parse({ effectiveState }), 200);
});

trackingRoute.patch('/games/:gameId/dates', requireAuth, async (c) => {
	const body = dateEditsBodySchema.safeParse(
		await c.req.json().catch(() => null),
	);
	if (!body.success) {
		return c.json({ error: 'invalid date edit' }, 400);
	}

	const effectiveState = await editDates(
		createDb(c.env.DB),
		c.get('userId'),
		c.req.param('gameId'),
		body.data,
	);
	if (effectiveState === 'invalid') {
		return c.json({ error: 'invalid date edit' }, 400);
	}
	if (effectiveState === 'invariant') {
		return c.json({ error: 'completion invariant' }, 409);
	}
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

	const db = createDb(c.env.DB);
	const userId = c.get('userId');
	// `today` is resolved here in the user's timezone (Epic 2 retro policy),
	// not in `core/` — the milestone function stays pure (AD-3).
	const today = await todayForUser(db, userId);
	const effectiveState = await logMilestone(
		db,
		userId,
		c.req.param('gameId'),
		body.data.milestone,
		today,
	);
	if (!effectiveState) {
		return c.json({ error: 'not found' }, 404);
	}

	return c.json(trackingResponseSchema.parse({ effectiveState }), 200);
});
