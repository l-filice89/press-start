import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Skeleton, SkeletonGrid } from './Skeleton';

describe('Skeleton', () => {
	it('renders a decorative cover-shaped placeholder', () => {
		render(<Skeleton />);
		const el = screen.getByTestId('skeleton');
		expect(el).toHaveClass('skeleton', 'skeleton--cover');
		// Decorative: hidden from the a11y tree (the grid carries aria-busy).
		expect(el).toHaveAttribute('aria-hidden', 'true');
	});

	it('honors the variant', () => {
		render(<Skeleton variant="text" />);
		expect(screen.getByTestId('skeleton')).toHaveClass('skeleton--text');
	});

	it('SkeletonGrid is a single busy status region with N tiles', () => {
		render(<SkeletonGrid count={5} />);
		const grid = screen.getByTestId('skeleton-grid');
		expect(grid).toHaveAttribute('aria-busy', 'true');
		expect(grid).toHaveAttribute('role', 'status');
		expect(screen.getAllByTestId('skeleton')).toHaveLength(5);
	});
});
