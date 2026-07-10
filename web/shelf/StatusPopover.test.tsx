import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastHost } from '../components/Toast';
import type { ShelfGame } from './api';
import { StatusPopover } from './StatusPopover';

/**
 * The named a11y hazard of Story 2.1: the popover is a *menu* — haspopup/
 * expanded on the pill, `menuitemradio` rows checked off the RAW play status,
 * arrow traversal, and Escape returning focus to the pill. Plus the UNDO rule:
 * only `Dropped` (which hides the card) offers one.
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

function renderPopover(g: ShelfGame = game()) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	return render(
		<QueryClientProvider client={client}>
			<ToastHost>
				<StatusPopover game={g} />
			</ToastHost>
		</QueryClientProvider>,
	);
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
	fetchMock = vi.fn(async () => ({
		ok: true,
		status: 200,
		json: async () => ({ effectiveState: 'Playing' }),
	}));
	vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

const pill = () => screen.getByTestId('status-pill-button');

describe('StatusPopover', () => {
	it('exposes menu-button semantics on the pill', async () => {
		const user = userEvent.setup();
		renderPopover();
		expect(pill()).toHaveAttribute('aria-haspopup', 'menu');
		expect(pill()).toHaveAttribute('aria-expanded', 'false');

		await user.click(pill());
		expect(pill()).toHaveAttribute('aria-expanded', 'true');
		expect(screen.getByRole('menu')).toBeInTheDocument();
	});

	it('lists the five play statuses as radios, checked off the raw play status', async () => {
		const user = userEvent.setup();
		// A replay: effective state reads Playing, but the raw status is what the
		// menu must check.
		renderPopover(
			game({
				playStatus: 'Playing',
				effectiveState: 'Playing',
				hasCompleted: true,
			}),
		);
		await user.click(pill());

		const items = within(screen.getByRole('menu')).getAllByRole(
			'menuitemradio',
		);
		expect(items.map((i) => i.textContent)).toEqual([
			'Not started',
			'Up next',
			'Playing',
			'Paused',
			'Dropped',
		]);
		expect(
			items.filter((i) => i.getAttribute('aria-checked') === 'true'),
		).toHaveLength(1);
		expect(
			screen.getByRole('menuitemradio', { name: 'Playing' }),
		).toHaveAttribute('aria-checked', 'true');
	});

	it('focuses the checked row on open and traverses with arrow keys', async () => {
		const user = userEvent.setup();
		renderPopover(game({ playStatus: 'Up next', effectiveState: 'Up next' }));
		await user.click(pill());

		expect(
			screen.getByRole('menuitemradio', { name: 'Up next' }),
		).toHaveFocus();
		await user.keyboard('{ArrowDown}');
		expect(
			screen.getByRole('menuitemradio', { name: 'Playing' }),
		).toHaveFocus();
		await user.keyboard('{ArrowUp}');
		expect(
			screen.getByRole('menuitemradio', { name: 'Up next' }),
		).toHaveFocus();
		// End reaches past the radios into the milestone rows — one traversal
		// spans the whole menu.
		await user.keyboard('{End}');
		expect(
			screen.getByRole('menuitem', { name: 'Platinum achieved' }),
		).toHaveFocus();
		await user.keyboard('{Home}');
		expect(
			screen.getByRole('menuitemradio', { name: 'Not started' }),
		).toHaveFocus();
	});

	it('closes on Escape and returns focus to the pill', async () => {
		const user = userEvent.setup();
		renderPopover();
		await user.click(pill());
		await user.keyboard('{Escape}');

		expect(screen.queryByRole('menu')).not.toBeInTheDocument();
		expect(pill()).toHaveFocus();
	});

	it('applies the selected status once and toasts, with no confirm step', async () => {
		const user = userEvent.setup();
		renderPopover();
		await user.click(pill());
		await user.click(screen.getByRole('menuitemradio', { name: 'Playing' }));

		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('/api/games/g1/play-status');
		expect(init).toMatchObject({ method: 'PATCH' });
		expect(JSON.parse(init.body)).toEqual({ playStatus: 'Playing' });

		expect(await screen.findByTestId('toast')).toHaveTextContent(
			'Bloodborne — Playing',
		);
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
	});

	it('offers UNDO only for Dropped, and the undo restores the previous status', async () => {
		const user = userEvent.setup();
		renderPopover(game({ playStatus: 'Paused', effectiveState: 'Paused' }));
		await user.click(pill());
		await user.click(screen.getByRole('menuitemradio', { name: 'Dropped' }));

		const undo = await screen.findByRole('button', { name: 'Undo' });
		await user.click(undo);

		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
		expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
			playStatus: 'Paused',
		});
	});

	// HAZARD (Story 3.2, FR-2/FR-3): a revealed milestone-only card has a null
	// play status (auto-cleared). Dropping it must still offer UNDO, and the
	// undo restores the cleared (null) status through the same write path.
	it('offers UNDO for Dropped when the previous status was null, restoring null', async () => {
		const user = userEvent.setup();
		fetchMock.mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ effectiveState: 'Dropped' }),
		});
		renderPopover(
			game({
				playStatus: null,
				effectiveState: 'Story completed',
				hasCompleted: true,
				completedOn: '2024-01-01',
			}),
		);
		await user.click(pill());
		await user.click(screen.getByRole('menuitemradio', { name: 'Dropped' }));

		const undo = await screen.findByRole('button', { name: 'Undo' });
		await user.click(undo);

		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
		expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
			playStatus: null,
		});
	});

	it('surfaces a failed status change instead of silently doing nothing', async () => {
		const user = userEvent.setup();
		fetchMock.mockResolvedValue({
			ok: false,
			status: 500,
			json: async () => ({}),
		});
		renderPopover();
		await user.click(pill());
		await user.click(screen.getByRole('menuitemradio', { name: 'Playing' }));

		expect(await screen.findByTestId('toast')).toHaveTextContent(
			/Couldn’t update Bloodborne/,
		);
		// A write is never retried — one attempt, one message.
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('refuses a second selection while a write is in flight, and says so', async () => {
		const user = userEvent.setup();
		// The first PATCH never settles, so the mutation stays pending.
		fetchMock.mockReturnValue(new Promise(() => {}));
		renderPopover();

		await user.click(pill());
		await user.click(screen.getByRole('menuitemradio', { name: 'Playing' }));
		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

		await user.click(pill());
		await user.click(screen.getByRole('menuitemradio', { name: 'Paused' }));

		expect(await screen.findByTestId('toast')).toHaveTextContent(
			/Still saving Bloodborne/,
		);
		// The racing second write never left the client.
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('lists two milestone menuitem rows after a separator, seven rows total', async () => {
		const user = userEvent.setup();
		renderPopover();
		await user.click(pill());

		const menu = screen.getByRole('menu');
		expect(within(menu).getAllByRole('menuitemradio')).toHaveLength(5);
		const milestones = within(menu).getAllByRole('menuitem');
		expect(milestones.map((m) => m.textContent)).toEqual([
			'Story completed',
			'Platinum achieved',
		]);
		expect(within(menu).getByRole('separator')).toBeInTheDocument();
		// Actions, not statuses: never part of the radio group's checked state.
		for (const m of milestones) {
			expect(m).not.toHaveAttribute('aria-checked');
		}
	});

	it('gates a milestone behind the confirm dialog — no request before Confirm', async () => {
		const user = userEvent.setup();
		renderPopover();
		await user.click(pill());
		await user.click(screen.getByRole('menuitem', { name: 'Story completed' }));

		// Menu closed, dialog open, and NOTHING has been written yet (FR-7).
		expect(screen.queryByRole('menu')).not.toBeInTheDocument();
		expect(
			screen.getByRole('dialog', { name: /Log Story completed/ }),
		).toBeInTheDocument();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('confirming logs the milestone once and toasts without UNDO', async () => {
		const user = userEvent.setup();
		fetchMock.mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ effectiveState: 'Story completed' }),
		});
		renderPopover();
		await user.click(pill());
		await user.click(screen.getByRole('menuitem', { name: 'Story completed' }));
		await user.click(screen.getByRole('button', { name: 'Confirm' }));

		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('/api/games/g1/milestones');
		expect(init).toMatchObject({ method: 'POST' });
		expect(JSON.parse(init.body)).toEqual({ milestone: 'completed' });

		expect(await screen.findByTestId('toast')).toHaveTextContent(
			'Bloodborne — Story completed',
		);
		// Confirm-gated already: no UNDO on milestone toasts.
		expect(
			screen.queryByRole('button', { name: 'Undo' }),
		).not.toBeInTheDocument();
	});

	it('Escape on the dialog writes nothing and returns focus to the pill', async () => {
		const user = userEvent.setup();
		renderPopover();
		await user.click(pill());
		await user.click(
			screen.getByRole('menuitem', { name: 'Platinum achieved' }),
		);
		await user.keyboard('{Escape}');

		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
		expect(fetchMock).not.toHaveBeenCalled();
		expect(pill()).toHaveFocus();
	});

	it('Cancel writes nothing and returns focus to the pill', async () => {
		const user = userEvent.setup();
		renderPopover();
		await user.click(pill());
		await user.click(screen.getByRole('menuitem', { name: 'Story completed' }));
		await user.click(screen.getByRole('button', { name: 'Cancel' }));

		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
		expect(fetchMock).not.toHaveBeenCalled();
		expect(pill()).toHaveFocus();
	});

	it('renders an achieved milestone disabled with its date, and inert', async () => {
		const user = userEvent.setup();
		renderPopover(
			game({
				playStatus: 'Playing',
				effectiveState: 'Playing',
				hasCompleted: true,
				completedOn: '2023-05-05',
			}),
		);
		await user.click(pill());

		const row = screen.getByRole('menuitem', { name: /Story completed/ });
		expect(row).toHaveAttribute('aria-disabled', 'true');
		expect(row).toHaveTextContent('2023-05-05');

		// The first achievement stands: the row opens nothing and sends nothing —
		// but it is not a silent dead-end; activating it says why.
		await user.click(row);
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
		expect(fetchMock).not.toHaveBeenCalled();
		expect(await screen.findByTestId('toast')).toHaveTextContent(
			'Story completed already logged on 2023-05-05.',
		);
	});

	it('keeps the dialog open when a confirm races an in-flight write', async () => {
		const user = userEvent.setup();
		// A status PATCH that never settles keeps `isPending` true.
		fetchMock.mockReturnValue(new Promise(() => {}));
		renderPopover();

		await user.click(pill());
		await user.click(screen.getByRole('menuitemradio', { name: 'Playing' }));
		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

		await user.click(pill());
		await user.click(screen.getByRole('menuitem', { name: 'Story completed' }));
		await user.click(screen.getByRole('button', { name: 'Confirm' }));

		// The confirmed intent is NOT discarded: the dialog stays open so retrying
		// is one tap, and the refusal is spoken.
		expect(await screen.findByTestId('toast')).toHaveTextContent(
			/Still saving Bloodborne/,
		);
		expect(
			screen.getByRole('dialog', { name: /Log Story completed/ }),
		).toBeInTheDocument();
		// The milestone POST never left the client.
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('reaches the milestone rows by arrow traversal', async () => {
		const user = userEvent.setup();
		renderPopover(game({ playStatus: 'Dropped', effectiveState: 'Dropped' }));
		await user.click(pill());

		// From the checked last radio, ArrowDown crosses into the milestone rows…
		await user.keyboard('{ArrowDown}');
		expect(
			screen.getByRole('menuitem', { name: 'Story completed' }),
		).toHaveFocus();
		await user.keyboard('{ArrowDown}');
		expect(
			screen.getByRole('menuitem', { name: 'Platinum achieved' }),
		).toHaveFocus();
		// …and wraps back around to the first radio.
		await user.keyboard('{ArrowDown}');
		expect(
			screen.getByRole('menuitemradio', { name: 'Not started' }),
		).toHaveFocus();
	});

	it('does not offer UNDO for a non-hiding status', async () => {
		const user = userEvent.setup();
		renderPopover();
		await user.click(pill());
		await user.click(screen.getByRole('menuitemradio', { name: 'Paused' }));

		await screen.findByTestId('toast');
		expect(
			screen.queryByRole('button', { name: 'Undo' }),
		).not.toBeInTheDocument();
	});
});
