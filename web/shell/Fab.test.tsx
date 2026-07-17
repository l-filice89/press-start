import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastHost } from '../components/Toast';
import { Fab } from './Fab';

/**
 * FAB drawer: open/close semantics, the export item's spinner-while-pending
 * (UX-DR10) and failure toast. The credentialed sync items were severed by
 * Epic 11 story 11.1, and the manual Check PS+ Extra by Story 8.4 (refreshes
 * are automatic) — the drawer carries exactly Export CSV, and on the catalog
 * (where export would mislead, UX sweep 2026-07-16) the whole FAB is gone: a
 * toggle over an empty drawer is worse than no button.
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

function renderFab(
	handedness: 'left' | 'right' = 'right',
	// The active destination decides whether the FAB renders at all — the entry
	// can carry a `background` state to mimic a detail overlay.
	initialEntry: string | { pathname: string; state?: unknown } = '/',
) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	const invalidate = vi.spyOn(client, 'invalidateQueries');
	render(
		<MemoryRouter initialEntries={[initialEntry]}>
			<QueryClientProvider client={client}>
				<ToastHost>
					<Fab handedness={handedness} />
				</ToastHost>
			</QueryClientProvider>
		</MemoryRouter>,
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
		expect(screen.getByTestId('fab-export')).toBeInTheDocument();

		await userEvent.keyboard('{Escape}');
		expect(screen.queryByTestId('fab-drawer')).not.toBeInTheDocument();
	});

	it('offers exactly Export CSV — no sync, trophy, or PS+ check control survives Epics 11/8.4', async () => {
		renderFab();
		await userEvent.click(screen.getByRole('button', { name: 'Chores' }));

		const drawer = screen.getByTestId('fab-drawer');
		const items = drawer.querySelectorAll('button');
		expect(items).toHaveLength(1);
		expect(screen.getByTestId('fab-export')).toBeInTheDocument();
		expect(screen.queryByTestId('fab-psplus-check')).not.toBeInTheDocument();
		expect(screen.queryByTestId('fab-sync')).not.toBeInTheDocument();
		expect(screen.queryByTestId('fab-trophy-sync')).not.toBeInTheDocument();
	});

	// Export CSV exports the LIBRARY (FR-49) — offering it while looking at the
	// catalog misleads (UX sweep 2026-07-16). With export the only chore left,
	// the whole FAB goes on the catalog.
	it('renders no FAB at all on the catalog', () => {
		renderFab('right', '/catalog');
		expect(screen.queryByTestId('fab')).not.toBeInTheDocument();
	});

	it('renders no FAB when a detail overlay sits over the catalog — the BACKGROUND is the active destination', () => {
		renderFab('right', {
			pathname: '/game/g1',
			state: { fromApp: true, background: { pathname: '/catalog' } },
		});
		expect(screen.queryByTestId('fab')).not.toBeInTheDocument();
	});

	it('keeps the FAB when a detail overlay sits over the SHELF', async () => {
		renderFab('right', {
			pathname: '/game/g1',
			state: { fromApp: true, background: { pathname: '/' } },
		});
		await userEvent.click(screen.getByRole('button', { name: 'Chores' }));
		expect(screen.getByTestId('fab-export')).toBeInTheDocument();
	});

	it('Export CSV downloads the 200 body as a file (Story 6.3)', async () => {
		const { release } = deferredFetch(() =>
			Promise.resolve(
				new Response('Title\nHades', {
					status: 200,
					headers: { 'Content-Type': 'text/csv' },
				}),
			),
		);
		const createUrl = vi.fn(() => 'blob:csv');
		const revokeUrl = vi.fn();
		vi.stubGlobal(
			'URL',
			Object.assign(Object.create(URL), {
				createObjectURL: createUrl,
				revokeObjectURL: revokeUrl,
			}),
		);
		const click = vi
			.spyOn(HTMLAnchorElement.prototype, 'click')
			.mockImplementation(() => {});

		renderFab();
		await userEvent.click(screen.getByRole('button', { name: 'Chores' }));
		await userEvent.click(screen.getByTestId('fab-export'));
		expect(screen.getByTestId('fab-export-spinner')).toBeInTheDocument();

		release();
		await waitFor(() => expect(click).toHaveBeenCalled());
		expect(createUrl).toHaveBeenCalled();
		expect(revokeUrl).toHaveBeenCalledWith('blob:csv');
		click.mockRestore();
	});

	it('a failed export toasts instead of saving the error body (Story 6.3)', async () => {
		const { release } = deferredFetch(() =>
			Promise.resolve(
				new Response('{"error":"unauthorized"}', { status: 401 }),
			),
		);
		const click = vi
			.spyOn(HTMLAnchorElement.prototype, 'click')
			.mockImplementation(() => {});

		renderFab();
		await userEvent.click(screen.getByRole('button', { name: 'Chores' }));
		await userEvent.click(screen.getByTestId('fab-export'));
		release();

		expect(
			await screen.findByText('Export failed — try again later.'),
		).toBeInTheDocument();
		expect(click).not.toHaveBeenCalled();
		click.mockRestore();
	});

	it('places the FAB left-handed when handedness is left (UX-DR10)', () => {
		renderFab('left');
		expect(screen.getByTestId('fab')).toHaveClass('fab--left');
	});
});
