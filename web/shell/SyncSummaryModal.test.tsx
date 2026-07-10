import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SEED_SEARCH_EVENT } from '../shelf/SearchBox';
import { SyncSummaryModal } from './SyncSummaryModal';

/**
 * Sync summary modal (Story 4.3, FR-37/UX-DR13): counts after a run, the
 * needs-attention list with jump buttons, and the banner-reopen variant
 * (items only — counts belong to the run that produced them).
 */

const result = {
	added: 2,
	flipped: 1,
	skippedMembership: 3,
	needsAttention: [{ title: 'Doppelganger', reason: 'ambiguous match' }],
};

describe('SyncSummaryModal', () => {
	it('reports the counts and needs-attention items after a sync run', () => {
		render(
			<SyncSummaryModal
				result={result}
				attention={result.needsAttention}
				onClose={vi.fn()}
			/>,
		);

		const counts = screen.getByTestId('sync-counts');
		expect(counts).toHaveTextContent('Games added2');
		expect(counts).toHaveTextContent('Now owned1');
		expect(counts).toHaveTextContent('Membership entries skipped3');
		expect(screen.getByText('Needs attention (1)')).toBeInTheDocument();
		expect(screen.getByText('Doppelganger')).toBeInTheDocument();
	});

	it('banner-reopen variant shows items without counts', () => {
		render(
			<SyncSummaryModal
				result={null}
				attention={result.needsAttention}
				onClose={vi.fn()}
			/>,
		);

		expect(screen.queryByTestId('sync-counts')).not.toBeInTheDocument();
		expect(
			screen.getByRole('dialog', { name: 'Needs attention (1)' }),
		).toBeInTheDocument();
		// One heading only — the h3 belongs to the counts variant.
		expect(screen.getAllByRole('heading')).toHaveLength(1);
		expect(screen.getByText('Doppelganger')).toBeInTheDocument();
	});

	it('"Find in library" closes the modal and seeds the whole-library search', async () => {
		const onClose = vi.fn();
		const seeds: string[] = [];
		const onSeed = (e: Event) => seeds.push((e as CustomEvent<string>).detail);
		window.addEventListener(SEED_SEARCH_EVENT, onSeed);

		try {
			render(
				<SyncSummaryModal
					result={result}
					attention={result.needsAttention}
					onClose={onClose}
				/>,
			);
			await userEvent.click(
				screen.getByRole('button', { name: 'Find in library' }),
			);

			expect(onClose).toHaveBeenCalledTimes(1);
			expect(seeds).toEqual(['Doppelganger']);
		} finally {
			window.removeEventListener(SEED_SEARCH_EVENT, onSeed);
		}
	});

	it('Escape and Close both dismiss', async () => {
		const onClose = vi.fn();
		render(
			<SyncSummaryModal result={result} attention={[]} onClose={onClose} />,
		);

		await userEvent.click(screen.getByRole('button', { name: 'Close' }));
		await userEvent.keyboard('{Escape}');
		expect(onClose).toHaveBeenCalledTimes(2);
	});
});
