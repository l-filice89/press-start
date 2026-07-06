/**
 * Domain core (AD-3) — pure, I/O-free. This module (and everything else under
 * `src/core/`) must never import `drizzle-orm`, `repositories/`, or
 * `providers/`, and must never reference the global `fetch` or a D1 binding.
 * The Vitest purity guard in `./purity.test.ts` enforces this at test time.
 *
 * Real domain logic (effective/derived state, title normalization,
 * reconciliation — AD-7/8/9/21) lands in Story 1.2+. This placeholder exists
 * only to prove the "core is unit-tested with no runtime" path for 1.1.
 */
export type HealthStatus = 'ok' | 'error';

export function formatHealthStatus(status: HealthStatus): string {
	return `status:${status}`;
}
