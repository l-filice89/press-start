/**
 * External-I/O seam (AD-5): every third-party call (PSN, IGDB, email) goes
 * through a provider adapter here, and only here. `igdb` is used out-of-band
 * by the Story 1.6 seed import; `psn` feeds the Epic 4 sync.
 */
export * from './email';
export * from './igdb';
export * from './psn';
