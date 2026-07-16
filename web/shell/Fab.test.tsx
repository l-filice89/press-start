import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastHost } from '../components/Toast';
import { Fab } from './Fab';

/**
 * FAB drawer: open/close semantics, the long-op items' spinner-while-pending
 * (UX-DR10), the result toast, and the query invalidations that repaint the
 * shelf. The credentialed sync items were severed by Epic 11 story 11.1 —
 * the drawer carries exactly Check PS+ Extra and Export CSV.
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
	// The active destination decides whether Export CSV is offered — the entry
	// can carry a `background` state to mimic a detail overlay.
	initialEntry: string | { pathname: string; state?: unknown } = '/',
) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	const invalidate = vi.spyOn(client, 'invalidateQueries');
	const onPsPlusCheckComplete = vi.fn();
	render(
		<MemoryRouter initialEntries={[initialEntry]}>
			<QueryClientProvider client={client}>
				<ToastHost>
					<Fab
						onPsPlusCheckComplete={onPsPlusCheckComplete}
						handedness={handedness}
					/>
				</ToastHost>
			</QueryClientProvider>
		</MemoryRouter>,
	);
	return { invalidate, onPsPlusCheckComplete };
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
			screen.getByRole('button', { name: 'Check PS+ Extra' }),
		).toBeInTheDocument();

		await userEvent.keyboard('{Escape}');
		expect(screen.queryByTestId('fab-drawer')).not.toBeInTheDocument();
	});

	it('on the shelf offers exactly Check PS+ Extra and Export CSV — no sync or trophy control survives Epic 11', async () => {
		renderFab();
		await userEvent.click(screen.getByRole('button', { name: 'Chores' }));

		const drawer = screen.getByTestId('fab-drawer');
		const items = drawer.querySelectorAll('button');
		expect(items).toHaveLength(2);
		expect(screen.getByTestId('fab-psplus-check')).toBeInTheDocument();
		expect(screen.getByTestId('fab-export')).toBeInTheDocument();
		expect(screen.queryByTestId('fab-sync')).not.toBeInTheDocument();
		expect(screen.queryByTestId('fab-trophy-sync')).not.toBeInTheDocument();
	});

	// Export CSV exports the LIBRARY (FR-49) — offering it while looking at the
	// catalog misleads (UX sweep 2026-07-16).
	it('hides Export CSV on the catalog — Check PS+ Extra remains', async () => {
		renderFab('right', '/catalog');
		await userEvent.click(screen.getByRole('button', { name: 'Chores' }));

		expect(screen.getByTestId('fab-psplus-check')).toBeInTheDocument();
		expect(screen.queryByTestId('fab-export')).not.toBeInTheDocument();
	});

	it('hides Export CSV when a detail overlay sits over the catalog — the BACKGROUND is the active destination', async () => {
		renderFab('right', {
			pathname: '/game/g1',
			state: { fromApp: true, background: { pathname: '/catalog' } },
		});
		await userEvent.click(screen.getByRole('button', { name: 'Chores' }));

		expect(screen.queryByTestId('fab-export')).not.toBeInTheDocument();
	});

	it('keeps Export CSV when a detail overlay sits over the SHELF', async () => {
		renderFab('right', {
			pathname: '/game/g1',
			state: { fromApp: true, background: { pathname: '/' } },
		});
		await userEvent.click(screen.getByRole('button', { name: 'Chores' }));

		expect(screen.getByTestId('fab-export')).toBeInTheDocument();
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

	it('a failed PS+ check toasts the SERVER message when it carries one', async () => {
		// A bad-region 409 names the actual fix — swallowing it into a generic
		// "try again later" sent a real user in a circle (uk-uk vs en-gb).
		const { release } = deferredFetch(() =>
			Promise.resolve(
				new Response(
					JSON.stringify({
						error: 'The PlayStation store did not recognize your region.',
					}),
					{ status: 409 },
				),
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
				/did not recognize your region/,
			),
		);
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
