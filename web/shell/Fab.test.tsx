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
				added: [{ title: 'Astro Bot', viaMembership: true }],
				flipped: [{ title: 'Hollow Knight', viaMembership: false }],
				upgraded: [],
				skippedWebApps: 0,
				needsAttention: [],
			}),
			{ status: 200, headers: { 'content-type': 'application/json' } },
		),
	);

function renderFab(handedness: 'left' | 'right' = 'right') {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	const invalidate = vi.spyOn(client, 'invalidateQueries');
	const onSyncComplete = vi.fn();
	const onPsPlusCheckComplete = vi.fn();
	const onTrophySyncComplete = vi.fn();
	render(
		<QueryClientProvider client={client}>
			<ToastHost>
				<Fab
					onSyncComplete={onSyncComplete}
					onPsPlusCheckComplete={onPsPlusCheckComplete}
					onTrophySyncComplete={onTrophySyncComplete}
					handedness={handedness}
				/>
			</ToastHost>
		</QueryClientProvider>,
	);
	return {
		invalidate,
		onSyncComplete,
		onPsPlusCheckComplete,
		onTrophySyncComplete,
	};
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

	it('shows the trophy item with the shared platinum SVG and its text label, without the card testid', async () => {
		renderFab();
		await userEvent.click(screen.getByRole('button', { name: 'Chores' }));

		const trophyItem = screen.getByTestId('fab-trophy-sync');
		// The item carries the app's stroke-only trophy mark (the shared SVG).
		expect(trophyItem.querySelector('svg')).toBeInTheDocument();
		// But NOT the card's testid — only the card owns `platinum-trophy`, so a
		// full-app render never ends up with two of that id.
		expect(
			trophyItem.querySelector('[data-testid="platinum-trophy"]'),
		).toBeNull();
		// The text label is present (shown on every viewport, mobile included).
		expect(trophyItem).toHaveTextContent('Sync trophies');
	});

	it('shows a spinner while the sync runs, then hands the result to the summary and invalidates', async () => {
		const { release } = deferredFetch(okResult);
		const { invalidate, onSyncComplete } = renderFab();

		await userEvent.click(screen.getByRole('button', { name: 'Chores' }));
		await userEvent.click(screen.getByRole('button', { name: 'Sync library' }));

		// Pending: spinner up, item disabled (UX-DR10).
		expect(await screen.findByTestId('fab-sync-spinner')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Sync library' })).toBeDisabled();

		release();
		// The result goes to the summary modal (FR-37), not a toast.
		await waitFor(() =>
			expect(onSyncComplete).toHaveBeenCalledWith({
				added: [{ title: 'Astro Bot', viaMembership: true }],
				flipped: [{ title: 'Hollow Knight', viaMembership: false }],
				upgraded: [],
				skippedWebApps: 0,
				needsAttention: [],
			}),
		);
		expect(screen.queryByTestId('toast')).not.toBeInTheDocument();
		expect(invalidate).toHaveBeenCalledWith({ queryKey: ['shelf'] });
		expect(invalidate).toHaveBeenCalledWith({ queryKey: ['settings'] });
		// Drawer closed after settling.
		expect(screen.queryByTestId('fab-drawer')).not.toBeInTheDocument();
	});

	it('runs the PS+ Extra check with a spinner, hands the result over, and repaints the shelf', async () => {
		const { release } = deferredFetch(() =>
			Promise.resolve(
				new Response(
					JSON.stringify({
						flagged: ['Hades'],
						cleared: ['Bloodborne'],
						checked: 12,
						region: 'it-it',
					}),
					{ status: 200, headers: { 'content-type': 'application/json' } },
				),
			),
		);
		const { invalidate, onPsPlusCheckComplete } = renderFab();

		await userEvent.click(screen.getByRole('button', { name: 'Chores' }));
		await userEvent.click(
			screen.getByRole('button', { name: 'Check PS+ Extra' }),
		);

		expect(await screen.findByTestId('fab-psplus-spinner')).toBeInTheDocument();
		expect(
			screen.getByRole('button', { name: 'Check PS+ Extra' }),
		).toBeDisabled();

		release();
		await waitFor(() =>
			expect(onPsPlusCheckComplete).toHaveBeenCalledWith({
				flagged: ['Hades'],
				cleared: ['Bloodborne'],
				checked: 12,
				region: 'it-it',
			}),
		);
		// Flags feed playableNow — the shelf must re-derive.
		expect(invalidate).toHaveBeenCalledWith({ queryKey: ['shelf'] });
		expect(screen.queryByTestId('fab-drawer')).not.toBeInTheDocument();
	});

	it('runs the trophy sync with a spinner, hands the result over, and repaints the shelf (Story 9.2)', async () => {
		const { release, fetchMock } = deferredFetch(() =>
			Promise.resolve(
				new Response(
					JSON.stringify({
						updated: ['Ultimate Chicken Horse'],
						unmatched: ['Some Demo'],
						needsAttention: [],
					}),
					{ status: 200, headers: { 'content-type': 'application/json' } },
				),
			),
		);
		const { invalidate, onTrophySyncComplete } = renderFab();

		await userEvent.click(screen.getByRole('button', { name: 'Chores' }));
		await userEvent.click(screen.getByTestId('fab-trophy-sync'));

		expect(await screen.findByTestId('fab-trophy-spinner')).toBeInTheDocument();
		expect(screen.getByTestId('fab-trophy-sync')).toBeDisabled();

		release();
		await waitFor(() =>
			expect(onTrophySyncComplete).toHaveBeenCalledWith({
				updated: ['Ultimate Chicken Horse'],
				unmatched: ['Some Demo'],
				needsAttention: [],
			}),
		);
		expect(fetchMock).toHaveBeenCalledWith(
			'/api/sync/trophies',
			expect.objectContaining({ method: 'POST' }),
		);
		// The counts feed the card's %/grade — the shelf must re-derive.
		expect(invalidate).toHaveBeenCalledWith({ queryKey: ['shelf'] });
		expect(screen.queryByTestId('toast')).not.toBeInTheDocument();
	});

	it('a trophy sync rejected for an expired token toasts and refetches settings so the banner lights (hazard: no retry)', async () => {
		const { release, fetchMock } = deferredFetch(() =>
			Promise.resolve(
				new Response(JSON.stringify({ error: 'expired' }), { status: 401 }),
			),
		);
		const { invalidate } = renderFab();

		await userEvent.click(screen.getByRole('button', { name: 'Chores' }));
		await userEvent.click(screen.getByTestId('fab-trophy-sync'));
		release();

		await waitFor(() =>
			expect(screen.getByTestId('toast')).toHaveTextContent(
				/Trophy sync failed/,
			),
		);
		expect(invalidate).toHaveBeenCalledWith({ queryKey: ['settings'] });
		// One attempt — the client never re-fires a rejected credential.
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('a failed PS+ check toasts', async () => {
		const { release } = deferredFetch(() =>
			Promise.resolve(
				new Response(JSON.stringify({ error: 'nope' }), { status: 502 }),
			),
		);
		renderFab();

		await userEvent.click(screen.getByRole('button', { name: 'Chores' }));
		await userEvent.click(
			screen.getByRole('button', { name: 'Check PS+ Extra' }),
		);
		release();

		await waitFor(() =>
			expect(screen.getByTestId('toast')).toHaveTextContent(
				/PS\+ check failed/,
			),
		);
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

	it('Export CSV downloads the 200 body as a file (Story 6.3)', async () => {
		const { release, fetchMock } = deferredFetch(() =>
			Promise.resolve(
				new Response('Title\r\nHades', {
					status: 200,
					headers: { 'content-type': 'text/csv' },
				}),
			),
		);
		// jsdom lacks createObjectURL; the download rides a synthetic anchor click.
		const createObjectURL = vi.fn(() => 'blob:csv');
		URL.createObjectURL = createObjectURL;
		URL.revokeObjectURL = vi.fn();
		const click = vi
			.spyOn(HTMLAnchorElement.prototype, 'click')
			.mockImplementation(() => {});
		renderFab();

		await userEvent.click(screen.getByRole('button', { name: 'Chores' }));
		await userEvent.click(screen.getByTestId('fab-export'));
		release();

		await waitFor(() => expect(click).toHaveBeenCalled());
		expect(fetchMock).toHaveBeenCalledWith('/api/export.csv');
		expect(createObjectURL).toHaveBeenCalled();
		click.mockRestore();
	});

	it('a failed export toasts instead of saving the error body (Story 6.3)', async () => {
		const { release } = deferredFetch(() =>
			Promise.resolve(
				new Response(JSON.stringify({ error: 'unauthorized' }), {
					status: 401,
				}),
			),
		);
		renderFab();

		await userEvent.click(screen.getByRole('button', { name: 'Chores' }));
		await userEvent.click(screen.getByTestId('fab-export'));
		release();

		await waitFor(() =>
			expect(screen.getByTestId('toast')).toHaveTextContent(/Export failed/),
		);
	});

	it('places the FAB left-handed when handedness is left (UX-DR10)', () => {
		renderFab('left');
		expect(screen.getByTestId('fab')).toHaveClass('fab--left');
	});
});
