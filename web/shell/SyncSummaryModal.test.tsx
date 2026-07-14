import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { SearchBox } from '../shelf/SearchBox';
import { SyncSummaryModal } from './SyncSummaryModal';

/**
 * Sync summary modal (Story 4.3, FR-37/UX-DR13): counts after a run, the
 * needs-attention list with jump buttons, and the banner-reopen variant
 * (items only — counts belong to the run that produced them).
 */

const result = {
	added: [
		{ title: 'Astro Bot', viaMembership: false },
		{ title: 'Hades II', viaMembership: true },
	],
	flipped: [{ title: 'Hollow Knight', viaMembership: false }],
	upgraded: ['Stray'],
	skippedWebApps: 1,
	needsAttention: [{ title: 'Doppelganger', reason: 'ambiguous match' }],
};

/** Reads the live URL — where the jump-to-problem intent lives now. */
function LocationProbe() {
	const location = useLocation();
	return (
		<span data-testid="location">{`${location.pathname}${location.search}`}</span>
	);
}

/**
 * The modal navigates (Story 7.2), so it needs a router in the tree — and the
 * SearchBox, the jump's actual TARGET: "Find in library" must land the term in
 * the field AND put focus in it (Story 4.3), every time (review, L2).
 */
function renderModal(node: React.ReactElement) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return render(
		<QueryClientProvider client={client}>
			<MemoryRouter initialEntries={['/']}>
				<SearchBox />
				{node}
				<LocationProbe />
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

describe('SyncSummaryModal', () => {
	it('reports the counts and needs-attention items after a sync run', () => {
		renderModal(
			<SyncSummaryModal
				result={result}
				attention={result.needsAttention}
				onClose={vi.fn()}
			/>,
		);

		const counts = screen.getByTestId('sync-counts');
		// Counts AND the game names — which games landed must never be a guess.
		expect(counts).toHaveTextContent('Games added (2)');
		expect(counts).toHaveTextContent('Astro Bot');
		// A claim is owned but tagged — the future subscription-cancel flow
		// un-owns exactly these (FR-9 amended).
		expect(counts).toHaveTextContent('Hades II PS+');
		expect(counts).toHaveTextContent('Now owned (1)');
		expect(counts).toHaveTextContent('Hollow Knight');
		expect(counts).toHaveTextContent('Purchased (was a PS+ claim) (1)');
		expect(counts).toHaveTextContent('Stray');
		expect(screen.getByText('Needs attention (1)')).toBeInTheDocument();
		expect(screen.getByText('Doppelganger')).toBeInTheDocument();
	});

	it('banner-reopen variant shows items without counts', () => {
		renderModal(
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

	// Story 7.2 rewrite (AD-25): the jump used to dispatch `SEED_SEARCH_EVENT` as
	// this modal closed — an intent the SearchBox swallowed if it wasn't listening
	// yet. It NAVIGATES now: the shelf destination with the title as `?q=`, which
	// a late-mounting box reads off the URL instead of missing.
	it('"Find in library" closes the modal and routes to the shelf with the term', async () => {
		const onClose = vi.fn();
		renderModal(
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
		expect(screen.getByTestId('location')).toHaveTextContent(
			'/?q=Doppelganger',
		);
		// The field takes the term AND the focus — the assertion the 7.2 rewrite
		// dropped (review, L2). Restored: the jump is useless if you have to hunt
		// for the box afterwards.
		const input = screen.getByRole('searchbox', {
			name: 'Search your library',
		});
		await waitFor(() => expect(input).toHaveValue('Doppelganger'));
		expect(input).toHaveFocus();
	});

	// REGRESSION (review, L2): the focus flag rode in `location.state` and was the
	// effect's only dependency, so it fired ONCE per mount — reopening the banner
	// and jumping to another item left focus wherever it was. Every jump focuses.
	it('focuses the field on EVERY jump, not just the first', async () => {
		const onClose = vi.fn();
		renderModal(
			<SyncSummaryModal
				result={result}
				attention={result.needsAttention}
				onClose={onClose}
			/>,
		);
		const jump = () =>
			userEvent.click(screen.getByRole('button', { name: 'Find in library' }));

		await jump();
		const input = screen.getByRole('searchbox', {
			name: 'Search your library',
		});
		await waitFor(() => expect(input).toHaveFocus());

		// Focus moves away (the reader clicks something else), then jumps again.
		input.blur();
		expect(input).not.toHaveFocus();
		await jump();
		await waitFor(() => expect(input).toHaveFocus());
	});

	it('Escape and Close both dismiss', async () => {
		const onClose = vi.fn();
		renderModal(
			<SyncSummaryModal result={result} attention={[]} onClose={onClose} />,
		);

		await userEvent.click(screen.getByRole('button', { name: 'Close' }));
		await userEvent.keyboard('{Escape}');
		expect(onClose).toHaveBeenCalledTimes(2);
	});
});
