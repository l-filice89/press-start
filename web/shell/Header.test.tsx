import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';
import { formatDisplayDate } from '../date';
import { SearchBox } from '../shelf/SearchBox';
import { Header } from './Header';

/**
 * Header freshness readout (Story 5.3): "PS+ CATALOG AS OF {date}" full + a
 * compact form, both fed the last successful refresh date; em-dash until the
 * first refresh. The full/compact swap itself is CSS (`@media`), untestable in
 * jsdom — here we assert both spans carry the date.
 */
const noop = () => {};

/**
 * Reads the live URL — path AND QUERY (review, H1b). It used to render
 * `location.pathname` alone, so the suite's own "a live ?q= does not follow you
 * across destinations" test could not observe a query string AT ALL: a
 * `toHaveTextContent('/catalog')` substring match is satisfied by
 * `/catalog?q=blood` too, and the test passed while the guarantee was broken.
 */
function LocationProbe() {
	const location = useLocation();
	return (
		<span data-testid="location">{`${location.pathname}${location.search}`}</span>
	);
}

const url = () => screen.getByTestId('location').textContent;

/** The header holds the destination toggle now, so it needs a router. */
function renderHeader(node: React.ReactElement, initialEntry = '/') {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return render(
		<QueryClientProvider client={client}>
			<MemoryRouter initialEntries={[initialEntry]}>
				{node}
				<LocationProbe />
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

describe('Header PS+ readout', () => {
	it('renders the refresh date in the full and compact readout', () => {
		renderHeader(
			<Header email="a@b.co" onSignOut={noop} psPlusRefreshedAt="2026-07-11" />,
		);
		const readout = screen.getByTestId('readout');
		// Rendered in the viewer's locale, not the raw ISO (so 2026-07-11 can't
		// read as 7 Nov). Assert against the same formatter, locale-independent.
		const shown = formatDisplayDate('2026-07-11');
		expect(shown).not.toBe('2026-07-11'); // guard: formatting actually happened
		expect(readout).toHaveTextContent(`PS+ CATALOG AS OF ${shown}`);
		expect(readout).toHaveTextContent(`PS+ ${shown}`);
	});

	it('falls back to an em-dash in both spans when never refreshed', () => {
		renderHeader(
			<Header email="a@b.co" onSignOut={noop} psPlusRefreshedAt={null} />,
		);
		const readout = screen.getByTestId('readout');
		expect(readout).toHaveTextContent('PS+ CATALOG AS OF —');
		expect(readout).toHaveTextContent('PS+ —');
	});
});

/**
 * The destination toggle (Story 7.2, AD-25): the app's ONE navigation control.
 * Real LINKS (review, L1 — ctrl/middle-click and "open in a new tab" must work
 * on the only way around the app), marked with `aria-current`, arrow-key
 * traversable, and the switch is a NAVIGATION to the bare path, which is what
 * clears a live `?q=`.
 */
describe('Header destination toggle', () => {
	it('marks the active destination and switches on click', async () => {
		const user = userEvent.setup();
		renderHeader(<Header email="a@b.co" onSignOut={noop} />);

		const shelf = screen.getByRole('link', { name: 'SHELF' });
		const catalog = screen.getByRole('link', { name: 'CATALOG' });
		expect(shelf).toHaveAttribute('aria-current', 'page');
		expect(catalog).not.toHaveAttribute('aria-current');
		// A real href — ctrl-click / middle-click / "open in new tab" all live here.
		expect(catalog).toHaveAttribute('href', '/catalog');

		await user.click(catalog);
		expect(url()).toBe('/catalog');
		expect(screen.getByRole('link', { name: 'CATALOG' })).toHaveAttribute(
			'aria-current',
			'page',
		);
	});

	it('a live ?q= does not follow you across destinations', async () => {
		const user = userEvent.setup();
		renderHeader(
			<Header email="a@b.co" onSignOut={noop} search={<SearchBox />} />,
			'/?q=blood',
		);

		await user.click(screen.getByRole('link', { name: 'CATALOG' }));
		// EXACTLY the bare path — no query at all. (A substring assertion here is
		// worthless: '/catalog?q=blood' contains '/catalog'.)
		expect(url()).toBe('/catalog');
		expect(
			screen.getByRole('searchbox', { name: 'Search the catalog' }),
		).toHaveValue('');
	});

	// HAZARD (review, H1): the switch that a human actually makes is the one right
	// after typing — INSIDE the 200ms debounce. The pending timer must die with the
	// destination it was typed on; if it survives, it writes the SHELF's term into
	// `/catalog?q=` and the story's central guarantee fails exactly when it counts.
	it('a term typed moments before the switch does not land on the next destination', async () => {
		const user = userEvent.setup();
		renderHeader(
			<Header email="a@b.co" onSignOut={noop} search={<SearchBox />} />,
			'/',
		);

		await user.type(
			screen.getByRole('searchbox', { name: 'Search your library' }),
			'blood',
		);
		// No pause — switch while the debounce is still pending.
		await user.click(screen.getByRole('link', { name: 'CATALOG' }));
		expect(url()).toBe('/catalog');

		// …and it stays gone once the old timer's window has passed.
		await new Promise((r) => setTimeout(r, 300));
		await waitFor(() => expect(url()).toBe('/catalog'));
		expect(
			screen.getByRole('searchbox', { name: 'Search the catalog' }),
		).toHaveValue('');
	});

	it('traverses with arrow keys (one tab stop, not two)', async () => {
		const user = userEvent.setup();
		renderHeader(<Header email="a@b.co" onSignOut={noop} />);

		screen.getByRole('link', { name: 'SHELF' }).focus();
		await user.keyboard('{ArrowRight}');
		expect(screen.getByRole('link', { name: 'CATALOG' })).toHaveFocus();
		expect(url()).toBe('/catalog');
	});

	it('keeps SHELF current on a routed detail (/game/:id is over the shelf)', () => {
		renderHeader(<Header email="a@b.co" onSignOut={noop} />, '/game/abc');
		expect(screen.getByRole('link', { name: 'SHELF' })).toHaveAttribute(
			'aria-current',
			'page',
		);
	});
});
