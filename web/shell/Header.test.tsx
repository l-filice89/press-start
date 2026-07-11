import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { formatDisplayDate } from '../date';
import { Header } from './Header';

/**
 * Header freshness readout (Story 5.3): "PS+ CATALOG AS OF {date}" full + a
 * compact form, both fed the last successful refresh date; em-dash until the
 * first refresh. The full/compact swap itself is CSS (`@media`), untestable in
 * jsdom — here we assert both spans carry the date.
 */
const noop = () => {};

describe('Header PS+ readout', () => {
	it('renders the refresh date in the full and compact readout', () => {
		render(
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
		render(<Header email="a@b.co" onSignOut={noop} psPlusRefreshedAt={null} />);
		const readout = screen.getByTestId('readout');
		expect(readout).toHaveTextContent('PS+ CATALOG AS OF —');
		expect(readout).toHaveTextContent('PS+ —');
	});
});
