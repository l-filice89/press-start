import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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
		expect(readout).toHaveTextContent('PS+ CATALOG AS OF 2026-07-11');
		expect(readout).toHaveTextContent('PS+ 2026-07-11');
	});

	it('falls back to an em-dash in both spans when never refreshed', () => {
		render(<Header email="a@b.co" onSignOut={noop} psPlusRefreshedAt={null} />);
		const readout = screen.getByTestId('readout');
		expect(readout).toHaveTextContent('PS+ CATALOG AS OF —');
		expect(readout).toHaveTextContent('PS+ —');
	});
});
