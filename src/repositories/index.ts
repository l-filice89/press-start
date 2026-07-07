/**
 * Persistence seam (AD-4): all D1 access goes through Drizzle here, and only
 * here. No service, route, or core module issues a raw D1 query.
 * Real domain repositories land in Story 1.4+.
 */
export * from './db';
