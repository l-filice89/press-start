import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
	it('renders the INSERT GAMES headline for the empty library', () => {
		render(<EmptyState variant="insert-games" />);
		expect(screen.getByText('INSERT GAMES')).toBeInTheDocument();
	});

	it('renders the NO MATCH headline for the no-match variant', () => {
		render(<EmptyState variant="no-match" />);
		expect(screen.getByText('NO MATCH')).toBeInTheDocument();
	});

	it('renders no action buttons when none are passed (no dead CTAs)', () => {
		render(<EmptyState variant="insert-games" />);
		expect(screen.queryByRole('button')).not.toBeInTheDocument();
	});

	it('renders and wires provided actions', async () => {
		const onClick = vi.fn();
		render(
			<EmptyState
				variant="insert-games"
				actions={[{ label: 'Sync library', onClick }]}
			/>,
		);
		await userEvent.click(screen.getByRole('button', { name: 'Sync library' }));
		expect(onClick).toHaveBeenCalledTimes(1);
	});
});
