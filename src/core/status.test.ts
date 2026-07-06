import { describe, expect, it } from 'vitest';
import { formatHealthStatus } from './status';

describe('formatHealthStatus (pure core/ unit test, no runtime — AR-3)', () => {
	it('formats an ok status', () => {
		expect(formatHealthStatus('ok')).toBe('status:ok');
	});

	it('formats an error status', () => {
		expect(formatHealthStatus('error')).toBe('status:error');
	});
});
