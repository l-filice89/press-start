/**
 * Epic-1 domain data model (Story 1.4) — the catalog + per-user tracking
 * tables from the architecture Structural Seed. Attribute ownership is an
 * invariant (AD-19): `game` holds shared catalog facts written by ingest jobs;
 * `game_tracking` holds per-user mutable state. All access goes through
 * `repositories/` (AD-4); nothing here is written at Worker startup.
 *
 * TS property names are camelCase; DB columns are snake_case per the spine's
 * conventions. Dates are ISO `YYYY-MM-DD` text (the `core/` string-comparison
 * contract, AD-8); booleans are integer 0/1; enum-like columns use Drizzle
 * `text({ enum })`.
 */

import { sql } from 'drizzle-orm';
import {
	foreignKey,
	index,
	integer,
	primaryKey,
	real,
	sqliteTable,
	text,
	uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { OWNERSHIP_TYPES, PLAY_STATUSES } from '../core/types';
import { user } from './auth';

/**
 * DB vocabulary for `external_link.source` (persistence-only, not a domain enum).
 *
 * `PSN` and `PSN_PRODUCT` are two NAMESPACES, not one (AD-20). `PSN` holds
 * `np_title_id` values (`CUSA…`/`PPSA…`) — what the library sync observes;
 * `PSN_PRODUCT` holds PS STORE product ids — what the PS+ catalog knows. They
 * are both "PSN ids" in English and neither joins to the other, and
 * `(source, external_id)` is unique: writing a product id as `PSN` would make an
 * add-from-catalog of an already-synced game MISS on link, MATCH on normalized
 * title, and (AD-18's clash rule) create a mandatory duplicate.
 */
export const EXTERNAL_LINK_SOURCES = ['PSN', 'IGDB', 'PSN_PRODUCT'] as const;
// `game_tracking.ownership_type` keys off the core vocabulary (AD-3); the
// re-export keeps existing `schema/catalog` importers working.
export { OWNERSHIP_TYPES };

/**
 * GAME — shared catalog identity (AD-19). Facts fetched by ingest jobs, not
 * user-editable here. `title_normalized` carries NO uniqueness constraint
 * (AD-18): identity is the `external_link (source, external_id)`, not the
 * title. `ps_plus_extra` is the Structural Seed's single catalog-membership
 * boolean; true per-region storage is an Epic-5 refinement (needs `SETTING`).
 */
export const game = sqliteTable(
	'game',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		title: text('title').notNull(),
		titleNormalized: text('title_normalized').notNull(),
		releaseDate: text('release_date'),
		coverUrl: text('cover_url'),
		storeUrl: text('store_url'),
		psPlusExtra: integer('ps_plus_extra', { mode: 'boolean' })
			.notNull()
			.default(false),
		unenriched: integer('unenriched', { mode: 'boolean' })
			.notNull()
			.default(false),
		/**
		 * IGDB reception scores (Story 10.1, VR-5) — shared fetched facts, written
		 * only by ingest (enrichment paths + the scheduled refresh). All four are
		 * nullable and stay NULL when IGDB has no value: a missing score renders as
		 * ABSENT, never 0 (VR-5 — no fabrication). Scores are IGDB's 0–100 scale
		 * stored VERBATIM (real, e.g. 87.33) — rounding is a render concern; counts
		 * ride along so 3 reviews never reads like 300.
		 */
		criticScore: real('critic_score'),
		criticScoreCount: integer('critic_score_count'),
		userScore: real('user_score'),
		userScoreCount: integer('user_score_count'),
	},
	(table) => [
		// Non-unique — the first-pass match key (AD-18), used by every ingest path.
		index('game_title_normalized_idx').on(table.titleNormalized),
	],
);

/**
 * GAME_TRACKING — per-user mutable state (AD-19). PK is composite
 * `(user_id, game_id)` — one row per user per game (AD-17); every query is
 * user-scoped (AD-13). `play_status` is nullable once a completion milestone
 * exists (FR-2). No derived columns (`released`/`wishlisted`/`playable_now`) —
 * those are computed in `core/`, never stored (AD-8).
 */
export const gameTracking = sqliteTable(
	'game_tracking',
	{
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		gameId: text('game_id')
			.notNull()
			.references(() => game.id, { onDelete: 'cascade' }),
		playStatus: text('play_status', { enum: PLAY_STATUSES }),
		completedOn: text('completed_on'),
		platinumOn: text('platinum_on'),
		startedOn: text('started_on'),
		boughtOn: text('bought_on'),
		wishlistedOn: text('wishlisted_on'),
		owned: integer('owned', { mode: 'boolean' }).notNull().default(false),
		ownershipType: text('ownership_type', { enum: OWNERSHIP_TYPES }),
		/**
		 * How ownership was acquired (policy 2026-07-11, FR-9 amended):
		 * PS+ claims COUNT as owned — playable is what matters — but carry
		 * `membership` so a future subscription-cancel flow can un-own claims
		 * without touching purchases. `purchase` = bought (sync purchase rows,
		 * manual detail-view owns). NULL = legacy rows from before the flag.
		 */
		ownedVia: text('owned_via', { enum: ['purchase', 'membership'] }),
		/**
		 * Soft-delete tombstone (discard, 2026-07-11): the user removed this game
		 * from their library as a mistake-fix. Kept as a flagged row, never
		 * deleted — the tombstone is what blocks a re-add from duplicating and
		 * stops additive sync (FR-33) from re-owning it. Hidden from every library
		 * surface via `listLibraryForUser`; cleared (revived) by re-adding the name
		 * (services/games.addGame). Supersedes the 2026-07-10 "no discard" decision
		 * — this is the tracking-level archive path it left open.
		 */
		discarded: integer('discarded', { mode: 'boolean' })
			.notNull()
			.default(false),
	},
	(table) => [
		primaryKey({ columns: [table.userId, table.gameId] }),
		index('game_tracking_game_id_idx').on(table.gameId),
	],
);

/**
 * GENRE — IGDB vocabulary (FR-23). `name` is unique so auto-create is
 * idempotent; the `lower(name)` unique index makes that uniqueness
 * case-insensitive in the DB itself, closing the check-then-insert race that
 * could mint "Action"/"action" near-duplicates (FR-24, Epic 2 retro item 8).
 */
export const genre = sqliteTable(
	'genre',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		name: text('name').notNull().unique(),
	},
	(table) => [
		uniqueIndex('genre_name_nocase_uidx').on(sql`lower(${table.name})`),
	],
);

/** GAME_GENRE — many-to-many join; the composite PK is its identity. */
export const gameGenre = sqliteTable(
	'game_genre',
	{
		gameId: text('game_id')
			.notNull()
			.references(() => game.id, { onDelete: 'cascade' }),
		genreId: text('genre_id')
			.notNull()
			.references(() => genre.id, { onDelete: 'cascade' }),
	},
	(table) => [primaryKey({ columns: [table.gameId, table.genreId] })],
);

/**
 * EXTERNAL_LINK — a game's identity anchors (AD-20). MANY rows allowed per
 * `(game_id, source)` (both a PS4 and a PS5 PSN id resolve to one PS5 game),
 * but `(source, external_id)` is globally unique — one external id maps to
 * exactly one game (AD-18/20), which also makes the lookup single-row.
 */
export const externalLink = sqliteTable(
	'external_link',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		gameId: text('game_id')
			.notNull()
			.references(() => game.id, { onDelete: 'cascade' }),
		source: text('source', { enum: EXTERNAL_LINK_SOURCES }).notNull(),
		externalId: text('external_id').notNull(),
	},
	(table) => [
		uniqueIndex('external_link_source_external_id_uidx').on(
			table.source,
			table.externalId,
		),
		index('external_link_game_id_idx').on(table.gameId),
	],
);

/**
 * SETTING — per-user key-value config (spine: `USER ||--o{ SETTING`). First
 * tenant: `timezone` (IANA zone captured from the browser at first login,
 * user-editable — Epic 2 retro timezone policy); Epic 5 adds region/PS+ keys.
 */
export const setting = sqliteTable(
	'setting',
	{
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		key: text('key').notNull(),
		value: text('value').notNull(),
	},
	(table) => [primaryKey({ columns: [table.userId, table.key] })],
);

/**
 * IMPORT_STRAGGLER — AD-22 kind (a): an import-staging row that could NOT be
 * matched to a `game` (carries the raw Notion payload as JSON text); it is not
 * yet a game. Kind (b) — name-only add-by-name entries — are real `game` rows
 * flagged `unenriched`, not rows here. No `user_id`: the Structural Seed leaves
 * `IMPORT_STRAGGLER` unconnected to `USER`, and a staging row is not tracking
 * data (AD-13 binds tracking rows only).
 */
/**
 * PS_PLUS_CATALOG — the region+tier store snapshot (Story 7.1, AD-24). A THIRD
 * owner class: neither a shared `game` fact nor per-user tracking state. NO
 * `user_id`, NO FK to `game` — a catalog row becomes a game only through 7.3's
 * explicit add. `tier` defaults to `'extra'` so Premium's Classics catalog
 * layers on without a migration rewrite.
 *
 * There is NO `release_date` column: the store payload has none (probed live
 * 2026-07-14 — `productReleaseDate` is a sort key and a facet, never a product
 * field). Do not add one; a catalog card's date comes from IGDB after the add.
 *
 * `generation` is what keeps a cron prune from corrupting an in-flight genre
 * sweep (AD-28): each membership pass stamps the rows it writes, the prune
 * deletes rows NOT of that generation, and the sweep refuses to write tags for
 * a generation that has moved on.
 */
export const psPlusCatalog = sqliteTable(
	'ps_plus_catalog',
	{
		region: text('region').notNull(),
		tier: text('tier').notNull().default('extra'),
		/** The store product id (a `'PSN_PRODUCT'` external id, never an npTitleId — AD-20). */
		productId: text('product_id').notNull(),
		npTitleId: text('np_title_id'),
		name: text('name').notNull(),
		/** The AD-9 normalizer's key — non-unique, the first-pass match (AD-18). */
		titleNormalized: text('title_normalized').notNull(),
		coverUrl: text('cover_url'),
		/** JSON array text, e.g. `["PS4","PS5"]` — the store's own values. */
		platforms: text('platforms'),
		storeClassification: text('store_classification'),
		storeUrl: text('store_url'),
		generation: text('generation').notNull(),
		firstSeenAt: text('first_seen_at').notNull(),
		lastSeenAt: text('last_seen_at').notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.region, table.tier, table.productId] }),
		index('ps_plus_catalog_title_normalized_idx').on(table.titleNormalized),
	],
);

/**
 * PS_PLUS_CATALOG_GENRE — the PS-store `productGenres` facet keys (AD-26). A
 * SEPARATE vocabulary from `genre`/`game_genre` (IGDB); the two never merge.
 * Keys are stored VERBATIM, slash and all (`MUSIC/RHYTHM`). Rows CASCADE with
 * their product, so a prune can never leave orphan tags (AD-28).
 */
export const psPlusCatalogGenre = sqliteTable(
	'ps_plus_catalog_genre',
	{
		region: text('region').notNull(),
		tier: text('tier').notNull().default('extra'),
		productId: text('product_id').notNull(),
		genreKey: text('genre_key').notNull(),
	},
	(table) => [
		primaryKey({
			columns: [table.region, table.tier, table.productId, table.genreKey],
		}),
		foreignKey({
			columns: [table.region, table.tier, table.productId],
			foreignColumns: [
				psPlusCatalog.region,
				psPlusCatalog.tier,
				psPlusCatalog.productId,
			],
		}).onDelete('cascade'),
	],
);

export const importStraggler = sqliteTable('import_straggler', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	sourceTitle: text('source_title').notNull(),
	notionPayload: text('notion_payload'),
});
