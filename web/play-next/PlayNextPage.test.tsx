import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LiveRegionProvider } from '../components/LiveRegion';
import { ToastHost } from '../components/Toast';
import type { ShelfGame } from '../shelf/api';
import { PlayNextPage } from './PlayNextPage';

function game(id: string, overrides: Partial<ShelfGame> = {}): ShelfGame {
	return {
		id,
		title: `Game ${id}`,
		coverUrl: null,
		storeUrl: null,
		playStatus: 'Not started',
		effectiveState: 'Not started',
		owned: true,
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
		ownedVia: 'purchase',
		releaseDate: '2020-01-01',
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

function LocationProbe() {
	const location = useLocation();
	return <span data-testid="location">{location.pathname}</span>;
}

function renderPage(games?: ShelfGame[]) {
	const client = new QueryClient({
		defaultOptions: {
			queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
			mutations: { retry: false },
		},
	});
	if (games) client.setQueryData(['shelf'], games);
	const view = render(
		<QueryClientProvider client={client}>
			<LiveRegionProvider>
				<ToastHost>
					<MemoryRouter initialEntries={['/play-next']}>
						<Routes>
							<Route path="/play-next" element={<PlayNextPage />} />
							<Route path="/" element={<p>Shelf destination</p>} />
							<Route path="/game/:id" element={<p>Detail destination</p>} />
						</Routes>
						<LocationProbe />
					</MemoryRouter>
				</ToastHost>
			</LiveRegionProvider>
		</QueryClientProvider>,
	);
	return { ...view, client };
}

afterEach(() => vi.unstubAllGlobals());

describe('PlayNextPage', () => {
	it('focuses WHAT NEXT? and renders three transparent suggestions immediately', async () => {
		renderPage([
			game('a', { genres: ['RPG'], ttbStorySeconds: 8 * 3600 }),
			game('b', { criticScore: 90, criticScoreCount: 20 }),
			game('c', { psPlusExtra: true, owned: false, ownedVia: null }),
			game('playing', { playStatus: 'Playing', effectiveState: 'Playing' }),
		]);
		const heading = screen.getByRole('heading', { name: 'WHAT NEXT?' });
		await waitFor(() => expect(heading).toHaveFocus());
		expect(screen.getByText('SURPRISE ME')).toBeInTheDocument();
		expect(screen.getAllByRole('article')).toHaveLength(3);
		expect(screen.getAllByRole('button', { name: 'Play this' })).toHaveLength(
			3,
		);
		expect(
			screen.getAllByRole('button', { name: 'Open details' }),
		).toHaveLength(3);
		expect(screen.getByText('8h story')).toBeInTheDocument();
		expect(screen.getByText('PS+ EXTRA')).toBeInTheDocument();
		expect(screen.queryByText(/Game playing/)).not.toBeInTheDocument();
	});

	it('omits unknown facts and explains a smaller pool without placeholders', () => {
		renderPage([game('only')]);
		expect(screen.getAllByRole('article')).toHaveLength(1);
		expect(screen.getByRole('status')).toHaveTextContent(
			'Only 1 suggestion fits the current eligibility rules.',
		);
		expect(
			screen.queryByRole('list', { name: 'Known facts' }),
		).not.toBeInTheDocument();
		expect(
			screen.getByText('A varied eligible pick from your Shelf.'),
		).toBeInTheDocument();
	});

	it('keeps route heading mounted and focused when the Shelf read fails', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({
				ok: false,
				status: 500,
				json: async () => ({}),
			})),
		);
		renderPage();
		expect(await screen.findByRole('alert')).toHaveTextContent(
			'Your shelf couldn’t load',
		);
		expect(screen.getByRole('heading', { name: 'WHAT NEXT?' })).toHaveFocus();
	});

	it('omits malformed duration and past-departure facts', () => {
		renderPage([
			game('bad-facts', {
				ttbStorySeconds: -3600,
				psPlusLeavingOn: '2000-01-01',
			}),
		]);
		expect(screen.queryByText('-1h story')).not.toBeInTheDocument();
		expect(screen.queryByText('Leaves 2000-01-01')).not.toBeInTheDocument();
	});

	it('freezes the initial visit slate when the Shelf cache changes', async () => {
		const { client } = renderPage([game('original')]);
		expect(screen.getByText('Game original')).toBeInTheDocument();
		act(() => {
			client.setQueryData(
				['shelf'],
				[game('replacement', { playStatus: 'Paused' })],
			);
		});
		await waitFor(() =>
			expect(screen.getByText('Game original')).toBeInTheDocument(),
		);
		expect(screen.queryByText('Game replacement')).not.toBeInTheDocument();
	});

	it('renders an honest empty state when no candidates are eligible', () => {
		renderPage([game('future', { releaseDate: '2999-01-01' })]);
		expect(
			screen.getByRole('heading', { name: 'NO PICKS YET' }),
		).toBeInTheDocument();
		expect(screen.queryByRole('article')).not.toBeInTheDocument();
	});

	it('opens detail through routed navigation', async () => {
		const user = userEvent.setup();
		renderPage([game('a')]);
		await user.click(screen.getByRole('button', { name: 'Open details' }));
		expect(screen.getByTestId('location')).toHaveTextContent('/game/a');
		expect(screen.getByText('Detail destination')).toBeInTheDocument();
	});

	it('Play this reuses status mutation and navigates to Shelf only on success', async () => {
		const user = userEvent.setup();
		const fetchMock = vi.fn(async (url: string) => ({
			ok: true,
			status: 200,
			json: async () =>
				url.includes('/api/shelf')
					? {
							games: [
								game('a', { playStatus: 'Playing', effectiveState: 'Playing' }),
							],
						}
					: { effectiveState: 'Playing' },
		}));
		vi.stubGlobal('fetch', fetchMock);
		renderPage([game('a')]);
		await user.click(screen.getByRole('button', { name: 'Play this' }));
		await screen.findByText('Shelf destination');
		expect(screen.getByTestId('location')).toHaveTextContent('/');
		expect(fetchMock).toHaveBeenCalledWith(
			'/api/games/a/play-status',
			expect.objectContaining({
				method: 'PATCH',
				body: JSON.stringify({ playStatus: 'Playing' }),
			}),
		);
	});

	it('keeps slate visible when Play this fails', async () => {
		const user = userEvent.setup();
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({
				ok: false,
				status: 500,
				json: async () => ({}),
			})),
		);
		renderPage([game('a')]);
		const card = screen.getByRole('article');
		await user.click(within(card).getByRole('button', { name: 'Play this' }));
		expect(
			await screen.findByText('Couldn’t update Game a. Try again.'),
		).toBeInTheDocument();
		expect(screen.getByRole('article')).toBeInTheDocument();
		expect(screen.getByTestId('location')).toHaveTextContent('/play-next');
	});
});
