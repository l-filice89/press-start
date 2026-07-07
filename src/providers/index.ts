/**
 * External-I/O seam (AD-5): every third-party call (PSN, IGDB, email) goes
 * through a provider adapter here, and only here. Real game-data providers
 * (`psn/`, `igdb/`) land in later epics.
 */
export * from './email';
