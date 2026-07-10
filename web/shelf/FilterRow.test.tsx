import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FilterRow } from './FilterRow';
import { EMPTY_FILTER, type ShelfFilter } from './filters';

/** Serve the genre vocabulary from the `['genres']` query's endpoint. */
function mockGenres(genres: string[]) {
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => ({
			ok: true,
			status: 200,
			json: async () => ({ genres }),
		})),
	);
}

function renderRow(
	filter: ShelfFilter = EMPTY_FILTER,
	onChange: (next: ShelfFilter) => void = () => {},
	visibleCount = 5,
) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return render(
		<QueryClientProvider client={client}>
			<FilterRow
				filter={filter}
				onChange={onChange}
				visibleCount={visibleCount}
			/>
		</QueryClientProvider>,
	);
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('FilterRow', () => {
	it('State opens a multiselect of the four live statuses', async () => {
		const user = userEvent.setup();
		mockGenres([]);
		renderRow();

		await user.click(screen.getByRole('button', { name: 'State' }));

		const items = screen.getAllByRole('menuitemcheckbox');
		expect(items.map((i) => i.textContent)).toEqual([
			'Not started',
			'Up next',
			'Playing',
			'Paused',
		]);
		// Every row is a checkbox, unchecked by default — a multiselect, not radios.
		for (const item of items) {
			expect(item).toHaveAttribute('aria-checked', 'false');
		}
	});

	it('Genre opens a multiselect of the full vocabulary', async () => {
		const user = userEvent.setup();
		mockGenres(['Open world', 'RPG', 'Racing']);
		renderRow();

		await user.click(screen.getByRole('button', { name: 'Genre' }));

		const items = await screen.findAllByRole('menuitemcheckbox');
		expect(items.map((i) => i.textContent)).toEqual([
			'Open world',
			'RPG',
			'Racing',
		]);
	});

	it('toggling a row reports the new filter and keeps the menu open', async () => {
		const user = userEvent.setup();
		mockGenres([]);
		const onChange = vi.fn();
		renderRow(EMPTY_FILTER, onChange);

		await user.click(screen.getByRole('button', { name: 'State' }));
		await user.click(screen.getByRole('menuitemcheckbox', { name: 'Playing' }));

		expect(onChange).toHaveBeenCalledWith({
			...EMPTY_FILTER,
			states: ['Playing'],
		});
		// Multiselect: the menu stays open for further picks.
		expect(screen.getByRole('menu')).toBeInTheDocument();
	});

	it('an active group highlights its trigger with count and checked rows', async () => {
		const user = userEvent.setup();
		mockGenres([]);
		renderRow({ ...EMPTY_FILTER, states: ['Playing', 'Paused'] });

		const trigger = screen.getByRole('button', {
			name: 'State — 2 selected',
		});
		expect(trigger).toHaveAttribute('data-active');
		expect(trigger).toHaveTextContent('2');

		await user.click(trigger);
		expect(
			screen.getByRole('menuitemcheckbox', { name: 'Playing' }),
		).toHaveAttribute('aria-checked', 'true');
		expect(
			screen.getByRole('menuitemcheckbox', { name: 'Up next' }),
		).toHaveAttribute('aria-checked', 'false');
	});

	it('deactivating restores the plain accessible name', () => {
		mockGenres([]);
		const { rerender } = renderRow({ ...EMPTY_FILTER, states: ['Playing'] });
		expect(
			screen.getByRole('button', { name: 'State — 1 selected' }),
		).toBeInTheDocument();

		const client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		rerender(
			<QueryClientProvider client={client}>
				<FilterRow filter={EMPTY_FILTER} onChange={() => {}} visibleCount={5} />
			</QueryClientProvider>,
		);
		expect(screen.getByRole('button', { name: 'State' })).toBeInTheDocument();
	});

	it('a selected genre missing from the vocabulary stays listed so it can be untoggled', async () => {
		const user = userEvent.setup();
		mockGenres(['RPG']);
		renderRow({ ...EMPTY_FILTER, genres: ['Ghost Genre'] });

		await user.click(screen.getByRole('button', { name: /Genre/ }));
		const ghost = await screen.findByRole('menuitemcheckbox', {
			name: 'Ghost Genre',
		});
		expect(ghost).toHaveAttribute('aria-checked', 'true');
	});

	it('an empty genre menu shows an inert placeholder, and Escape on the trigger closes it', async () => {
		const user = userEvent.setup();
		mockGenres([]);
		renderRow();

		const trigger = screen.getByRole('button', { name: 'Genre' });
		await user.click(trigger);
		expect(screen.getByRole('menuitem')).toHaveAttribute(
			'aria-disabled',
			'true',
		);

		// No focusable row — Escape must still dismiss from the trigger.
		trigger.focus();
		await user.keyboard('{Escape}');
		expect(screen.queryByRole('menu')).not.toBeInTheDocument();
	});

	it('renders the four flag pills and three reveal pills with pressed state (Story 3.2)', async () => {
		const user = userEvent.setup();
		mockGenres([]);
		const onChange = vi.fn();
		renderRow({ ...EMPTY_FILTER, reveals: ['Dropped'] }, onChange);

		for (const label of ['Owned', 'Wishlisted', 'Released', 'Playable now']) {
			expect(screen.getByRole('button', { name: label })).toHaveAttribute(
				'aria-pressed',
				'false',
			);
		}
		// Solid vs dashed encoding is carried by the modifier class (UX-DR9).
		expect(screen.getByRole('button', { name: 'Owned' })).toHaveClass(
			'filter-row__pill--flag',
		);
		const dropped = screen.getByRole('button', {
			name: 'Show Dropped games',
		});
		expect(dropped).toHaveClass('filter-row__pill--reveal');
		// Active reveal pill: pressed + highlighted (FR-22).
		expect(dropped).toHaveAttribute('aria-pressed', 'true');
		expect(dropped).toHaveAttribute('data-active');

		await user.click(screen.getByRole('button', { name: 'Owned' }));
		expect(onChange).toHaveBeenCalledWith({
			...EMPTY_FILTER,
			reveals: ['Dropped'],
			flags: ['owned'],
		});
	});

	it('toggling a reveal pill reports it into the filter (FR-21)', async () => {
		const user = userEvent.setup();
		mockGenres([]);
		const onChange = vi.fn();
		renderRow(EMPTY_FILTER, onChange);

		await user.click(
			screen.getByRole('button', { name: 'Show Platinum achieved games' }),
		);
		expect(onChange).toHaveBeenCalledWith({
			...EMPTY_FILTER,
			reveals: ['Platinum achieved'],
		});
	});

	it('renders the live summary sentence with tinted literal connectors (Story 3.3)', () => {
		mockGenres([]);
		renderRow({
			...EMPTY_FILTER,
			states: ['Playing', 'Paused'],
			flags: ['owned'],
		});

		const summary = screen.getByTestId('filter-summary');
		expect(summary).toHaveTextContent(
			'Showing Playing or Paused, and Owned games.',
		);
		// Color is redundant to the words: the connector spans carry the tint class.
		expect(summary.querySelector('.filter-summary__or')).toHaveTextContent(
			'or',
		);
		expect(summary.querySelector('.filter-summary__and')).toHaveTextContent(
			'and',
		);
	});

	it('renders no summary while the filter is empty', () => {
		mockGenres([]);
		renderRow();
		expect(screen.queryByTestId('filter-summary')).not.toBeInTheDocument();
	});

	it('Filters button opens the grouped sheet; Show N games closes it (Story 3.3)', async () => {
		const user = userEvent.setup();
		mockGenres(['RPG']);
		const onChange = vi.fn();
		renderRow({ ...EMPTY_FILTER, states: ['Playing'] }, onChange, 3);

		const trigger = screen.getByRole('button', {
			name: 'Filters — 1 active',
		});
		expect(trigger).toHaveTextContent('1');
		await user.click(trigger);

		const sheet = screen.getByRole('dialog', { name: 'Filters' });
		// Groups are labeled with their logic (UX-DR26).
		expect(sheet).toHaveTextContent('State — any of (or)');
		expect(sheet).toHaveTextContent('Genre — any of (or)');
		expect(sheet).toHaveTextContent('Flags — all of (and)');
		expect(sheet).toHaveTextContent('Reveal hidden states — also show (or)');

		// Toggling inside the sheet drives the same filter state.
		const paused = within(sheet).getByRole('button', { name: 'Paused' });
		expect(
			within(sheet).getByRole('button', { name: 'Playing' }),
		).toHaveAttribute('aria-pressed', 'true');
		await user.click(paused);
		expect(onChange).toHaveBeenCalledWith({
			...EMPTY_FILTER,
			states: ['Playing', 'Paused'],
		});

		await user.click(
			within(sheet).getByRole('button', { name: 'Show 3 games' }),
		);
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
		expect(trigger).toHaveFocus();
	});

	it('the sheet traps Tab, including Shift+Tab from the just-focused container', async () => {
		const user = userEvent.setup();
		mockGenres([]);
		renderRow();

		await user.click(screen.getByRole('button', { name: 'Filters' }));
		const sheet = screen.getByRole('dialog', { name: 'Filters' });
		expect(sheet).toHaveFocus();

		// The hole ConfirmDialog avoids by focusing a button: Shift+Tab straight
		// off the container must stay inside the aria-modal dialog.
		await user.tab({ shift: true });
		expect(sheet.contains(document.activeElement)).toBe(true);
		await user.tab();
		expect(sheet.contains(document.activeElement)).toBe(true);
	});

	it('Escape closes the sheet and returns focus to the Filters button', async () => {
		const user = userEvent.setup();
		mockGenres([]);
		renderRow();

		const trigger = screen.getByRole('button', { name: 'Filters' });
		await user.click(trigger);
		expect(screen.getByRole('dialog', { name: 'Filters' })).toBeInTheDocument();

		await user.keyboard('{Escape}');
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
		expect(trigger).toHaveFocus();
	});

	it('supports keyboard traversal and Escape returns focus to the trigger', async () => {
		const user = userEvent.setup();
		mockGenres([]);
		renderRow();

		const trigger = screen.getByRole('button', { name: 'State' });
		trigger.focus();
		await user.keyboard('{ArrowDown}');

		expect(
			screen.getByRole('menuitemcheckbox', { name: 'Not started' }),
		).toHaveFocus();

		await user.keyboard('{ArrowDown}');
		expect(
			screen.getByRole('menuitemcheckbox', { name: 'Up next' }),
		).toHaveFocus();

		await user.keyboard('{End}');
		expect(
			screen.getByRole('menuitemcheckbox', { name: 'Paused' }),
		).toHaveFocus();

		await user.keyboard('{Escape}');
		expect(screen.queryByRole('menu')).not.toBeInTheDocument();
		expect(trigger).toHaveFocus();
	});
});
