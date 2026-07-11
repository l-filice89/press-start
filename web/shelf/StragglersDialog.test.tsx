import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastHost } from '../components/Toast';
import * as api from './api';
import { StragglersDialog } from './StragglersDialog';

vi.mock('./api', () => ({
	fetchStragglers: vi.fn(),
	searchIgdb: vi.fn(),
	resolveStraggler: vi.fn(),
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
			},
		]);
		vi.mocked(api.resolveStraggler).mockResolvedValue({ gameId: 'g9' });
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
});
