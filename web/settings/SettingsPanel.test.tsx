import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsPanel } from './SettingsPanel';

/**
 * Settings panel (Story 4.1, re-credentialed in 9.1b): the NPSSO field is never
 * prefilled with the stored secret, the instructions carry the ssocookie deep
 * link, and Save PUTs the pasted token. The no-echo guarantee is server-side
 * (integration tests); here we pin the client never even asks for the value.
 */

function mockFetch(settings: {
	psnNpssoSet: boolean;
	psnAuthExpired: boolean;
}) {
	const fetchMock = vi.fn(
		async (url: string | URL | Request, _init?: RequestInit) => {
			const href = String(url);
			if (href.includes('/api/settings/psn-npsso')) {
				return {
					ok: true,
					status: 200,
					json: async () => ({ psnNpssoSet: true, psnAuthExpired: false }),
				};
			}
			return {
				ok: true,
				status: 200,
				json: async () => ({ timezone: null, syncAttention: [], ...settings }),
			};
		},
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
	it('shows the ssocookie deep link and an always-empty token field', async () => {
		mockFetch({ psnNpssoSet: true, psnAuthExpired: false });
		renderPanel();

		expect(screen.getByRole('dialog')).toBeInTheDocument();
		// The token cannot be read from Sony cross-origin — the control is a plain
		// deep link the user copies the value from, opened in a new tab.
		const link = screen.getByTestId('psn-npsso-link');
		expect(link).toHaveAttribute(
			'href',
			'https://ca.account.sony.com/api/v1/ssocookie',
		);
		expect(link).toHaveAttribute('target', '_blank');
		expect(link).toHaveAttribute('rel', 'noreferrer');
		// Saved-token state is reported as presence only — the field stays empty.
		await waitFor(() =>
			expect(screen.getByTestId('psn-npsso-status')).toHaveTextContent(
				/A token is saved/,
			),
		);
		expect(screen.getByLabelText('PlayStation NPSSO token')).toHaveValue('');
	});

	it('saves the pasted token and never sends a GET for the stored value', async () => {
		const fetchMock = mockFetch({ psnNpssoSet: false, psnAuthExpired: true });
		renderPanel();

		const input = screen.getByLabelText('PlayStation NPSSO token');
		await userEvent.type(input, '  fresh-npsso  ');
		await userEvent.click(screen.getByRole('button', { name: 'Save token' }));

		await waitFor(() =>
			expect(screen.getByRole('status')).toHaveTextContent('Token saved.'),
		);
		const put = fetchMock.mock.calls.find(([url]) =>
			String(url).includes('/api/settings/psn-npsso'),
		);
		expect(put?.[1]).toMatchObject({ method: 'PUT' });
		// Whitespace-trimmed before sending; field cleared after save.
		expect(JSON.parse(put?.[1]?.body as string)).toEqual({
			npsso: 'fresh-npsso',
		});
		expect(input).toHaveValue('');
	});

	it('disables Save while the field is blank and closes via the Close button', async () => {
		mockFetch({ psnNpssoSet: false, psnAuthExpired: false });
		const { onClose } = renderPanel();

		expect(screen.getByRole('button', { name: 'Save token' })).toBeDisabled();
		await userEvent.click(screen.getByRole('button', { name: 'Close' }));
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	// Sign-out lives in the header alone (deferred-work triage 2026-07-13): the
	// panel offers About/Help and no second sign-out entry point.
	it('offers About/Help and no sign-out of its own (Story 6.3, FR-47)', async () => {
		mockFetch({ psnNpssoSet: false, psnAuthExpired: false });
		renderPanel();

		expect(screen.getByText(/About & Help/)).toBeInTheDocument();
		expect(screen.queryByTestId('settings-sign-out')).not.toBeInTheDocument();
	});

	it('cancel PS+ is inert with no claims (Story 6.4 AC4)', async () => {
		mockFetch({ psnNpssoSet: false, psnAuthExpired: false });
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
					json: async () => ({
						timezone: null,
						syncAttention: [],
						psnNpssoSet: false,
						psnAuthExpired: false,
						psPlusClaimCount: 3,
					}),
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

	it('toggles FAB handedness, PUTting the chosen side (Story 6.3, UX-DR10)', async () => {
		const fetchMock = mockFetch({ psnNpssoSet: false, psnAuthExpired: false });
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
