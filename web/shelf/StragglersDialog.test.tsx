import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastHost } from '../components/Toast';
import * as api from './api';
import { StragglersDialog } from './StragglersDialog';

// importOriginal keeps the pure helpers (candidateScores) real — only the
// network calls are mocked.
vi.mock('./api', async (importOriginal) => ({
	...(await importOriginal<typeof api>()),
	fetchStragglers: vi.fn(),
	searchIgdb: vi.fn(),
	resolveStraggler: vi.fn(),
	ignoreStraggler: vi.fn(),
	setDiscarded: vi.fn(),
}));

function renderDialog() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return render(
		<QueryClientProvider client={client}>
			<ToastHost>
				<StragglersDialog onClose={() => {}} />
			</ToastHost>
		</QueryClientProvider>,
	);
}

describe('StragglersDialog (Story 6.2)', () => {
	beforeEach(() => {
		vi.mocked(api.fetchStragglers).mockResolvedValue([
			{ id: 's1', kind: 'import', title: 'Celeste' },
			{ id: 'g1', kind: 'unenriched', title: 'Name Only' },
		]);
		vi.mocked(api.searchIgdb).mockResolvedValue([
			{
				igdbId: '7',
				name: 'Celeste',
				coverUrl: null,
				releaseDate: '2018-01-25',
				genres: ['Platformer'],
				criticScore: null,
				criticScoreCount: null,
				userScore: null,
				userScoreCount: null,
			},
		]);
		vi.mocked(api.resolveStraggler).mockResolvedValue({ gameId: 'g9' });
		vi.mocked(api.ignoreStraggler).mockResolvedValue(undefined);
	});

	it('lists both straggler kinds', async () => {
		renderDialog();
		expect(await screen.findByText('Celeste')).toBeInTheDocument();
		expect(screen.getByText('Name Only')).toBeInTheDocument();
	});

	it('resolve flow: pick a straggler, auto-search, use a match → resolveStraggler called', async () => {
		const user = userEvent.setup();
		renderDialog();

		const findButtons = await screen.findAllByRole('button', {
			name: 'Find a match',
		});
		await user.click(findButtons[0]);

		// Auto-search seeded from the straggler title returns the candidate.
		const use = await screen.findByRole('button', { name: 'Use this match' });
		await user.click(use);

		await waitFor(() =>
			expect(api.resolveStraggler).toHaveBeenCalledWith(
				expect.objectContaining({ id: 's1', kind: 'import', igdbId: '7' }),
			),
		);
	});

	it('offers Ignore only on the import row and Discard only on the name-only row', async () => {
		renderDialog();
		const rows = await screen.findAllByRole('listitem');
		const rowFor = (title: string) => {
			const row = rows.find((r) => r.textContent?.includes(title));
			if (!row) throw new Error(`no straggler row for "${title}"`);
			return within(row);
		};

		// Import row: Ignore, no Discard. Name-only row: Discard, no Ignore.
		const importRow = rowFor('Celeste');
		expect(
			importRow.getByRole('button', { name: 'Ignore' }),
		).toBeInTheDocument();
		expect(importRow.queryByRole('button', { name: 'Discard' })).toBeNull();
		const nameOnlyRow = rowFor('Name Only');
		expect(
			nameOnlyRow.getByRole('button', { name: 'Discard' }),
		).toBeInTheDocument();
		expect(nameOnlyRow.queryByRole('button', { name: 'Ignore' })).toBeNull();
	});

	it('Ignore is confirm-gated: Cancel writes nothing, Confirm calls ignoreStraggler', async () => {
		const user = userEvent.setup();
		renderDialog();

		// Open the gate, then cancel — nothing written.
		const ignoreButtons = await screen.findAllByRole('button', {
			name: 'Ignore',
		});
		await user.click(ignoreButtons[0]);
		await user.click(screen.getByRole('button', { name: 'Cancel' }));
		expect(api.ignoreStraggler).not.toHaveBeenCalled();

		// Re-open and confirm — the endpoint is hit with the import row id.
		await user.click(screen.getAllByRole('button', { name: 'Ignore' })[0]);
		// The confirm dialog's own "Ignore" button is the last one rendered.
		const confirmButtons = screen.getAllByRole('button', { name: 'Ignore' });
		await user.click(confirmButtons[confirmButtons.length - 1]);
		await waitFor(() => expect(api.ignoreStraggler).toHaveBeenCalledWith('s1'));
	});
});
