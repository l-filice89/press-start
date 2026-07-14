import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TrophySyncModal } from './TrophySyncModal';

/**
 * The trophy-sync readout (Story 9.2, UX-DR13): every user-triggered long op
 * ends in a visible summary. The distinction that matters here — an unmatched
 * trophy title is REPORTED, never treated as a failure or a needs-attention
 * item; an ambiguous name is.
 */

const result = (
	over: Partial<Parameters<typeof TrophySyncModal>[0]['result']> = {},
) => ({
	updated: ['Ultimate Chicken Horse'],
	unmatched: ['Some Demo'],
	needsAttention: [],
	...over,
});

describe('TrophySyncModal', () => {
	it('reports updated and unmatched titles as a dialog', () => {
		render(<TrophySyncModal result={result()} onClose={() => {}} />);

		const dialog = screen.getByRole('dialog', { name: 'Trophy sync complete' });
		expect(dialog).toHaveAttribute('aria-modal', 'true');
		expect(screen.getByTestId('trophy-sync-counts')).toHaveTextContent(
			'Ultimate Chicken Horse',
		);
		expect(screen.getByTestId('trophy-sync-counts')).toHaveTextContent(
			'Some Demo',
		);
		// An unmatched title is not an error — no attention block for it.
		expect(
			screen.queryByTestId('trophy-sync-attention'),
		).not.toBeInTheDocument();
	});

	it('names an ambiguous title in a needs-attention block (hazard: never guessed)', () => {
		render(
			<TrophySyncModal
				result={result({
					updated: [],
					needsAttention: [
						{
							title: 'Doppelganger',
							reason: 'matches 2 games with the same name',
						},
					],
				})}
				onClose={() => {}}
			/>,
		);

		const attention = screen.getByTestId('trophy-sync-attention');
		expect(attention).toHaveTextContent('Doppelganger');
		expect(attention).toHaveTextContent('matches 2 games');
	});

	it('closes on the Close button and on Escape', async () => {
		const onClose = vi.fn();
		render(<TrophySyncModal result={result()} onClose={onClose} />);

		expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
		await userEvent.keyboard('{Escape}');
		expect(onClose).toHaveBeenCalled();

		await userEvent.click(screen.getByRole('button', { name: 'Close' }));
		expect(onClose).toHaveBeenCalledTimes(2);
	});
});
