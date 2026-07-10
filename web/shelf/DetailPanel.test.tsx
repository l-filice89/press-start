import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FOCUSABLE_SELECTOR } from '../components/focusable';
import { ToastHost } from '../components/Toast';
import type { ShelfGame } from './api';
import { Card } from './Card';

/**
 * Story 2.3: the flip-to-detail dialog. Opened from the card's cover trigger,
 * focus-trapped and labelled, writing only through the shared mutation seam —
 * the same PATCH/POST the shelf popover sends. Rendered through `Card` so the
 * open-from-cover and focus-return-to-gridcell contracts are the real ones.
 */

function game(over: Partial<ShelfGame> = {}): ShelfGame {
	return {
		id: 'g1',
		title: 'Bloodborne',
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
		releaseDate: null,
		genres: [],
		...over,
	};
}

function renderCard(g: ShelfGame = game()) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	return render(
		<QueryClientProvider client={client}>
			<ToastHost>
				<Card game={g} tabIndex={0} />
			</ToastHost>
		</QueryClientProvider>,
	);
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
	// The vocabulary GET (['genres'] query, Story 2.5) fires on panel open;
	// route it apart from the tracking writes so both parse.
	fetchMock = vi.fn(async (url: string) =>
		url.includes('/genres')
			? {
					ok: true,
					status: 200,
					json: async () => ({ genres: ['Action', 'Roguelite'] }),
				}
			: {
					ok: true,
					status: 200,
					json: async () => ({ effectiveState: 'Playing' }),
				},
	);
	vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

const cover = () => screen.getByTestId('card-cover-button');

// Every fetch except the read-only vocabulary GET — write assertions count these.
const writes = () =>
	fetchMock.mock.calls.filter(([url]) => url !== '/api/genres');
const panel = () => screen.getByTestId('detail-panel');

async function openPanel(g: ShelfGame = game()) {
	const user = userEvent.setup();
	renderCard(g);
	await user.click(cover());
	return user;
}

describe('DetailPanel', () => {
	it('opens from the cover as a modal dialog labelled by the game title', async () => {
		await openPanel();

		const dialog = screen.getByRole('dialog', { name: 'Bloodborne' });
		expect(dialog).toHaveAttribute('aria-modal', 'true');
		// Focus moved into the dialog on open.
		expect(screen.getByRole('button', { name: 'Close details' })).toHaveFocus();
		// Nothing was written by opening.
		expect(writes()).toHaveLength(0);
	});

	it('has an accessibly named cover trigger, out of the tab order', () => {
		renderCard(game());
		expect(cover()).toHaveAccessibleName('Open details — Bloodborne');
		expect(cover()).toHaveAttribute('tabindex', '-1');
	});

	it('opens from the keyboard on the cover trigger', async () => {
		const user = userEvent.setup();
		renderCard(game());
		cover().focus();
		await user.keyboard('{Enter}');
		expect(screen.getByRole('dialog', { name: 'Bloodborne' })).toBeVisible();
	});

	it('traps Tab inside the dialog', async () => {
		const user = await openPanel();

		// Shift+Tab from the first focusable (the close button) wraps to the last
		// per the shared trap selector (focusable.ts).
		expect(screen.getByRole('button', { name: 'Close details' })).toHaveFocus();
		await user.tab({ shift: true });
		const focusables = panel().querySelectorAll(FOCUSABLE_SELECTOR);
		expect(focusables[focusables.length - 1]).toHaveFocus();
		// And Tab from the last wraps back to the first.
		await user.tab();
		expect(screen.getByRole('button', { name: 'Close details' })).toHaveFocus();
	});

	it('Escape closes, writes nothing, and returns focus to the gridcell', async () => {
		const user = await openPanel();
		await user.keyboard('{Escape}');

		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
		expect(writes()).toHaveLength(0);
		expect(screen.getByTestId('shelf-card')).toHaveFocus();
	});

	it('the close button closes and returns focus to the gridcell', async () => {
		const user = await openPanel();
		await user.click(screen.getByRole('button', { name: 'Close details' }));

		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
		expect(screen.getByTestId('shelf-card')).toHaveFocus();
	});

	it('a backdrop press dismisses without writing', async () => {
		const user = await openPanel();
		await user.click(screen.getByTestId('detail-backdrop'));

		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
		expect(writes()).toHaveLength(0);
	});

	it('shows the five statuses as a radiogroup checked off the raw play status', async () => {
		await openPanel(game({ playStatus: 'Paused', effectiveState: 'Paused' }));

		const radios = within(
			screen.getByRole('radiogroup', { name: 'Play status for Bloodborne' }),
		).getAllByRole('radio');
		expect(radios.map((r) => r.textContent)).toEqual([
			'Not started',
			'Up next',
			'Playing',
			'Paused',
			'Dropped',
		]);
		expect(screen.getByRole('radio', { name: 'Paused' })).toHaveAttribute(
			'aria-checked',
			'true',
		);
		expect(
			radios.filter((r) => r.getAttribute('aria-checked') === 'true'),
		).toHaveLength(1);
	});

	it('the segmented control fires the same PATCH as the shelf popover', async () => {
		const user = await openPanel();
		await user.click(screen.getByRole('radio', { name: 'Playing' }));

		await waitFor(() => expect(writes()).toHaveLength(1));
		const [url, init] = writes()[0];
		expect(url).toBe('/api/games/g1/play-status');
		expect(init).toMatchObject({ method: 'PATCH' });
		expect(JSON.parse(init.body)).toEqual({ playStatus: 'Playing' });
		expect(await screen.findByTestId('toast')).toHaveTextContent(
			'Bloodborne — Playing',
		);
	});

	it('hides Clear status when no milestone exists', async () => {
		await openPanel();
		expect(
			screen.queryByRole('button', { name: 'Clear status' }),
		).not.toBeInTheDocument();
	});

	it('Clear status renders with a milestone and PATCHes playStatus null', async () => {
		const user = await openPanel(
			game({
				playStatus: 'Playing',
				effectiveState: 'Playing',
				hasCompleted: true,
				completedOn: '2024-06-01',
			}),
		);
		await user.click(screen.getByRole('button', { name: 'Clear status' }));

		await waitFor(() => expect(writes()).toHaveLength(1));
		const [url, init] = writes()[0];
		expect(url).toBe('/api/games/g1/play-status');
		expect(init).toMatchObject({ method: 'PATCH' });
		expect(JSON.parse(init.body)).toEqual({ playStatus: null });
		expect(await screen.findByTestId('toast')).toHaveTextContent(
			'Bloodborne — status cleared',
		);
	});

	it('roves the radiogroup with arrow keys without selecting', async () => {
		const user = await openPanel(
			game({ playStatus: 'Paused', effectiveState: 'Paused' }),
		);

		const radios = screen.getAllByRole('radio');
		// One tab stop: the checked radio; the rest are reached by arrows.
		expect(
			radios.filter((r) => r.getAttribute('tabindex') === '0'),
		).toHaveLength(1);
		expect(screen.getByRole('radio', { name: 'Paused' })).toHaveAttribute(
			'tabindex',
			'0',
		);

		screen.getByRole('radio', { name: 'Paused' }).focus();
		await user.keyboard('{ArrowRight}');
		expect(screen.getByRole('radio', { name: 'Dropped' })).toHaveFocus();
		await user.keyboard('{ArrowRight}');
		expect(screen.getByRole('radio', { name: 'Not started' })).toHaveFocus();
		await user.keyboard('{ArrowLeft}');
		expect(screen.getByRole('radio', { name: 'Dropped' })).toHaveFocus();
		// Arrows only move focus — selection is a deliberate activation.
		expect(writes()).toHaveLength(0);
	});

	it('closes itself when its own write hides the card from the shelf', async () => {
		fetchMock.mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ effectiveState: 'Dropped' }),
		});
		const user = await openPanel();
		await user.click(screen.getByRole('radio', { name: 'Dropped' }));

		// The card is about to unmount on refetch — the panel closes deliberately
		// instead of vanishing under the user.
		await waitFor(() =>
			expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
		);
		expect(await screen.findByTestId('toast')).toHaveTextContent(
			'Bloodborne — Dropped',
		);
	});

	it('hides Clear status when the play status is already null', async () => {
		await openPanel(
			game({
				playStatus: null,
				effectiveState: 'Story completed',
				hasCompleted: true,
				completedOn: '2024-06-01',
			}),
		);
		expect(
			screen.queryByRole('button', { name: 'Clear status' }),
		).not.toBeInTheDocument();
	});

	it('a cleared status offers UNDO that restores the previous status', async () => {
		fetchMock.mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ effectiveState: 'Story completed' }),
		});
		const user = await openPanel(
			game({
				playStatus: 'Playing',
				effectiveState: 'Playing',
				hasCompleted: true,
				completedOn: '2024-06-01',
			}),
		);
		await user.click(screen.getByRole('button', { name: 'Clear status' }));

		// Clearing hides the card (effective state falls back to the milestone) —
		// same reversible risky action as Dropped, so the toast carries UNDO.
		const undo = await screen.findByRole('button', { name: 'Undo' });
		await user.click(undo);
		await waitFor(() => expect(writes()).toHaveLength(2));
		expect(JSON.parse(writes()[1][1].body)).toEqual({
			playStatus: 'Playing',
		});
	});

	it('explains a 409 completion-invariant refusal instead of "try again"', async () => {
		fetchMock.mockResolvedValue({
			ok: false,
			status: 409,
			json: async () => ({ error: 'completion invariant' }),
		});
		const user = await openPanel(
			game({
				playStatus: 'Playing',
				effectiveState: 'Playing',
				// Stale cache: the client believes a milestone exists; the server
				// disagrees and refuses the clear.
				hasCompleted: true,
				completedOn: '2024-06-01',
			}),
		);
		await user.click(screen.getByRole('button', { name: 'Clear status' }));

		expect(await screen.findByTestId('toast')).toHaveTextContent(
			/Can’t clear Bloodborne — no milestone logged/,
		);
	});

	it('gates a milestone behind the confirm dialog, then POSTs once confirmed', async () => {
		const user = await openPanel();
		await user.click(screen.getByRole('button', { name: /Story completed/ }));

		// Confirm gate open, nothing written yet (FR-7).
		expect(
			screen.getByRole('dialog', { name: /Log Story completed/ }),
		).toBeInTheDocument();
		expect(writes()).toHaveLength(0);

		await user.click(screen.getByRole('button', { name: 'Confirm' }));
		await waitFor(() => expect(writes()).toHaveLength(1));
		const [url, init] = writes()[0];
		expect(url).toBe('/api/games/g1/milestones');
		expect(init).toMatchObject({ method: 'POST' });
		expect(JSON.parse(init.body)).toEqual({ milestone: 'completed' });
	});

	it('stays open after logging Story completed — the status survives (FR-2 amended)', async () => {
		// Default write mock answers { effectiveState: 'Playing' }: the completion
		// kept the live status, so the card stays on the shelf and the panel must
		// not auto-close.
		const user = await openPanel(
			game({ playStatus: 'Playing', effectiveState: 'Playing' }),
		);
		await user.click(screen.getByRole('button', { name: /Story completed/ }));
		await user.click(screen.getByRole('button', { name: 'Confirm' }));

		await waitFor(() => expect(writes()).toHaveLength(1));
		expect(await screen.findByTestId('toast')).toHaveTextContent(
			'Bloodborne — Story completed',
		);
		expect(screen.getByRole('dialog', { name: 'Bloodborne' })).toBeVisible();
	});

	it('closes after logging a platinum — that write hides the card', async () => {
		fetchMock.mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ effectiveState: 'Platinum achieved' }),
		});
		const user = await openPanel(
			game({ playStatus: 'Playing', effectiveState: 'Playing' }),
		);
		await user.click(screen.getByRole('button', { name: /Platinum achieved/ }));
		await user.click(screen.getByRole('button', { name: 'Confirm' }));

		await waitFor(() =>
			expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
		);
	});

	// HAZARD (Story 3.2, FR-4/FR-17): a panel open on an ALREADY-hidden game
	// (reached via reveal pill or search) must not auto-close on a milestone
	// write that leaves visibility unchanged — hidden before AND after.
	it('stays open logging a milestone on an already-hidden game (no visibility change)', async () => {
		fetchMock.mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ effectiveState: 'Dropped' }),
		});
		const user = await openPanel(
			game({ playStatus: 'Dropped', effectiveState: 'Dropped' }),
		);
		await user.click(screen.getByRole('button', { name: /Story completed/ }));
		await user.click(screen.getByRole('button', { name: 'Confirm' }));

		await waitFor(() => expect(writes()).toHaveLength(1));
		expect(await screen.findByTestId('toast')).toHaveTextContent(
			'Bloodborne — Story completed',
		);
		// The panel survives: auto-close fires only on visible→hidden.
		expect(screen.getByRole('dialog', { name: 'Bloodborne' })).toBeVisible();
	});

	it('Escape in the confirm gate cancels it without closing the panel', async () => {
		const user = await openPanel();
		await user.click(screen.getByRole('button', { name: /Platinum achieved/ }));
		await user.keyboard('{Escape}');

		expect(
			screen.queryByRole('dialog', { name: /Log Platinum/ }),
		).not.toBeInTheDocument();
		expect(screen.getByRole('dialog', { name: 'Bloodborne' })).toBeVisible();
		expect(writes()).toHaveLength(0);
	});

	it('shows an achieved milestone disabled with its date, inert on activation', async () => {
		const user = await openPanel(
			game({
				playStatus: 'Playing',
				effectiveState: 'Playing',
				hasPlatinum: true,
				platinumOn: '2023-05-05',
			}),
		);

		const row = screen.getByRole('button', { name: /Platinum achieved/ });
		expect(row).toHaveAttribute('aria-disabled', 'true');
		expect(row).toHaveTextContent('2023-05-05');

		await user.click(row);
		expect(
			screen.queryByRole('dialog', { name: /Log Platinum/ }),
		).not.toBeInTheDocument();
		expect(writes()).toHaveLength(0);
	});

	it('renders the five lifecycle dates as date inputs, empty when unrecorded', async () => {
		await openPanel(game({ startedOn: '2024-01-01', boughtOn: '2023-12-25' }));

		expect(screen.getByLabelText('Wishlisted')).toHaveValue('');
		expect(screen.getByLabelText('Bought')).toHaveValue('2023-12-25');
		expect(screen.getByLabelText('Started')).toHaveValue('2024-01-01');
		expect(screen.getByLabelText('Story completed')).toHaveValue('');
		expect(screen.getByLabelText('Platinum')).toHaveValue('');
	});

	it('links a wishlisted game to its persisted store URL', async () => {
		await openPanel(
			game({
				owned: false,
				wishlisted: true,
				storeUrl: 'https://store.playstation.com/product/BB',
			}),
		);

		const link = screen.getByRole('link', { name: 'View on PS Store' });
		expect(link).toHaveAttribute(
			'href',
			'https://store.playstation.com/product/BB',
		);
		expect(link).toHaveAttribute('target', '_blank');
		expect(link).toHaveAttribute('rel', 'noopener');
	});

	it('falls back to a store title search when no store URL is persisted', async () => {
		await openPanel(
			game({ owned: false, wishlisted: true, title: "Marvel's Spider-Man" }),
		);

		expect(
			screen.getByRole('link', { name: 'View on PS Store' }),
		).toHaveAttribute(
			'href',
			`https://store.playstation.com/search/${encodeURIComponent(
				"Marvel's Spider-Man",
			)}`,
		);
	});

	it('shows no store link for an owned game', async () => {
		await openPanel(game({ owned: true, ownershipType: 'physical' }));
		expect(
			screen.queryByRole('link', { name: 'View on PS Store' }),
		).not.toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Owned' })).toHaveAttribute(
			'aria-pressed',
			'true',
		);
	});

	it('uses the flip entry by default and the cross-fade under reduced motion', async () => {
		// jsdom has no matchMedia → the motion default (flip) applies.
		const user = await openPanel();
		expect(panel()).toHaveClass('detail-panel--flip');
		await user.keyboard('{Escape}');

		vi.stubGlobal(
			'matchMedia',
			vi.fn(() => ({ matches: true })),
		);
		await user.click(cover());
		expect(panel()).toHaveClass('detail-panel--fade');
		expect(panel()).not.toHaveClass('detail-panel--flip');
	});

	describe('ownership editing (Story 2.4)', () => {
		it('owning from the panel PATCHes the ownership route and toasts plainly', async () => {
			const user = await openPanel(
				game({ owned: false, wishlisted: true, ownershipType: null }),
			);

			const toggle = screen.getByRole('button', { name: 'Not owned' });
			expect(toggle).toHaveAttribute('aria-pressed', 'false');
			await user.click(toggle);

			await waitFor(() => expect(writes()).toHaveLength(1));
			const [url, init] = writes()[0];
			expect(url).toBe('/api/games/g1/ownership');
			expect(init).toMatchObject({ method: 'PATCH' });
			expect(JSON.parse(init.body)).toEqual({ owned: true });
			expect(await screen.findByTestId('toast')).toHaveTextContent(
				'Bloodborne — owned',
			);
			expect(
				screen.queryByRole('button', { name: 'Undo' }),
			).not.toBeInTheDocument();
		});

		it('un-owning carries an UNDO that restores flag and previous type', async () => {
			const user = await openPanel(
				game({ owned: true, ownershipType: 'physical' }),
			);
			await user.click(screen.getByRole('button', { name: 'Owned' }));

			await waitFor(() => expect(writes()).toHaveLength(1));
			expect(JSON.parse(writes()[0][1].body)).toEqual({
				owned: false,
			});

			const undo = await screen.findByRole('button', { name: 'Undo' });
			await user.click(undo);
			await waitFor(() => expect(writes()).toHaveLength(2));
			expect(JSON.parse(writes()[1][1].body)).toEqual({
				owned: true,
				ownershipType: 'physical',
			});
		});

		it('switches the ownership type through the segmented pair', async () => {
			const user = await openPanel(
				game({ owned: true, ownershipType: 'physical' }),
			);

			const group = screen.getByRole('group', {
				name: 'Ownership type for Bloodborne',
			});
			expect(
				within(group).getByRole('button', { name: 'physical' }),
			).toHaveAttribute('aria-pressed', 'true');

			await user.click(within(group).getByRole('button', { name: 'digital' }));
			await waitFor(() => expect(writes()).toHaveLength(1));
			expect(JSON.parse(writes()[0][1].body)).toEqual({
				ownershipType: 'digital',
			});
		});

		it('activating the already-set type writes nothing', async () => {
			const user = await openPanel(
				game({ owned: true, ownershipType: 'physical' }),
			);
			await user.click(screen.getByRole('button', { name: 'physical' }));
			expect(writes()).toHaveLength(0);
		});

		it('hides the type pair when the game is not owned', async () => {
			await openPanel(game({ owned: false, wishlisted: true }));
			expect(
				screen.queryByRole('group', { name: 'Ownership type for Bloodborne' }),
			).not.toBeInTheDocument();
		});
	});

	describe('date editing (Story 2.4)', () => {
		it('saving a date input PATCHes the dates route on blur, not per keystroke', async () => {
			await openPanel(game());

			const input = screen.getByLabelText('Started');
			// Segment-by-segment typing emits complete-but-wrong intermediates
			// (React onChange fires per input event) — none of them may PATCH.
			fireEvent.change(input, { target: { value: '0002-03-01' } });
			fireEvent.change(input, { target: { value: '2024-03-01' } });
			expect(writes()).toHaveLength(0);

			fireEvent.blur(input);

			await waitFor(() => expect(writes()).toHaveLength(1));
			const [url, init] = writes()[0];
			expect(url).toBe('/api/games/g1/dates');
			expect(init).toMatchObject({ method: 'PATCH' });
			expect(JSON.parse(init.body)).toEqual({ startedOn: '2024-03-01' });
			expect(await screen.findByTestId('toast')).toHaveTextContent(
				'Bloodborne — date saved',
			);
		});

		it('clearing a date input sends null for that field', async () => {
			await openPanel(game({ boughtOn: '2023-12-25' }));

			const input = screen.getByLabelText('Bought');
			fireEvent.change(input, { target: { value: '' } });
			fireEvent.blur(input);

			await waitFor(() => expect(writes()).toHaveLength(1));
			expect(JSON.parse(writes()[0][1].body)).toEqual({
				boughtOn: null,
			});
		});

		it('explains a 409 completion-invariant refusal on a date edit', async () => {
			fetchMock.mockResolvedValue({
				ok: false,
				status: 409,
				json: async () => ({ error: 'completion invariant' }),
			});
			await openPanel(
				game({
					playStatus: null,
					effectiveState: 'Story completed',
					hasCompleted: true,
					completedOn: '2024-06-01',
				}),
			);

			const input = screen.getByLabelText('Story completed');
			fireEvent.change(input, { target: { value: '' } });
			fireEvent.blur(input);

			expect(await screen.findByTestId('toast')).toHaveTextContent(
				/Can’t clear the last milestone of Bloodborne — set a play status first/,
			);
		});

		it('the focus trap counts the new form controls (shared selector)', async () => {
			const user = await openPanel(game({ owned: true }));

			// The shared boundary set includes every date input — no per-dialog drift.
			const focusables = Array.from(
				panel().querySelectorAll(FOCUSABLE_SELECTOR),
			);
			const inputs = Array.from(panel().querySelectorAll('input[type="date"]'));
			expect(inputs).toHaveLength(5);
			for (const input of inputs) {
				expect(focusables).toContain(input);
			}

			// Shift+Tab from the first focusable wraps to the last of that same set…
			expect(
				screen.getByRole('button', { name: 'Close details' }),
			).toHaveFocus();
			await user.tab({ shift: true });
			expect(focusables[focusables.length - 1]).toHaveFocus();
			// …and Tab from the last wraps forward across the inputs to the first.
			await user.tab();
			expect(
				screen.getByRole('button', { name: 'Close details' }),
			).toHaveFocus();
		});
	});

	describe('genre editing (Story 2.5)', () => {
		it('adds a genre via the input: POSTs the name and clears the input', async () => {
			const user = await openPanel(game());

			const input = screen.getByLabelText('Add genre to Bloodborne');
			await user.type(input, 'Roguelite');
			await user.click(screen.getByRole('button', { name: 'Add' }));

			await waitFor(() => expect(writes()).toHaveLength(1));
			const [url, init] = writes()[0];
			expect(url).toBe('/api/games/g1/genres');
			expect(init).toMatchObject({ method: 'POST' });
			expect(JSON.parse(init.body)).toEqual({ name: 'Roguelite' });
			expect(await screen.findByTestId('toast')).toHaveTextContent(
				'Bloodborne — Roguelite added',
			);
			await waitFor(() => expect(input).toHaveValue(''));
		});

		it('submits on Enter inside the input', async () => {
			const user = await openPanel(game());

			await user.type(
				screen.getByLabelText('Add genre to Bloodborne'),
				'Action{Enter}',
			);

			await waitFor(() => expect(writes()).toHaveLength(1));
			expect(JSON.parse(writes()[0][1].body)).toEqual({ name: 'Action' });
		});

		it('an empty input does not POST', async () => {
			const user = await openPanel(game());

			await user.click(screen.getByRole('button', { name: 'Add' }));

			expect(writes()).toHaveLength(0);
		});

		it('removes a genre from its chip: DELETEs the encoded name', async () => {
			const user = await openPanel(game({ genres: ['Open world', 'Action'] }));

			await user.click(
				screen.getByRole('button', { name: 'Remove Open world' }),
			);

			await waitFor(() => expect(writes()).toHaveLength(1));
			const [url, init] = writes()[0];
			expect(url).toBe('/api/games/g1/genres/Open%20world');
			expect(init).toMatchObject({ method: 'DELETE' });
			expect(await screen.findByTestId('toast')).toHaveTextContent(
				'Bloodborne — Open world removed',
			);
		});

		it('suggests the vocabulary through the datalist', async () => {
			await openPanel(game());

			const input = screen.getByLabelText('Add genre to Bloodborne');
			const datalist = document.getElementById(
				input.getAttribute('list') as string,
			);
			await waitFor(() => {
				const options = Array.from(
					datalist?.querySelectorAll('option') ?? [],
				).map((o) => o.value);
				expect(options).toEqual(['Action', 'Roguelite']);
			});
		});

		it('offers only add and remove — no merge/rename tool (FR-25)', async () => {
			await openPanel(game({ genres: ['Action'] }));

			const section = screen
				.getByRole('heading', { name: 'Genres' })
				.closest('section') as HTMLElement;
			const controls = within(section).getAllByRole('button');
			expect(
				controls.map((b) => b.getAttribute('aria-label') ?? b.textContent),
			).toEqual(['Remove Action', 'Add']);
		});
	});
});
