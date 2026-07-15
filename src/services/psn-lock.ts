/**
 * Single-flight for the PSN long-ops (Story 9.5; deferred since Epic 4).
 *
 * The library sync, the trophy sync and the platinum backfill all fan out to
 * PSN under the SAME credential and all write the same user's rows. Run two at
 * once (two tabs, a double-click, a re-opened tab) and the account takes double
 * the PSN traffic while both runs report the same rows as written. So: ONE lock
 * per user, covering all three — a second run is refused with a message, never
 * raced.
 *
 * The lock is a `setting` row (the per-user KV store this app already has — no
 * Durable Object, no new table). Its value is `<expiry-epoch-ms>:<op>:<uuid>`:
 * the expiry drives the TTL takeover in SQL, the op names the holder for
 * `wrangler tail`, and the uuid is the ownership token, so a release can only
 * ever delete the caller's OWN lock.
 *
 * TTL-bounded on purpose: a Worker that dies mid-sync cannot run its release,
 * and a lock nobody can clear would lock the user out of syncing forever. Two
 * minutes is comfortably longer than a sync/chunk and short enough that a user
 * whose tab crashed is not left waiting.
 *
 * ponytail: the TTL is preemption, not just cleanup — there is no fence. A run
 * still alive after two minutes (PSN throttling hard) can have its lock taken
 * over, and neither run notices. Acceptable here: the ops are bounded by
 * construction (a library sync is a paged loop over one library; a backfill
 * chunk is 15 titles and renews the TTL every chunk), and the worst case is a
 * doubled
 * fan-out — not corruption, since every write is COALESCE/idempotent. If PSN
 * ever gets slow enough that this bites, add a fence: stamp the token on the
 * write path and refuse a write whose token no longer holds the lock.
 */
import { acquireLock, getSetting, releaseLock } from '../repositories';
import type { Db } from '../repositories/db';

export const PSN_LOCK_SETTING_KEY = 'psn_op_lock';

const LOCK_TTL_MS = 2 * 60 * 1000;

/**
 * `catalog-refresh` (Story 7.1) covers BOTH the PS+ membership refresh (button
 * + cron) and the genre sweep that follows it: they hit the same store host and
 * write the same snapshot, so they must not run beside each other — a sweep
 * tagging products a concurrent refresh is pruning is the corruption AD-28's
 * generation stamp exists to catch, and one lock is cheaper than catching it.
 */
export type PsnOp =
	| 'library-sync'
	| 'trophy-sync'
	| 'platinum-backfill'
	| 'catalog-refresh';

/** What the refused caller is told (shown verbatim by the UI). */
export const PSN_BUSY_MESSAGE =
	'A PlayStation sync is already running for your account — let it finish, then try again. (If you closed the tab mid-run, it clears itself within two minutes.)';

const mintToken = (op: PsnOp) =>
	`${Date.now() + LOCK_TTL_MS}:${op}:${crypto.randomUUID()}`;

/**
 * Claim the lock, or RENEW one this caller already holds.
 *
 * `heldToken` is the platinum backfill's continuation path (Story 9.3 loops the
 * endpoint on a cursor, one request per chunk, so the lock must survive across
 * requests): the client hands back the token the previous chunk gave it, and the
 * renewal is checked against the stored row in the same statement. The token —
 * not the cursor — is the proof of ownership. A cursor is a `game_id` the server
 * itself published in the response body; treating it as a capability would let
 * `?cursor=anything` overwrite a RUNNING library sync's lock and fan out to PSN
 * beside it, which is the whole hazard this file exists to close.
 *
 * Returns the NEW token when this caller holds the lock; null when it does not.
 */
export async function acquirePsnLock(
	db: Db,
	userId: string,
	op: PsnOp,
	heldToken?: string,
): Promise<string | null> {
	// A token belongs to the OP that minted it (Story 7.1 review, H2). The
	// sync/backfill routes hand their LIVE token to the browser, so without this
	// a running `platinum-backfill` token presented to the catalog endpoint would
	// pass the raw string-equality renewal check, STEAL the lock, and 409 the
	// backfill's next chunk to death. The `op` segment is authorization, not a
	// label for `wrangler tail`.
	if (heldToken && heldToken.split(':')[1] !== op) return null;
	const token = mintToken(op);
	const won = await acquireLock(
		db,
		userId,
		PSN_LOCK_SETTING_KEY,
		token,
		Date.now(),
		heldToken,
	);
	return won ? token : null;
}

export async function releasePsnLock(
	db: Db,
	userId: string,
	token: string,
): Promise<void> {
	await releaseLock(db, userId, PSN_LOCK_SETTING_KEY, token);
}

/**
 * THE FENCE (Story 7.1 review, H3). The TTL is preemption, not just cleanup: a
 * run that stalls past two minutes can have its lock taken over by the cron,
 * which then writes a whole new snapshot — and the stalled run, waking up, would
 * prune "everything that is not MY generation" and delete every row the winner
 * just wrote, emptying the table and clearing every flag.
 *
 * So the destructive phase asks first: do I still hold the lock I claimed? A run
 * that lost it writes NOTHING and reports a conflict. Cheap (one D1 read) and it
 * is the only thing standing between a slow store and an empty catalog.
 */
export async function holdsPsnLock(
	db: Db,
	userId: string,
	token: string,
): Promise<boolean> {
	return (await getSetting(db, userId, PSN_LOCK_SETTING_KEY)) === token;
}

/**
 * Run `fn` under the lock. `busy: true` means someone else holds it and `fn`
 * NEVER ran — no PSN call, no write. The release is in a `finally`: a run that
 * throws must not leave the user locked out until the TTL.
 *
 * `fn` receives the token so a destructive run can FENCE its write phase with
 * `holdsPsnLock` (H3) — the TTL can hand the lock to someone else mid-run.
 */
export async function withPsnLock<T>(
	db: Db,
	userId: string,
	op: PsnOp,
	fn: (token: string) => Promise<T>,
): Promise<{ busy: true } | { busy: false; result: T }> {
	const token = await acquirePsnLock(db, userId, op);
	if (!token) return { busy: true };
	try {
		return { busy: false, result: await fn(token) };
	} finally {
		// A failed RELEASE must not destroy a successful RUN: the sync already
		// wrote its rows, and throwing here would turn a 200 into a 500 for work
		// that landed. The TTL clears a lock this leaves behind.
		await releasePsnLock(db, userId, token).catch((error: unknown) =>
			console.error('psn lock release failed', error),
		);
	}
}
