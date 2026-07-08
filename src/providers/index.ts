/**
 * External-I/O seam (AD-5): every third-party call (PSN, IGDB, email) goes
 * through a provider adapter here, and only here. The `psn/` provider lands
 * in Epic 4; `igdb` is used out-of-band by the Story 1.6 seed import.
 */
export * from './email';
export * from './igdb';
