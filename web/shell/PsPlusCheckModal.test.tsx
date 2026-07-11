import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PsPlusCheckModal } from './PsPlusCheckModal';

/** PS+ check readout (Story 5.1, UX-DR13): flag changes by name, or the
 * explicit no-changes line; Close dismisses. */

const result = {
	flagged: ['Hades', 'Ghost of Tsushima'],
	cleared: ['Bloodborne'],
	checked: 12,
	region: 'it-it',
};

describe('PsPlusCheckModal', () => {
	it('lists newly flagged and cleared titles with counts', () => {
		render(<PsPlusCheckModal result={result} onClose={() => {}} />);

		expect(
			screen.getByRole('dialog', { name: 'PS+ Extra check complete' }),
		).toBeInTheDocument();
		expect(screen.getByText(/12 non-owned games checked/)).toBeInTheDocument();
		expect(screen.getByText('Now in PS+ Extra')).toBeInTheDocument();
		expect(screen.getByText('Hades')).toBeInTheDocument();
		expect(screen.getByText('Ghost of Tsushima')).toBeInTheDocument();
		expect(screen.getByText('Left PS+ Extra')).toBeInTheDocument();
		expect(screen.getByText('Bloodborne')).toBeInTheDocument();
		expect(screen.queryByTestId('psplus-no-changes')).not.toBeInTheDocument();
	});

	it('reports a run with zero flag changes explicitly', () => {
		render(
			<PsPlusCheckModal
				result={{ flagged: [], cleared: [], checked: 3, region: 'it-it' }}
				onClose={() => {}}
			/>,
		);

		expect(screen.getByTestId('psplus-no-changes')).toHaveTextContent(
			/No flag changes/,
		);
		expect(screen.queryByTestId('psplus-counts')).not.toBeInTheDocument();
	});

	it('closes via the Close button and Escape', async () => {
		const onClose = vi.fn();
		render(<PsPlusCheckModal result={result} onClose={onClose} />);

		await userEvent.click(screen.getByRole('button', { name: 'Close' }));
		expect(onClose).toHaveBeenCalledTimes(1);

		await userEvent.keyboard('{Escape}');
		expect(onClose).toHaveBeenCalledTimes(2);
	});
});
