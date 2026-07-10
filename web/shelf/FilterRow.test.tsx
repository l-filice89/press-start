import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
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
) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return render(
		<QueryClientProvider client={client}>
			<FilterRow filter={filter} onChange={onChange} />
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

		expect(onChange).toHaveBeenCalledWith({ states: ['Playing'], genres: [] });
		// Multiselect: the menu stays open for further picks.
		expect(screen.getByRole('menu')).toBeInTheDocument();
	});

	it('an active group highlights its trigger with count and checked rows', async () => {
		const user = userEvent.setup();
		mockGenres([]);
		renderRow({ states: ['Playing', 'Paused'], genres: [] });

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
		const { rerender } = renderRow({ states: ['Playing'], genres: [] });
		expect(
			screen.getByRole('button', { name: 'State — 1 selected' }),
		).toBeInTheDocument();

		const client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		rerender(
			<QueryClientProvider client={client}>
				<FilterRow filter={EMPTY_FILTER} onChange={() => {}} />
			</QueryClientProvider>,
		);
		expect(screen.getByRole('button', { name: 'State' })).toBeInTheDocument();
	});

	it('a selected genre missing from the vocabulary stays listed so it can be untoggled', async () => {
		const user = userEvent.setup();
		mockGenres(['RPG']);
		renderRow({ states: [], genres: ['Ghost Genre'] });

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
