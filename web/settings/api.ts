import { z } from 'zod';
import { callApi } from '../shelf/api';

/**
 * Client contract for `/api/settings` (Story 4.1). Mirrors the server shape
 * rather than importing across the SPA/Worker program boundary (same policy
 * as `web/shelf/api.ts`, whose `callApi` — status-carrying errors for the
 * query client's 401 routing — is reused here).
 */

export const settingsSchema = z.object({
	timezone: z.string().nullable(),
	// Story 8.4: a PS+ catalog refresh is running for the user's region right
	// now — feeds the header readout's "updating…" suffix. Defaulted: a
	// deploy-skewed/cached response without the field must not reject the whole
	// settings payload.
	catalogRefreshing: z.boolean().default(false),
	// Story 5.3: date (YYYY-MM-DD, user zone) of the last successful refresh,
	// null until the first one. Feeds the header "PS+ CATALOG AS OF" readout.
	psPlusRefreshedAt: z.string().nullable().default(null),
	// Story 10.1: the scheduled IGDB score refresh failed — stale scores must
	// not silently pass as current (FR-40 posture). Defaulted like its PS+
	// sibling above.
	scoresRefreshFailed: z.boolean().default(false),
	// Games needing a games-DB match (import stragglers + name-only adds) —
	// feeds the amber "enrich" banner (Story 6.2). Defaulted for the same reason.
	stragglerCount: z.number().default(0),
	// FAB placement (Story 6.3, UX-DR10). Defaulted so a cached response is safe.
	fabHandedness: z.enum(['left', 'right']).default('right'),
	// Owned PS+ claims (Story 6.4): names + gates the "I cancelled PS+" action.
	// Defaulted for the same deploy-skew reason as the fields above.
	psPlusClaimCount: z.number().default(0),
	// PSN store region the PS+ catalog is fetched for (e.g. `it-it`), null when
	// unset. Defaulted for the same deploy-skew reason as the fields above.
	region: z.string().nullable().default(null),
});

export type Settings = z.infer<typeof settingsSchema>;

export async function fetchSettings(signal?: AbortSignal): Promise<Settings> {
	return settingsSchema.parse(await callApi('/api/settings', { signal }));
}

/** Move the FAB to the left/right hand (Story 6.3, UX-DR10). */
export async function saveFabHandedness(
	handedness: 'left' | 'right',
): Promise<void> {
	await callApi('/api/settings/fab-handedness', {
		method: 'PUT',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ handedness }),
	});
}

/**
 * "I cancelled PS+" (Story 6.4 AC4): un-own every PS+ claim, purchases
 * untouched. Resolves to the count actually un-owned.
 */
export async function cancelPsPlus(): Promise<{ unowned: number }> {
	const body = await callApi('/api/settings/cancel-ps-plus', {
		method: 'POST',
	});
	return z.object({ unowned: z.number() }).parse(body);
}

/** Save the PSN store region (e.g. `it-it`) the PS+ catalog is fetched for. */
export async function savePsnRegion(region: string): Promise<void> {
	await callApi('/api/settings/psn-region', {
		method: 'PUT',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ region }),
	});
}
