import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import type { ShelfGame } from './api';
import { Card } from './Card';

function game(overrides: Partial<ShelfGame> = {}): ShelfGame {
	return {
		id: 'g1',
		title: 'Bloodborne',
		coverUrl: 'https://cdn.example/bb.jpg',
		storeUrl: null,
		playStatus: 'Not started',
		effectiveState: 'Not started',
		owned: true,
		released: true,
		wishlisted: false,
		psPlusExtra: false,
		hasCompleted: false,
		hasPlatinum: false,
		releaseDate: '2015-03-24',
		genres: ['Action', 'RPG'],
		...overrides,
	};
}

/** The card's status pill is a mutation-bearing widget, so it needs a client. */
function Providers({ children }: { children: ReactNode }) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function renderCard(g: ShelfGame) {
	return render(<Card game={g} tabIndex={0} />, { wrapper: Providers });
}

describe('Card', () => {
	it('renders cover art, title, state pill, owned indicator, and genres', () => {
		renderCard(game());
		expect(screen.getByTestId('card-cover')).toHaveAttribute(
			'src',
			'https://cdn.example/bb.jpg',
		);
		expect(screen.getByText('Bloodborne')).toBeInTheDocument();
		expect(screen.getByTestId('state-pill')).toHaveTextContent('Not started');
		expect(screen.getByText('OWNED')).toBeInTheDocument();
		expect(screen.getByText('Action · RPG')).toBeInTheDocument();
	});

	it('shows a non-network cover fallback when no cover URL', () => {
		renderCard(game({ coverUrl: null }));
		expect(screen.queryByTestId('card-cover')).not.toBeInTheDocument();
	});

	it('adds the Playing bloom class only for a Playing card', () => {
		const { rerender } = renderCard(game({ effectiveState: 'Playing' }));
		expect(screen.getByTestId('shelf-card')).toHaveClass('card--playing');
		rerender(<Card game={game({ effectiveState: 'Paused' })} tabIndex={0} />);
		expect(screen.getByTestId('shelf-card')).not.toHaveClass('card--playing');
	});

	it('shows the platinum badge over the completed badge when both apply', () => {
		renderCard(
			game({
				hasCompleted: true,
				hasPlatinum: true,
				effectiveState: 'Playing',
			}),
		);
		expect(screen.getByText('Platinum achieved')).toBeInTheDocument();
		expect(screen.getByText('🏆')).toBeInTheDocument();
		expect(screen.queryByText('Story completed')).not.toBeInTheDocument();
	});

	it('shows a milestone badge on a live card (persists regardless of status)', () => {
		renderCard(game({ hasCompleted: true, effectiveState: 'Playing' }));
		expect(screen.getByText('Story completed')).toBeInTheDocument();
		expect(screen.getByText('✓')).toBeInTheDocument();
	});

	it('flags TBA when unreleased with no date, SOON with a future date', () => {
		const { rerender } = renderCard(
			game({ released: false, releaseDate: null }),
		);
		expect(screen.getByText('TBA')).toBeInTheDocument();
		rerender(
			<Card
				game={game({ released: false, releaseDate: '2999-01-01' })}
				tabIndex={0}
			/>,
		);
		expect(screen.getByText('SOON')).toBeInTheDocument();
	});

	it('shows the PS+ Extra badge only for an unowned in-catalog game', () => {
		renderCard(game({ psPlusExtra: true, owned: false, wishlisted: true }));
		expect(
			screen.getByText('In the PlayStation Plus Extra catalog'),
		).toBeInTheDocument();
	});
});
