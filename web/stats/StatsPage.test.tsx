import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ShelfGame } from '../shelf/api';
import { StatsPage } from './StatsPage';

function game(overrides: Partial<ShelfGame> & { id: string }): ShelfGame {
	return {
		title: overrides.id,
		coverUrl: null,
		storeUrl: null,
		playStatus: 'Not started',
		effectiveState: 'Not started',
		owned: false,
		released: true,
		wishlisted: false,
		playableNow: true,
		psPlusExtra: false,
		hasCompleted: false,
		hasPlatinum: false,
		completedOn: null,
		platinumOn: null,
		startedOn: null,
		boughtOn: null,
		wishlistedOn: null,
		ownershipType: null,
		ownedVia: null,
		releaseDate: null,
		genres: [],
		criticScore: null,
		criticScoreCount: null,
		userScore: null,
		userScoreCount: null,
		psPlusLeavingOn: null,
		ttbStorySeconds: null,
		ttbCompleteSeconds: null,
		ttbCount: null,
		...overrides,
	};
}

function renderStats(games: ShelfGame[], responseOk = true) {
	const fetchMock = vi.fn(async () => ({
		ok: responseOk,
		status: responseOk ? 200 : 500,
		json: async () => (responseOk ? { games } : { error: 'failed' }),
	}));
	vi.stubGlobal('fetch', fetchMock);
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	render(
		<QueryClientProvider client={client}>
			<StatsPage />
		</QueryClientProvider>,
	);
	return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe('StatsPage', () => {
	it('announces a scoreboard-shaped loading state', () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(() => new Promise(() => {})),
		);
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		render(
			<QueryClientProvider client={client}>
				<StatsPage />
			</QueryClientProvider>,
		);
		expect(
			screen.getByRole('status', { name: 'Loading your stats' }),
		).toHaveAttribute('aria-busy', 'true');
		expect(screen.getAllByTestId('skeleton')).toHaveLength(6);
	});

	it('renders explicit empty-library copy', async () => {
		renderStats([]);
		expect(await screen.findByText('INSERT GAMES')).toBeInTheDocument();
		expect(screen.getByText(/cabinet scoreboard/i)).toBeInTheDocument();
	});

	it('changes rounds locally and exposes exact monthly data', async () => {
		const currentYear = new Date().getFullYear();
		const fetchMock = renderStats([
			game({ id: 'current', owned: true, startedOn: `${currentYear}-01-03` }),
			game({ id: 'historic', completedOn: '2024-06-04', genres: ['RPG'] }),
		]);
		expect(
			await screen.findByRole('heading', { name: 'CABINET SCORE' }),
		).toBeInTheDocument();
		expect(
			within(
				screen.getByText('STARTED').closest('.stats-year-score') as HTMLElement,
			).getByText('1'),
		).toBeInTheDocument();

		await userEvent.selectOptions(
			screen.getByLabelText('CURRENT ROUND'),
			'2024',
		);
		expect(
			within(
				screen
					.getByText('COMPLETE')
					.closest('.stats-year-score') as HTMLElement,
			).getByText('1'),
		).toBeInTheDocument();
		expect(screen.getByText('RPG')).toBeInTheDocument();
		await userEvent.click(screen.getByText('Exact monthly totals'));
		const june = screen.getByRole('row', { name: 'JUN 0 1 0' });
		expect(june).toBeInTheDocument();
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('keeps recap before the year selector in DOM and focus order', async () => {
		const currentYear = new Date().getFullYear();
		renderStats([game({ id: 'ordered', owned: true })]);

		const recap = await screen.findByRole('region', {
			name: 'All-time scores',
		});
		const selector = screen.getByLabelText('CURRENT ROUND');
		expect(
			recap.compareDocumentPosition(selector) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
		expect(selector).toHaveValue(String(currentYear));
	});

	it('distinguishes a dated wishlist-only round from no dated activity', async () => {
		const currentYear = new Date().getFullYear();
		renderStats([game({ id: 'wish', wishlistedOn: `${currentYear}-02-01` })]);
		expect(
			await screen.findByText('NO STARTS OR MILESTONES IN THIS ROUND'),
		).toBeInTheDocument();
		expect(
			screen.getByText('NO COMPLETED GENRES IN THIS ROUND'),
		).toBeInTheDocument();
		expect(screen.queryByText('NO DATED ACTIVITY')).not.toBeInTheDocument();
	});

	it('renders a retryable request failure', async () => {
		renderStats([], false);
		expect(await screen.findByRole('alert')).toHaveTextContent(
			'SCORE LOAD FAILED',
		);
		expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
	});
});
