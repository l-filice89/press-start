import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastHost } from '../components/Toast';
import { Fab } from './Fab';

/**
 * FAB drawer (Story 4.2): open/close semantics, the Sync item's
 * spinner-while-pending (UX-DR10), the result toast, and the query
 * invalidations that repaint the shelf and light the banner on failure.
 */

function deferredFetch(result: () => Promise<Response>) {
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const fetchMock = vi.fn(async () => {
		await gate;
		return result();
	});
	vi.stubGlobal('fetch', fetchMock);
	return { fetchMock, release };
}

const okResult = () =>
	Promise.resolve(
		new Response(
			JSON.stringify({
				added: 2,
				flipped: 1,
				skippedMembership: 3,
				needsAttention: [],
			}),
			{ status: 200, headers: { 'content-type': 'application/json' } },
		),
	);

function renderFab() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	const invalidate = vi.spyOn(client, 'invalidateQueries');
	render(
		<QueryClientProvider client={client}>
			<ToastHost>
				<Fab />
			</ToastHost>
		</QueryClientProvider>,
	);
	return { invalidate };
}

afterEach(() => vi.unstubAllGlobals());

describe('Fab', () => {
	it('opens on toggle, closes on Escape, and exposes aria-expanded', async () => {
		renderFab();
		const toggle = screen.getByRole('button', { name: 'Chores' });
		expect(toggle).toHaveAttribute('aria-expanded', 'false');
		expect(screen.queryByTestId('fab-drawer')).not.toBeInTheDocument();

		await userEvent.click(toggle);
		expect(toggle).toHaveAttribute('aria-expanded', 'true');
		expect(
			screen.getByRole('button', { name: 'Sync library' }),
		).toBeInTheDocument();

		await userEvent.keyboard('{Escape}');
		expect(screen.queryByTestId('fab-drawer')).not.toBeInTheDocument();
	});

	it('shows a spinner while the sync runs, then toasts the counts and invalidates the shelf', async () => {
		const { release } = deferredFetch(okResult);
		const { invalidate } = renderFab();

		await userEvent.click(screen.getByRole('button', { name: 'Chores' }));
		await userEvent.click(screen.getByRole('button', { name: 'Sync library' }));

		// Pending: spinner up, item disabled (UX-DR10).
		expect(await screen.findByTestId('fab-sync-spinner')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Sync library' })).toBeDisabled();

		release();
		await waitFor(() =>
			expect(screen.getByTestId('toast')).toHaveTextContent(
				'Sync complete: 2 added, 1 now owned, 3 membership entries skipped.',
			),
		);
		expect(invalidate).toHaveBeenCalledWith({ queryKey: ['shelf'] });
		expect(invalidate).toHaveBeenCalledWith({ queryKey: ['shelf-search'] });
		// Drawer closed after settling.
		expect(screen.queryByTestId('fab-drawer')).not.toBeInTheDocument();
	});

	it('a failed sync toasts and refetches settings so the banner can light', async () => {
		const { release } = deferredFetch(() =>
			Promise.resolve(
				new Response(JSON.stringify({ error: 'expired' }), { status: 401 }),
			),
		);
		const { invalidate } = renderFab();

		await userEvent.click(screen.getByRole('button', { name: 'Chores' }));
		await userEvent.click(screen.getByRole('button', { name: 'Sync library' }));
		release();

		await waitFor(() =>
			expect(screen.getByTestId('toast')).toHaveTextContent(/Sync failed/),
		);
		expect(invalidate).toHaveBeenCalledWith({ queryKey: ['settings'] });
	});
});
