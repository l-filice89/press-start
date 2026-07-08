import { describe, expect, it } from 'vitest';
import { wouldViolateCompletionInvariant } from './completion-invariant';

describe('wouldViolateCompletionInvariant (AD-12/FR-3)', () => {
	it('reports a violation when status and both milestones are null', () => {
		expect(
			wouldViolateCompletionInvariant({
				playStatus: null,
				completedOn: null,
				platinumOn: null,
			}),
		).toBe(true);
	});

	it('is safe when a play status is set', () => {
		expect(
			wouldViolateCompletionInvariant({
				playStatus: 'Dropped',
				completedOn: null,
				platinumOn: null,
			}),
		).toBe(false);
	});

	it('is safe when a milestone is set', () => {
		expect(
			wouldViolateCompletionInvariant({
				playStatus: null,
				completedOn: '2025-01-01',
				platinumOn: null,
			}),
		).toBe(false);
	});

	it('is safe when platinumOn alone is set', () => {
		expect(
			wouldViolateCompletionInvariant({
				playStatus: null,
				completedOn: null,
				platinumOn: '2025-01-01',
			}),
		).toBe(false);
	});
});
