import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as playNextCore from '../../src/core';
import { FOCUSABLE_SELECTOR } from '../components/focusable';
import { LiveRegionProvider } from '../components/LiveRegion';
import { ToastHost } from '../components/Toast';
import type { ShelfGame } from '../shelf/api';
import { resetInFlightWrites } from '../shelf/useTrackingMutations';
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
	return (
		<>
			<span data-testid="location">{location.pathname}</span>
			<span data-testid="location-state">{JSON.stringify(location.state)}</span>
		</>
	);
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

function visibleGameIds(): string[] {
	return screen
		.getAllByRole('article')
		.map((card) => card.getAttribute('data-play-next-game-id') ?? '');
}

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	resetInFlightWrites();
});

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
		expect(
			screen.getByRole('button', { name: 'Tune the picks' }),
		).toBeDisabled();
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
				[
					game('original', {
						title: 'Changed live title',
						genres: ['Changed live genre'],
						ttbStorySeconds: 99 * 3600,
					}),
				],
			);
		});
		await waitFor(() =>
			expect(screen.getByText('Game original')).toBeInTheDocument(),
		);
		expect(screen.queryByText('Changed live title')).not.toBeInTheDocument();
		expect(screen.queryByText('Changed live genre')).not.toBeInTheDocument();
		expect(screen.queryByText('99h story')).not.toBeInTheDocument();
	});

	it('renders an honest empty state for default and tuned pools', async () => {
		const user = userEvent.setup();
		renderPage([game('future', { releaseDate: '2999-01-01' })]);
		expect(
			screen.getByRole('heading', { name: 'NO PICKS YET' }),
		).toBeInTheDocument();
		expect(screen.queryByRole('article')).not.toBeInTheDocument();
		expect(
			screen.getByText(
				'Add an owned or currently available PS+ game to your Shelf.',
			),
		).toBeInTheDocument();
		await user.click(screen.getByRole('button', { name: 'Tune the picks' }));
		await user.click(screen.getByRole('button', { name: 'Quick win' }));
		await user.click(screen.getByRole('button', { name: 'SHOW ME 3' }));
		expect(
			screen.getByText('No eligible Shelf games match the applied intent.'),
		).toBeInTheDocument();
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
		let resolveWrite: (value: {
			ok: boolean;
			status: number;
			json: () => Promise<{ effectiveState: string }>;
		}) => void = () => undefined;
		const write = new Promise<{
			ok: boolean;
			status: number;
			json: () => Promise<{ effectiveState: string }>;
		}>((resolve) => {
			resolveWrite = resolve;
		});
		const fetchMock = vi.fn(() => write);
		vi.stubGlobal('fetch', fetchMock);
		renderPage([game('a')]);
		const card = screen.getByRole('article');
		const play = within(card).getByRole('button', { name: 'Play this' });
		await user.click(play);
		expect(card).toHaveAttribute('aria-busy', 'true');
		expect(
			within(card).getByRole('button', { name: 'STARTING…' }),
		).toBeDisabled();
		expect(
			within(card).getByRole('button', { name: /^Open details$/ }),
		).toBeDisabled();
		expect(
			within(card).getByRole('button', { name: 'Open details — Game a' }),
		).toBeDisabled();
		expect(
			within(card).getByRole('button', { name: 'Owned — Game a' }),
		).toBeDisabled();
		expect(screen.getByRole('button', { name: 'SHUFFLE' })).toBeDisabled();
		expect(
			screen.getByRole('button', { name: 'Tune the picks' }),
		).toBeDisabled();
		fireEvent.click(play);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(screen.getByTestId('location')).toHaveTextContent('/play-next');

		resolveWrite({
			ok: true,
			status: 200,
			json: async () => ({ effectiveState: 'Playing' }),
		});
		await screen.findByText('Shelf destination');
		expect(screen.getByTestId('location')).toHaveTextContent('/');
		expect(screen.getByTestId('location-state')).toHaveTextContent(
			'"playNextFocusGameId":"a"',
		);
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
		let resolveWrite: (value: {
			ok: boolean;
			status: number;
			json: () => Promise<Record<string, never>>;
		}) => void = () => undefined;
		const write = new Promise<{
			ok: boolean;
			status: number;
			json: () => Promise<Record<string, never>>;
		}>((resolve) => {
			resolveWrite = resolve;
		});
		vi.stubGlobal(
			'fetch',
			vi.fn(() => write),
		);
		renderPage(
			Array.from({ length: 5 }, (_, index) =>
				game(String(index), { ttbStorySeconds: (index + 2) * 3600 }),
			),
		);
		await user.click(screen.getByRole('button', { name: 'Tune the picks' }));
		await user.click(screen.getByRole('button', { name: 'Quick win' }));
		await user.click(screen.getByRole('button', { name: 'SHOW ME 3' }));
		await user.click(screen.getByRole('button', { name: /Tune the picks/ }));
		await user.click(screen.getByRole('button', { name: 'Different' }));
		await user.click(
			screen.getByRole('button', { name: 'Close Tune the picks' }),
		);
		await user.click(screen.getByRole('button', { name: 'SHUFFLE' }));
		const before = visibleGameIds();
		const visit = screen
			.getAllByRole('article')[0]
			.closest('.play-next')
			?.getAttribute('data-play-next-visit');
		const warning =
			'You’ve seen every other match. Next Shuffle starts a fresh pool.';
		expect(screen.getByText(warning)).toBeInTheDocument();
		const card = screen.getAllByRole('article')[0];
		const title = within(card).getByRole('heading').textContent ?? '';
		const play = within(card).getByRole('button', { name: 'Play this' });
		await user.click(play);
		screen.getAllByRole('article')[1]?.focus();
		resolveWrite({
			ok: false,
			status: 500,
			json: async () => ({}),
		});
		expect(
			await screen.findByText(`Couldn’t update ${title}. Try again.`),
		).toBeInTheDocument();
		expect(visibleGameIds()).toEqual(before);
		expect(screen.getByText(warning)).toBeInTheDocument();
		expect(
			screen
				.getAllByRole('article')[0]
				.closest('.play-next')
				?.getAttribute('data-play-next-visit'),
		).toBe(visit);
		expect(
			screen.getByText('QUICK WIN', { selector: '.play-next__mode' }),
		).toBeInTheDocument();
		expect(screen.getByTestId('location')).toHaveTextContent('/play-next');
		expect(play).toHaveFocus();
		await user.click(screen.getByRole('button', { name: /Tune the picks/ }));
		expect(screen.getByRole('button', { name: 'Different' })).toHaveAttribute(
			'aria-pressed',
			'true',
		);
		await user.click(
			screen.getByRole('button', { name: 'Close Tune the picks' }),
		);
		await user.click(screen.getByRole('button', { name: 'SHUFFLE' }));
		const after = visibleGameIds();
		expect(after.length).toBeGreaterThan(0);
		expect(after.every((id) => !before.includes(id))).toBe(true);
	});

	it('keeps page commands disabled until every card write settles', async () => {
		const user = userEvent.setup();
		type WriteResponse = {
			ok: boolean;
			status: number;
			json: () => Promise<Record<string, never>>;
		};
		let resolveA: (value: WriteResponse) => void = () => undefined;
		let resolveB: (value: WriteResponse) => void = () => undefined;
		const writeA = new Promise<WriteResponse>((resolve) => {
			resolveA = resolve;
		});
		const writeB = new Promise<WriteResponse>((resolve) => {
			resolveB = resolve;
		});
		vi.stubGlobal(
			'fetch',
			vi.fn((url: string) => (url.includes('/a/') ? writeA : writeB)),
		);
		renderPage([game('a'), game('b')]);
		const cardA = screen
			.getByRole('heading', { name: 'Game a' })
			.closest('article') as HTMLElement;
		const cardB = screen
			.getByRole('heading', { name: 'Game b' })
			.closest('article') as HTMLElement;
		await user.click(within(cardA).getByRole('button', { name: 'Play this' }));
		await user.click(within(cardB).getByRole('button', { name: 'Play this' }));
		const shuffle = screen.getByRole('button', { name: 'SHUFFLE' });
		expect(shuffle).toBeDisabled();

		resolveB({ ok: false, status: 500, json: async () => ({}) });
		await waitFor(() =>
			expect(
				within(cardB).getByRole('button', { name: 'Play this' }),
			).toBeEnabled(),
		);
		expect(
			within(cardA).getByRole('button', { name: 'STARTING…' }),
		).toBeDisabled();
		expect(shuffle).toBeDisabled();

		resolveA({ ok: false, status: 500, json: async () => ({}) });
		await waitFor(() => expect(shuffle).toBeEnabled());
	});

	it('keeps draft edits separate, enforces one-or-none, and applies only on Show me 3', async () => {
		const user = userEvent.setup();
		renderPage([
			game('quick', { ttbStorySeconds: 10 * 3600 }),
			game('long-a', {
				ttbStorySeconds: 40 * 3600,
				criticScore: 99,
				criticScoreCount: 99,
			}),
			game('long-b', { ttbStorySeconds: 50 * 3600 }),
		]);
		const before = screen
			.getAllByRole('article')
			.map((card) => card.getAttribute('data-play-next-game-id'));
		const trigger = screen.getByRole('button', { name: 'Tune the picks' });
		await user.click(trigger);
		const dialog = screen.getByRole('dialog', { name: 'Tune the picks' });
		const familiar = within(dialog).getByRole('button', { name: 'Familiar' });
		const different = within(dialog).getByRole('button', { name: 'Different' });
		await user.click(familiar);
		expect(familiar).toHaveAttribute('aria-pressed', 'true');
		await user.click(different);
		expect(familiar).toHaveAttribute('aria-pressed', 'false');
		expect(different).toHaveAttribute('aria-pressed', 'true');
		await user.click(different);
		expect(different).toHaveAttribute('aria-pressed', 'false');
		await user.click(within(dialog).getByRole('button', { name: 'Quick win' }));
		expect(screen.getByText('SURPRISE ME')).toBeInTheDocument();
		expect(
			screen
				.getAllByRole('article')
				.map((card) => card.getAttribute('data-play-next-game-id')),
		).toEqual(before);
		expect(within(dialog).getByText(/Draft changed/)).toBeInTheDocument();

		await user.click(within(dialog).getByRole('button', { name: 'SHOW ME 3' }));
		expect(screen.queryByRole('dialog', { name: 'Tune the picks' })).toBeNull();
		expect(trigger).toHaveFocus();
		expect(
			screen.getByText('QUICK WIN', { selector: '.play-next__mode' }),
		).toBeInTheDocument();
		expect(trigger).toHaveAccessibleName('Tune the picks — 1 active');
		await waitFor(() =>
			expect(screen.getByTestId('live-region')).toHaveTextContent(
				'3 suggestions ready.',
			),
		);
	});

	it('derives exactly once when applying an unchanged draft', async () => {
		const user = userEvent.setup();
		const derive = vi.spyOn(playNextCore, 'getPlayNextSuggestions');
		renderPage([game('a'), game('b'), game('c')]);
		await screen.findAllByRole('article');
		const beforeApply = derive.mock.calls.length;
		await user.click(screen.getByRole('button', { name: 'Tune the picks' }));
		await user.click(screen.getByRole('button', { name: 'SHOW ME 3' }));
		expect(derive).toHaveBeenCalledTimes(beforeApply + 1);
		expect(screen.queryByRole('dialog', { name: 'Tune the picks' })).toBeNull();
		await waitFor(() =>
			expect(screen.getByTestId('live-region')).toHaveTextContent(
				'3 suggestions ready.',
			),
		);
	});

	it('shuffles to unseen games, retains focus, and announces every result', async () => {
		const user = userEvent.setup();
		renderPage(Array.from({ length: 6 }, (_, index) => game(String(index))));
		const before = visibleGameIds();
		const shuffle = screen.getByRole('button', { name: 'SHUFFLE' });

		await user.click(shuffle);

		const after = visibleGameIds();
		expect(after).toHaveLength(3);
		expect(after).not.toEqual(before);
		expect(after.every((id) => !before.includes(id))).toBe(true);
		expect(shuffle).toHaveFocus();
		await waitFor(() =>
			expect(screen.getByTestId('live-region')).toHaveTextContent(
				'3 suggestions ready.',
			),
		);
	});

	it('re-announces identical counts on consecutive completed shuffles', async () => {
		const user = userEvent.setup();
		renderPage(Array.from({ length: 9 }, (_, index) => game(String(index))));
		const liveRegion = screen.getByTestId('live-region');
		const messages: string[] = [];
		const observer = new MutationObserver(() => {
			if (liveRegion.textContent) messages.push(liveRegion.textContent);
		});
		observer.observe(liveRegion, { childList: true, subtree: true });
		const shuffle = screen.getByRole('button', { name: 'SHUFFLE' });

		await user.click(shuffle);
		await waitFor(() =>
			expect(
				messages.filter((message) => message === '3 suggestions ready.'),
			).toHaveLength(1),
		);
		await user.click(shuffle);
		await waitFor(() =>
			expect(
				messages.filter((message) => message === '3 suggestions ready.'),
			).toHaveLength(2),
		);
		observer.disconnect();
	});

	it('warns at near exhaustion and resets on the next single Shuffle', async () => {
		const user = userEvent.setup();
		renderPage(Array.from({ length: 5 }, (_, index) => game(String(index))));
		const initial = visibleGameIds();
		const shuffle = screen.getByRole('button', { name: 'SHUFFLE' });

		await user.click(shuffle);

		const exhausted = visibleGameIds();
		expect(exhausted).toHaveLength(2);
		expect(exhausted.every((id) => !initial.includes(id))).toBe(true);
		expect(screen.getByRole('status')).toHaveTextContent(
			'You’ve seen every other match. Next Shuffle starts a fresh pool.',
		);

		await user.click(shuffle);

		const fresh = visibleGameIds();
		expect(fresh).toHaveLength(3);
		expect(fresh.every((id) => !exhausted.includes(id))).toBe(true);
		expect(
			screen.queryByText(
				'You’ve seen every other match. Next Shuffle starts a fresh pool.',
			),
		).not.toBeInTheDocument();
		expect(shuffle).toHaveFocus();
	});

	it('does not arm reset while Finish-capped unseen games remain', async () => {
		const user = userEvent.setup();
		renderPage([
			game('plain-a'),
			game('plain-b'),
			...Array.from({ length: 4 }, (_, index) =>
				game(`paused-${index}`, { playStatus: 'Paused' }),
			),
		]);
		const shuffle = screen.getByRole('button', { name: 'SHUFFLE' });
		const warning =
			'You’ve seen every other match. Next Shuffle starts a fresh pool.';

		await user.click(shuffle);
		expect(visibleGameIds()).toHaveLength(1);
		expect(screen.queryByText(warning)).not.toBeInTheDocument();

		await user.click(shuffle);
		expect(visibleGameIds()).toHaveLength(1);
		expect(screen.queryByText(warning)).not.toBeInTheDocument();

		await user.click(shuffle);
		expect(visibleGameIds()).toHaveLength(1);
		expect(screen.getByText(warning)).toBeInTheDocument();
	});

	it('unions a Tune result after Shuffle and clears the armed reset', async () => {
		const user = userEvent.setup();
		renderPage(Array.from({ length: 5 }, (_, index) => game(String(index))));
		const shuffle = screen.getByRole('button', { name: 'SHUFFLE' });
		const warning =
			'You’ve seen every other match. Next Shuffle starts a fresh pool.';

		await user.click(shuffle);
		expect(screen.getByText(warning)).toBeInTheDocument();

		await user.click(screen.getByRole('button', { name: 'Tune the picks' }));
		await user.click(screen.getByRole('button', { name: 'SHOW ME 3' }));
		expect(screen.queryByText(warning)).not.toBeInTheDocument();
		const tuned = visibleGameIds();

		await user.click(shuffle);
		expect(visibleGameIds()).toEqual(tuned);
		expect(screen.getByText(warning)).toBeInTheDocument();
	});

	it('keeps zero-result slate and shuffles with applied intent, not dismissed draft', async () => {
		const user = userEvent.setup();
		const derive = vi.spyOn(playNextCore, 'getPlayNextSuggestions');
		renderPage([
			game('quick-a', { ttbStorySeconds: 5 * 3600 }),
			game('quick-b', { ttbStorySeconds: 6 * 3600 }),
			game('quick-c', { ttbStorySeconds: 7 * 3600 }),
		]);
		await user.click(screen.getByRole('button', { name: 'Tune the picks' }));
		await user.click(screen.getByRole('button', { name: 'Quick win' }));
		await user.click(screen.getByRole('button', { name: 'SHOW ME 3' }));
		const before = visibleGameIds();
		await user.click(screen.getByRole('button', { name: /Tune the picks/ }));
		await user.click(screen.getByRole('button', { name: 'Different' }));
		await user.click(
			screen.getByRole('button', { name: 'Close Tune the picks' }),
		);

		await user.click(screen.getByRole('button', { name: 'SHUFFLE' }));

		expect(visibleGameIds()).toEqual(before);
		expect(screen.getByRole('status')).toHaveTextContent(
			'You’ve seen every other match. Next Shuffle starts a fresh pool.',
		);
		await waitFor(() =>
			expect(screen.getByTestId('live-region')).toHaveTextContent(
				'0 new suggestions ready. Current picks kept.',
			),
		);
		const options = derive.mock.calls.at(-1)?.[1];
		expect(options?.intent).toMatchObject({ time: 'Quick win', genre: null });
		expect([
			...((options?.excludedGameIds as ReadonlySet<string>) ?? []),
		]).toEqual(expect.arrayContaining(before));
	});

	it('does not arm a fresh-pool reset for a small Tune result', async () => {
		const user = userEvent.setup();
		renderPage([game('quick', { ttbStorySeconds: 5 * 3600 })]);

		await user.click(screen.getByRole('button', { name: 'Tune the picks' }));
		await user.click(screen.getByRole('button', { name: 'Quick win' }));
		await user.click(screen.getByRole('button', { name: 'SHOW ME 3' }));

		expect(visibleGameIds()).toHaveLength(1);
		expect(
			screen.queryByText(
				'You’ve seen every other match. Next Shuffle starts a fresh pool.',
			),
		).not.toBeInTheDocument();
	});

	it('preserves a dismissed draft and leaves applied readback unchanged', async () => {
		const user = userEvent.setup();
		renderPage([game('a')]);
		const trigger = screen.getByRole('button', { name: 'Tune the picks' });
		await user.click(trigger);
		await user.click(screen.getByRole('button', { name: 'Forgotten' }));
		await user.click(
			screen.getByRole('button', { name: 'Close Tune the picks' }),
		);
		expect(trigger).toHaveFocus();
		expect(screen.getByText('SURPRISE ME')).toBeInTheDocument();
		await user.click(trigger);
		expect(screen.getByRole('button', { name: 'Forgotten' })).toHaveAttribute(
			'aria-pressed',
			'true',
		);
	});

	it('dismisses the modal with Escape/backdrop, traps focus, and restores body scroll', async () => {
		const user = userEvent.setup();
		renderPage([game('a')]);
		const trigger = screen.getByRole('button', { name: 'Tune the picks' });
		await user.click(trigger);
		const dialog = screen.getByRole('dialog', { name: 'Tune the picks' });
		expect(dialog).toHaveFocus();
		expect(document.body.style.overflow).toBe('hidden');
		const focusables = dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
		const first = focusables[0];
		const last = focusables[focusables.length - 1];
		last.focus();
		fireEvent.keyDown(last, { key: 'Tab' });
		expect(first).toHaveFocus();
		fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
		expect(last).toHaveFocus();
		await user.keyboard('{Escape}');
		expect(screen.queryByRole('dialog', { name: 'Tune the picks' })).toBeNull();
		expect(trigger).toHaveFocus();
		expect(document.body.style.overflow).toBe('');
		await user.click(trigger);
		fireEvent.mouseDown(screen.getByTestId('tune-backdrop'));
		expect(screen.queryByRole('dialog', { name: 'Tune the picks' })).toBeNull();
		expect(trigger).toHaveFocus();
	});

	it('admits wishlist-only cards as DISCOVER and labels relaxed fillers', async () => {
		const user = userEvent.setup();
		renderPage([
			game('owned-long', { ttbStorySeconds: 80 * 3600 }),
			game('wishlist-quick', {
				owned: false,
				playableNow: false,
				wishlisted: true,
				wishlistedOn: '2026-07-01',
				ttbStorySeconds: 5 * 3600,
				ownedVia: null,
			}),
		]);
		expect(screen.queryByText('Game wishlist-quick')).toBeNull();
		await user.click(screen.getByRole('button', { name: 'Tune the picks' }));
		await user.click(screen.getByRole('button', { name: 'Quick win' }));
		await user.click(
			screen.getByRole('checkbox', { name: /Include wishlist/ }),
		);
		await user.click(screen.getByRole('button', { name: 'SHOW ME 3' }));
		const discover = screen
			.getAllByRole('article')
			.find((card) => within(card).queryByText('Game wishlist-quick'));
		expect(discover).toBeDefined();
		expect(
			within(discover as HTMLElement).getByText('DISCOVER'),
		).toBeInTheDocument();
		expect(screen.getByText('CLOSEST MATCH')).toBeInTheDocument();
	});

	it('uses cover detail trigger, graceful fallback, flags, and guarded ownership source dialog', async () => {
		const user = userEvent.setup();
		const ownedGame = game('plus', {
			owned: true,
			ownedVia: 'membership',
			psPlusExtra: true,
			psPlusLeavingOn: '2999-08-10',
		});
		const fetchMock = vi.fn(async (input: string | URL | Request) => ({
			ok: true,
			status: 200,
			json: async () =>
				String(input).includes('/api/shelf')
					? { games: [ownedGame] }
					: { effectiveState: 'Not started' },
		}));
		vi.stubGlobal('fetch', fetchMock);
		renderPage([
			game('plus', {
				coverUrl: 'https://img.invalid/plus.jpg',
				owned: false,
				ownedVia: null,
				psPlusExtra: true,
				psPlusLeavingOn: '2999-08-10',
			}),
		]);
		const cover = screen.getByRole('button', {
			name: 'Open details — Game plus',
		});
		expect(cover.querySelector('img')).not.toBeNull();
		fireEvent.error(cover.querySelector('img') as HTMLImageElement);
		expect(cover).toHaveTextContent('▹');
		expect(screen.getByText('◈ PS+')).toBeInTheDocument();
		expect(screen.getByText(/LEAVING/)).toBeInTheDocument();
		const owned = screen.getByRole('button', { name: 'Owned — Game plus' });
		expect(owned).toHaveAttribute('aria-pressed', 'false');
		await user.click(owned);
		expect(
			screen.getByRole('dialog', {
				name: 'Did you buy Game plus, or claim it with PS+?',
			}),
		).toBeInTheDocument();
		await user.click(screen.getByRole('button', { name: 'Claimed with PS+' }));
		await waitFor(() =>
			expect(fetchMock).toHaveBeenCalledWith(
				'/api/games/plus/ownership',
				expect.objectContaining({
					method: 'PATCH',
					body: JSON.stringify({ owned: true, via: 'membership' }),
				}),
			),
		);
		await waitFor(() => expect(owned).toHaveAttribute('aria-pressed', 'true'));
		expect(screen.getByText('OWNED')).toBeInTheDocument();
		expect(
			screen.queryByRole('dialog', {
				name: 'Did you buy Game plus, or claim it with PS+?',
			}),
		).toBeNull();
	});
});
