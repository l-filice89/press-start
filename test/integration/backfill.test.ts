import { applyD1Migrations, env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import {
	deleteSetting,
	getSetting,
	getTracking,
	insertGame,
	setSetting,
	upsertTracking,
} from '../../src/repositories';
import { createDb } from '../../src/repositories/db';
import { game, gameTracking, user } from '../../src/schema';
import {
	PSN_AUTH_EXPIRED,
	PSN_AUTH_SETTING_KEY,
	PSN_NPSSO_SETTING_KEY,
	TIMEZONE_SETTING_KEY,
} from '../../src/services/settings';
import { ALLOWED_EMAIL, appFetch, establishSession } from './session';

/**
 * Platinum-date backfill integration (Story 9.3) against the real Worker +
 * local D1, with the outbound PSN calls stubbed with the CAPTURED wire shape
 * (probe run 2026-07-13). The hazard rows: the UTC instant is converted in the
 * USER'S ZONE (a slice of the ISO string misdates a late-evening platinum),
 * write-once holds (a game that already carries a date is not even a
 * candidate), the run is idempotent, a 404 title is skipped WITHOUT stalling
 * the cursor, the chunk is bounded and the cursor PARTITIONS the candidates, a
 * user with no timezone is refused rather than misdated, and a failure — before
 * the first title or half way through one — reports exactly the rows it wrote
 * (nothing rolls back: `platinum_on` is write-once).
 */

const db = () => createDb(env.DB);
const realFetch = globalThis.fetch;

/** UTC 18:30 → the NEXT day in +12: the whole point of the zone conversion. */
const PLATINUM_INSTANT = '2026-07-06T18:30:27Z';
const LOCAL_DATE_NZ = '2026-07-07';

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' },
	});

/** The captured detail payload: the platinum plus an unearned trophy. */
const detailPayload = (earnedDateTime: string | null) =>
	json({
		trophies: [
			{
				trophyId: 3,
				trophyHidden: false,
				earned: false,
				trophyType: 'gold',
				trophyRare: 2,
				trophyEarnedRate: '20.1',
			},
			{
				trophyId: 0,
				trophyHidden: false,
				earned: earnedDateTime !== null,
				...(earnedDateTime ? { earnedDateTime } : {}),
				trophyType: 'platinum',
				trophyRare: 1,
				trophyEarnedRate: '5.4',
			},
		],
		totalItemCount: 2,
	});

/** Stubs the NPSSO→bearer exchange; `detail` answers every trophy-host call. */
function stubPsn(detail: (url: string) => Response) {
	vi.stubGlobal(
		'fetch',
		async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input instanceof Request ? input.url : input);
			if (
				url.startsWith(
					'https://ca.account.sony.com/api/authz/v3/oauth/authorize',
				)
			) {
				return new Response(null, {
					status: 302,
					headers: {
						location:
							'com.scee.psxandroid.scecompcall://redirect?code=test-auth-code',
					},
				});
			}
			if (
				url.startsWith('https://ca.account.sony.com/api/authz/v3/oauth/token')
			) {
				return json({ access_token: 'test-bearer' });
			}
			if (!url.startsWith('https://m.np.playstation.com/')) {
				return realFetch(input, init);
			}
			return detail(url);
		},
	);
}

interface BackfillBody {
	filled: { gameId: string; title: string; date: string }[];
	skipped: { title: string; reason: string; code: string }[];
	nextCursor: string | null;
	hasTrophyData: boolean;
}

/** A FAILED chunk still reports the rows it wrote before it died. */
interface BackfillFailure {
	error: string;
	partial?: BackfillBody;
}

const postBackfill = (cookie: string, cursor?: string) =>
	appFetch(
		`/api/backfill/platinum-dates${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
		{ method: 'POST', headers: { cookie } },
	);

let cookie: string;
let userId: string;
let titleSeq = 0;

beforeAll(async () => {
	await applyD1Migrations(env.DB, inject('migrations'));
	cookie = await establishSession();
	const [row] = await db()
		.select({ id: user.id })
		.from(user)
		.where(eq(user.email, ALLOWED_EMAIL));
	userId = row.id;
	await setSetting(db(), userId, PSN_NPSSO_SETTING_KEY, 'test-psn-npsso');
	// The captured instant lands on the NEXT calendar day in this zone.
	await setSetting(db(), userId, TIMEZONE_SETTING_KEY, 'Pacific/Auckland');
});

/**
 * Storage is NOT rolled back between tests here, and an UNFILLABLE candidate (a
 * 404'd title, one with no date) stays a candidate by design — it would leak
 * into the next test's chunk. Every test drops the rows it seeded.
 */
const seeded: string[] = [];

afterEach(async () => {
	vi.unstubAllGlobals();
	for (const gameId of seeded.splice(0)) {
		await db().delete(gameTracking).where(eq(gameTracking.gameId, gameId));
		await db().delete(game).where(eq(game.id, gameId));
	}
});

/**
 * A tracked game the trophy sync (9.2) has already stamped with an EARNED
 * platinum — the candidate shape. `dates` seeds any milestone already on the
 * row (the write-once rows).
 */
async function platinumGame(
	npCommId: string,
	dates: {
		completedOn?: string;
		platinumOn?: string;
		/** The title's PSN trophy service: `trophy` (PS4) / `trophy2` (PS5), or
		 * null for a row 9.2 wrote before the column existed. */
		trophyNpServiceName?: string | null;
	} = {},
) {
	const title = `Backfill Game ${++titleSeq}`;
	const created = await insertGame(db(), {
		title,
		titleNormalized: title.toLowerCase(),
	});
	seeded.push(created.id);
	await upsertTracking(db(), userId, created.id, {
		owned: true,
		trophyNpCommId: npCommId,
		trophyNpServiceName: 'trophy2',
		trophyEarnedBronze: 40,
		trophyEarnedSilver: 12,
		trophyEarnedGold: 6,
		trophyEarnedPlatinum: 1,
		trophyDefinedBronze: 40,
		trophyDefinedSilver: 12,
		trophyDefinedGold: 6,
		trophyDefinedPlatinum: 1,
		trophySyncedAt: '2026-07-13',
		...dates,
	});
	return { id: created.id, title, npCommId };
}

describe('POST /api/backfill/platinum-dates (integration, real workerd + local D1)', () => {
	it('requires auth', async () => {
		expect(
			(await appFetch('/api/backfill/platinum-dates', { method: 'POST' }))
				.status,
		).toBe(401);
	});

	it("fills platinum_on from PSN's UTC instant in the USER'S ZONE, and completed_on with it (hazard: slicing the ISO string misdates an evening platinum)", async () => {
		const game = await platinumGame('NPWR11111_00');

		stubPsn(() => detailPayload(PLATINUM_INSTANT));
		const res = await postBackfill(cookie);
		expect(res.status).toBe(200);
		const body = (await res.json()) as BackfillBody;
		expect(body).toEqual({
			filled: [{ gameId: game.id, title: game.title, date: LOCAL_DATE_NZ }],
			skipped: [],
			nextCursor: null,
			hasTrophyData: true,
		});

		const after = await getTracking(db(), userId, game.id);
		// 18:30Z is the 7th in +12 — NOT the '2026-07-06' a string slice yields.
		expect(after?.platinumOn).toBe(LOCAL_DATE_NZ);
		// The BACKFILL-ONLY completion heuristic.
		expect(after?.completedOn).toBe(LOCAL_DATE_NZ);
		// No other lifecycle date is invented.
		expect(after?.startedOn).toBeNull();
		expect(after?.boughtOn).toBeNull();
	});

	it('is IDEMPOTENT: the second run finds no candidates and fills nothing (hazard: a re-run must not re-date anything)', async () => {
		await platinumGame('NPWR22222_00');

		stubPsn(() => detailPayload(PLATINUM_INSTANT));
		expect(
			((await (await postBackfill(cookie)).json()) as BackfillBody).filled,
		).not.toHaveLength(0);
		vi.unstubAllGlobals();

		// A second run must not even CALL PSN — the rows are no longer candidates.
		stubPsn(() => {
			throw new Error('the backfill re-fetched an already-filled title');
		});
		const body = (await (await postBackfill(cookie)).json()) as BackfillBody;
		expect(body).toEqual({
			filled: [],
			skipped: [],
			nextCursor: null,
			// The trophy sync HAS run for this user — "nothing left to recover", not
			// "nothing to recover FROM" (the UI says different things).
			hasTrophyData: true,
		});
	});

	it('leaves a game that ALREADY carries platinum_on untouched, even when PSN disagrees (hazard: write-once)', async () => {
		const stamped = await platinumGame('NPWR33333_00', {
			platinumOn: '2020-01-01',
		});
		// Half-filled: the first value stands and the heuristic never back-writes
		// completed_on onto a game the user already touched.
		const halfFilled = await platinumGame('NPWR44444_00', {
			platinumOn: '2019-05-05',
		});

		stubPsn(() => detailPayload(PLATINUM_INSTANT));
		const body = (await (await postBackfill(cookie)).json()) as BackfillBody;
		expect(body.filled).toEqual([]);

		expect((await getTracking(db(), userId, stamped.id))?.platinumOn).toBe(
			'2020-01-01',
		);
		const after = await getTracking(db(), userId, halfFilled.id);
		expect(after?.platinumOn).toBe('2019-05-05');
		expect(after?.completedOn).toBeNull();
	});

	it('SKIPS a title PSN 404s and keeps going (hazard: one delisted title must not abort the run or stall the cursor)', async () => {
		const dead = await platinumGame('NPWR00000_00');
		const alive = await platinumGame('NPWR55555_00');

		stubPsn((url) =>
			url.includes('NPWR00000_00')
				? json({ error: { message: 'Resource not found' } }, 404)
				: detailPayload(PLATINUM_INSTANT),
		);
		const res = await postBackfill(cookie);
		expect(res.status).toBe(200);
		const body = (await res.json()) as BackfillBody;

		expect(body.filled).toEqual([
			{ gameId: alive.id, title: alive.title, date: LOCAL_DATE_NZ },
		]);
		expect(body.skipped).toMatchObject([
			{ title: dead.title, code: 'not-found' },
		]);
		// The 404'd row stays unfilled — and stays a candidate — but the run
		// completed and reported it, rather than dying or looping on it.
		expect((await getTracking(db(), userId, dead.id))?.platinumOn).toBeNull();
	});

	it("calls the detail endpoint with the TITLE'S OWN npServiceName — `trophy` for a PS4 title, `trophy2` for a PS5 one (hazard: a pinned `trophy2` 404s every PS3/PS4/Vita platinum, and the backfill would report them delisted)", async () => {
		const ps4 = await platinumGame('NPWR12112_00', {
			trophyNpServiceName: 'trophy',
		});
		const ps5 = await platinumGame('NPWR30984_00', {
			trophyNpServiceName: 'trophy2',
		});

		// The LIVE behaviour: PSN 404s the wrong service name for a title.
		const services = new Map([
			['NPWR12112_00', 'trophy'],
			['NPWR30984_00', 'trophy2'],
		]);
		stubPsn((url) => {
			const npCommId = [...services.keys()].find((id) => url.includes(id));
			return url.includes(`npServiceName=${services.get(npCommId ?? '')}&`)
				? detailPayload(PLATINUM_INSTANT)
				: json({ error: { message: 'Resource not found' } }, 404);
		});

		const body = (await (await postBackfill(cookie)).json()) as BackfillBody;
		expect(body.skipped).toEqual([]);
		expect(body.filled.map((item) => item.gameId).sort()).toEqual(
			[ps4.id, ps5.id].sort(),
		);
		expect((await getTracking(db(), userId, ps4.id))?.platinumOn).toBe(
			LOCAL_DATE_NZ,
		);
		expect((await getTracking(db(), userId, ps5.id))?.platinumOn).toBe(
			LOCAL_DATE_NZ,
		);
	});

	it('a title that PSN PERMANENTLY FAILS on is skipped, not fatal — every candidate BEHIND it still gets filled (hazard: aborting the chunk strands every higher game_id forever)', async () => {
		const games = [];
		for (let i = 0; i < 3; i++) {
			games.push(await platinumGame(`NPWR7${String(i).padStart(4, '0')}_00`));
		}
		const byId = [...games].sort((a, b) => (a.id < b.id ? -1 : 1));

		// The FIRST candidate 5xxs on every attempt. Ordered by game_id, it would
		// otherwise be hit first on every re-run — a permanent wall.
		stubPsn((url) =>
			url.includes(byId[0].npCommId)
				? json({ error: { message: 'Internal Server Error' } }, 503)
				: detailPayload(PLATINUM_INSTANT),
		);
		const res = await postBackfill(cookie);
		expect(res.status).toBe(200);
		const body = (await res.json()) as BackfillBody;

		expect(body.skipped).toMatchObject([
			{ title: byId[0].title, code: 'error' },
		]);
		// The reason reaches the summary, so the user is not left with a silent gap.
		expect(body.skipped[0].reason).toMatch(/503/);
		expect(body.filled.map((item) => item.gameId)).toEqual([
			byId[1].id,
			byId[2].id,
		]);
		expect(
			(await getTracking(db(), userId, byId[0].id))?.platinumOn,
		).toBeNull();
		expect((await getTracking(db(), userId, byId[2].id))?.platinumOn).toBe(
			LOCAL_DATE_NZ,
		);
	});

	it('skips a title with no earned platinum date on record (reported, cursor advances)', async () => {
		const dateless = await platinumGame('NPWR66666_00');

		stubPsn(() => detailPayload(null));
		const body = (await (await postBackfill(cookie)).json()) as BackfillBody;
		expect(body.filled).toEqual([]);
		// `no-date` — NOT `not-found`: the UI tells those two endings apart.
		expect(body.skipped).toMatchObject([
			{ title: dateless.title, code: 'no-date' },
		]);
		expect(
			(await getTracking(db(), userId, dateless.id))?.platinumOn,
		).toBeNull();
	});

	it('CHUNKS the fan-out and PARTITIONS the candidates exactly: chunk two starts where chunk one stopped, no row seen twice, none skipped over (hazard: 53 titles vs a 50-subrequest ceiling)', async () => {
		// One more than the chunk size (15) — the run cannot fit in one request.
		const created = [];
		for (let i = 0; i < 16; i++) {
			created.push(await platinumGame(`NPWR8${String(i).padStart(4, '0')}_00`));
		}
		// The candidate query pages on game_id, ascending — the partition to pin.
		const byId = [...created].sort((a, b) => (a.id < b.id ? -1 : 1));

		const fetched: string[] = [];
		stubPsn((url) => {
			fetched.push(url);
			return detailPayload(PLATINUM_INSTANT);
		});
		const first = (await (await postBackfill(cookie)).json()) as BackfillBody;
		// The chunk is BOUNDED: 15 per-title calls, never one per candidate row.
		expect(fetched).toHaveLength(15);
		expect(first.filled.map((item) => item.gameId)).toEqual(
			byId.slice(0, 15).map((game) => game.id),
		);
		expect(first.nextCursor).toBe(byId[14].id);

		const second = (await (
			await postBackfill(cookie, first.nextCursor as string)
		).json()) as BackfillBody;
		// The cursor PAGED PAST the 15 already seen and picked up the 16th — not a
		// row earlier, not a row later.
		expect(second.filled.map((item) => item.gameId)).toEqual([byId[15].id]);
		expect(second.nextCursor).toBeNull();
		// 16 detail calls in total: no candidate was fetched twice.
		expect(fetched).toHaveLength(16);
		expect(new Set(fetched).size).toBe(16);

		// Every seeded game ended up dated, across the two chunks.
		for (const game of created) {
			expect((await getTracking(db(), userId, game.id))?.platinumOn).toBe(
				LOCAL_DATE_NZ,
			);
		}
	});

	it('an expired NPSSO on the FIRST title answers 401, persists psn_auth=expired, and writes nothing (hazard: one attempt, no retry)', async () => {
		const game = await platinumGame('NPWR77777_00');

		stubPsn(() => json({ error: { message: 'Invalid token' } }, 401));
		const res = await postBackfill(cookie);
		expect(res.status).toBe(401);
		const body = (await res.json()) as BackfillFailure;
		expect(body.error).toMatch(/expired/);
		expect(body.partial).toMatchObject({ filled: [], skipped: [] });
		expect(await getSetting(db(), userId, PSN_AUTH_SETTING_KEY)).toBe(
			PSN_AUTH_EXPIRED,
		);
		expect((await getTracking(db(), userId, game.id))?.platinumOn).toBeNull();
	});

	it('a MID-CHUNK failure reports the rows it ALREADY WROTE and a cursor at the title that failed (hazard: platinum_on is write-once — those dates are permanent, and "wrote nothing" would be a lie)', async () => {
		const games = [];
		for (let i = 0; i < 4; i++) {
			games.push(await platinumGame(`NPWR9${String(i).padStart(4, '0')}_00`));
		}
		const byId = [...games].sort((a, b) => (a.id < b.id ? -1 : 1));

		// The THIRD candidate 401s — the first two are already stamped by then.
		stubPsn((url) =>
			url.includes(byId[2].npCommId)
				? json({ error: { message: 'Invalid token' } }, 401)
				: detailPayload(PLATINUM_INSTANT),
		);
		const res = await postBackfill(cookie);
		expect(res.status).toBe(401);
		const body = (await res.json()) as BackfillFailure;

		expect(body.partial?.filled.map((item) => item.gameId)).toEqual([
			byId[0].id,
			byId[1].id,
		]);
		// The cursor resumes AT the candidate that failed (it is `after`-exclusive,
		// so it names the last row that succeeded).
		expect(body.partial?.nextCursor).toBe(byId[1].id);
		expect(await getSetting(db(), userId, PSN_AUTH_SETTING_KEY)).toBe(
			PSN_AUTH_EXPIRED,
		);
		// And the writes really did stand — nothing was rolled back.
		expect((await getTracking(db(), userId, byId[0].id))?.platinumOn).toBe(
			LOCAL_DATE_NZ,
		);
		expect(
			(await getTracking(db(), userId, byId[2].id))?.platinumOn,
		).toBeNull();
		await deleteSetting(db(), userId, PSN_AUTH_SETTING_KEY);
	});

	it('REFUSES the run with 409 when the user has no timezone (hazard: a UTC-guessed date on a WRITE-ONCE column can never be corrected)', async () => {
		const game = await platinumGame('NPWR12121_00');
		await deleteSetting(db(), userId, TIMEZONE_SETTING_KEY);

		stubPsn(() => {
			throw new Error('the backfill called PSN without a timezone');
		});
		try {
			const res = await postBackfill(cookie);
			expect(res.status).toBe(409);
			expect(((await res.json()) as { error: string }).error).toMatch(
				/timezone/i,
			);
			expect((await getTracking(db(), userId, game.id))?.platinumOn).toBeNull();
		} finally {
			await setSetting(db(), userId, TIMEZONE_SETTING_KEY, 'Pacific/Auckland');
		}
	});

	it('reports hasTrophyData=false when the trophy sync has never run (hazard: "every platinum already carries its date" is false with no trophy data at all)', async () => {
		// Nothing seeded: no candidate, and no trophy row anywhere on the account.
		const body = (await (await postBackfill(cookie)).json()) as BackfillBody;
		expect(body).toEqual({
			filled: [],
			skipped: [],
			nextCursor: null,
			hasTrophyData: false,
		});
	});
});
