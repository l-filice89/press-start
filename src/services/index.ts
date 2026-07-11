/**
 * Orchestration layer: auth composition today; ingest jobs (seed, PS sync,
 * PS+ Extra check, add-by-name) land in later stories. The only layer that
 * touches both `repositories/` and `providers/` (AD-6).
 */
export * from './auth';
export * from './games';
export * from './genres';
export * from './seed-import';
export * from './settings';
export * from './shelf';
export * from './stragglers';
export * from './sync';
export * from './tracking';
