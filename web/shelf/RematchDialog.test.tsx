import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastHost } from '../components/Toast';
import * as api from './api';
import { RematchDialog } from './RematchDialog';

// importOriginal keeps the pure helpers (candidateScores) real — only the
// network calls are mocked.
vi.mock('./api', async (importOriginal) => ({
	...(await importOriginal<typeof api>()),
	searchIgdb: vi.fn(),
	rematchGame: vi.fn(),
}));

const CANDIDATE = {
	igdbId: '99',
	name: "Marvel's Spider-Man 2",
	coverUrl: null,
	releaseDate: '2023-10-20',
	genres: ['Adventure'],
	criticScore: null,
	criticScoreCount: null,
	userScore: null,
	userScoreCount: null,
};

function renderDialog(over: Partial<Parameters<typeof RematchDialog>[0]> = {}) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const onRematched = vi.fn();
	const onClose = vi.fn();
	render(
		<QueryClientProvider client={client}>
			<ToastHost>
				<RematchDialog
					game={{ id: 'g1', title: 'Spider-Man 2' }}
					onClose={onClose}
					onRematched={onRematched}
					{...over}
				/>
			</ToastHost>
		</QueryClientProvider>,
	);
	return { onRematched, onClose };
}

describe('RematchDialog (PV-4)', () => {
	beforeEach(() => {
		vi.mocked(api.searchIgdb).mockResolvedValue([CANDIDATE]);
		vi.mocked(api.rematchGame).mockResolvedValue({ gameId: 'g1' });
	});

	it('auto-searches seeded from the game title and lists the candidate', async () => {
		renderDialog();
		expect(
			await screen.findByText(/Spider-Man 2 \(2023\)/),
		).toBeInTheDocument();
		expect(api.searchIgdb).toHaveBeenCalledWith(
			'Spider-Man 2',
			expect.anything(),
		);
	});

	it('renders graded candidate scores through the shared picker (Story 10.5 — pins THIS caller keeps using it)', async () => {
		vi.mocked(api.searchIgdb).mockResolvedValue([
			{ ...CANDIDATE, criticScore: 88.5, userScore: 55 },
		]);
		renderDialog();
		const row = (await screen.findByText(/Spider-Man 2 \(2023\)/)).closest(
			'li',
		) as HTMLElement;
		expect(
			row.querySelector('.score-badge.score-grade--high'),
		).toHaveTextContent('◎ 89');
		expect(
			row.querySelector('.score-badge.score-grade--low'),
		).toHaveTextContent('★ 55');
	});

	it('picking a candidate calls rematchGame with the game id + candidate, then onRematched', async () => {
		const user = userEvent.setup();
		const { onRematched } = renderDialog();

		await user.click(
			await screen.findByRole('button', { name: 'Use this match' }),
		);

		await waitFor(() =>
			expect(api.rematchGame).toHaveBeenCalledWith('g1', {
				igdbId: '99',
				name: "Marvel's Spider-Man 2",
				coverUrl: null,
				releaseDate: '2023-10-20',
				genres: ['Adventure'],
				// Story 10.1: candidate scores ride the rematch payload (nulls
				// clear the old — wrong — match's numbers).
				criticScore: null,
				criticScoreCount: null,
				userScore: null,
				userScoreCount: null,
			}),
		);
		await waitFor(() => expect(onRematched).toHaveBeenCalled());
	});

	it('a 409 (pick already anchors another game) shows the conflict toast, not onRematched', async () => {
		const user = userEvent.setup();
		vi.mocked(api.rematchGame).mockRejectedValue(
			Object.assign(new Error('conflict'), { status: 409 }),
		);
		const { onRematched } = renderDialog();

		await user.click(
			await screen.findByRole('button', { name: 'Use this match' }),
		);

		expect(await screen.findByTestId('toast')).toHaveTextContent(
			/already in your library/i,
		);
		expect(onRematched).not.toHaveBeenCalled();
	});

	it('degrades to the no-match notice when the games DB returns nothing (NFR-4)', async () => {
		vi.mocked(api.searchIgdb).mockResolvedValue([]);
		renderDialog();
		expect(
			await screen.findByText(/No games-DB match found/),
		).toBeInTheDocument();
	});
});
