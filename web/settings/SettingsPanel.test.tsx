import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsPanel } from './SettingsPanel';

/**
 * Settings panel (Story 4.1, stripped of the PSN credential surface by Epic 11
 * story 11.2): region, FAB placement, PS+ claims, About/Help — and nothing
 * credentialed renders at all.
 */

function mockFetch(settings: { region?: string; psPlusClaimCount?: number }) {
	const fetchMock = vi.fn(
		async (_url: string | URL | Request, _init?: RequestInit) => ({
			ok: true,
			status: 200,
			json: async () => ({ timezone: null, ...settings }),
		}),
	);
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

function renderPanel(onClose = vi.fn()) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	render(
		<QueryClientProvider client={client}>
			<SettingsPanel onClose={onClose} />
		</QueryClientProvider>,
	);
	return { onClose };
}

afterEach(() => vi.unstubAllGlobals());

describe('SettingsPanel', () => {
	it('renders NO credential surface — the PSN token section is gone (Epic 11, 11.2)', async () => {
		mockFetch({ region: 'it-it' });
		renderPanel();

		expect(screen.getByRole('dialog')).toBeInTheDocument();
		// The whole section list, exactly: nothing token-shaped survives.
		expect(
			screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent),
		).toEqual([
			'PlayStation region',
			'FAB placement',
			'PlayStation Plus',
			'About & Help',
		]);
		expect(screen.queryByText(/token/i)).toBeNull();
	});

	it('has no backfill panel — the credentialed surface is severed (Epic 11, 11.1)', async () => {
		mockFetch({});
		renderPanel();

		expect(screen.getByRole('dialog')).toBeInTheDocument();
		expect(screen.queryByTestId('backfill-platinum-dates')).toBeNull();
		expect(screen.queryByText(/backfill/i)).toBeNull();
	});

	it('closes via the Close button', async () => {
		mockFetch({});
		const { onClose } = renderPanel();

		await userEvent.click(screen.getByRole('button', { name: 'Close' }));
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	// Sign-out lives in the header alone (deferred-work triage 2026-07-13): the
	// panel offers About/Help and no second sign-out entry point.
	it('offers About/Help and no sign-out of its own (Story 6.3, FR-47)', async () => {
		mockFetch({});
		renderPanel();

		expect(screen.getByText(/About & Help/)).toBeInTheDocument();
		expect(screen.queryByTestId('settings-sign-out')).not.toBeInTheDocument();
	});

	it('cancel PS+ is inert with no claims (Story 6.4 AC4)', async () => {
		mockFetch({});
		renderPanel();
		await waitFor(() =>
			expect(screen.getByTestId('cancel-ps-plus')).toBeDisabled(),
		);
		expect(screen.getByTestId('cancel-ps-plus')).toHaveTextContent(
			'No PS+ claims',
		);
	});

	it('cancel PS+ names the count, confirms, and POSTs the un-own (Story 6.4 AC4)', async () => {
		const fetchMock = vi.fn(
			async (url: string | URL | Request, _init?: RequestInit) => {
				const href = String(url);
				if (href.includes('/api/settings/cancel-ps-plus')) {
					return { ok: true, status: 200, json: async () => ({ unowned: 3 }) };
				}
				return {
					ok: true,
					status: 200,
					json: async () => ({ timezone: null, psPlusClaimCount: 3 }),
				};
			},
		);
		vi.stubGlobal('fetch', fetchMock);
		renderPanel();

		// The claim count is named in the section copy (the button stays a plain
		// command); the confirm gate re-states it before acting.
		const cancel = await screen.findByTestId('cancel-ps-plus');
		await waitFor(() => expect(cancel).toHaveTextContent('I cancelled PS+'));
		expect(
			screen.getByText(/You have 3 games claimed with PS\+/),
		).toBeInTheDocument();
		await userEvent.click(cancel);

		// The confirm gate names the exact count before acting; nothing POSTed yet.
		expect(
			screen.getByRole('dialog', {
				name: /Un-own 3 games claimed with PS\+\?/,
			}),
		).toBeInTheDocument();
		expect(
			fetchMock.mock.calls.some(([u]) =>
				String(u).includes('/api/settings/cancel-ps-plus'),
			),
		).toBe(false);

		await userEvent.click(
			screen.getByRole('button', { name: 'Un-own claims' }),
		);
		await waitFor(() =>
			expect(
				fetchMock.mock.calls.find(([u]) =>
					String(u).includes('/api/settings/cancel-ps-plus'),
				)?.[1],
			).toMatchObject({ method: 'POST' }),
		);
	});

	it('PSN region: names the current region, or says none is set', async () => {
		mockFetch({ region: 'it-it' });
		renderPanel();
		await waitFor(() =>
			expect(screen.getByTestId('psn-region-status')).toHaveTextContent(
				'Your PS+ catalog region is it-it.',
			),
		);
	});

	it('PSN region: saves the normalized locale, ANNOUNCES the save, and guards a malformed one', async () => {
		// Region-aware mock: after the PUT, the refetched settings carry the saved
		// value — so the test can assert the status line reflects it (the panel's
		// authoritative confirmation, not just the transient "Region saved.").
		let saved: string | undefined;
		const fetchMock = vi.fn(
			async (url: string | URL | Request, init?: RequestInit) => {
				const href = String(url);
				if (href.includes('/api/settings/psn-region')) {
					saved = (JSON.parse(init?.body as string) as { region: string })
						.region;
					return {
						ok: true,
						status: 200,
						json: async () => ({ region: saved }),
					};
				}
				return {
					ok: true,
					status: 200,
					json: async () => ({
						timezone: null,
						...(saved ? { region: saved } : {}),
					}),
				};
			},
		);
		vi.stubGlobal('fetch', fetchMock);
		renderPanel();

		await waitFor(() =>
			expect(screen.getByTestId('psn-region-status')).toHaveTextContent(
				'No region set',
			),
		);

		// A malformed locale keeps Save inert and explains the shape.
		const input = screen.getByLabelText('PlayStation region');
		await userEvent.type(input, 'italy');
		expect(screen.getByTestId('save-psn-region')).toBeDisabled();
		expect(screen.getByTestId('psn-region-feedback')).toHaveTextContent(
			/Use a language-country store locale/,
		);

		// A valid one is normalized (trim + lowercase) before the PUT.
		await userEvent.clear(input);
		await userEvent.type(input, 'EN-US');
		await userEvent.click(screen.getByTestId('save-psn-region'));

		// The save feedback is a LIVE REGION (Epic 11 story 11.2 moved the
		// dialog's role="status" here when the token section died) — the a11y
		// announcement path, not just visible text.
		await waitFor(() =>
			expect(screen.getByRole('status')).toHaveTextContent('Region saved.'),
		);
		const put = fetchMock.mock.calls.find(([url]) =>
			String(url).includes('/api/settings/psn-region'),
		);
		expect(put?.[1]).toMatchObject({ method: 'PUT' });
		expect(JSON.parse(put?.[1]?.body as string)).toEqual({ region: 'en-us' });
		expect(input).toHaveValue('');
		// The invalidated settings refetch is what updates the status line — the
		// authoritative confirmation, beyond the mutation's own success text.
		await waitFor(() =>
			expect(screen.getByTestId('psn-region-status')).toHaveTextContent(
				'Your PS+ catalog region is en-us.',
			),
		);
	});

	it('toggles FAB handedness, PUTting the chosen side (Story 6.3, UX-DR10)', async () => {
		const fetchMock = mockFetch({});
		renderPanel();

		// Default right is pressed; picking left PUTs left.
		await waitFor(() =>
			expect(screen.getByTestId('handedness-right')).toHaveAttribute(
				'aria-pressed',
				'true',
			),
		);
		await userEvent.click(screen.getByTestId('handedness-left'));
		await waitFor(() =>
			expect(fetchMock).toHaveBeenCalledWith(
				'/api/settings/fab-handedness',
				expect.objectContaining({ method: 'PUT' }),
			),
		);
	});
});
