import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsPanel } from './SettingsPanel';

/**
 * Settings panel (Story 4.1): the cookie field is never prefilled with the
 * stored secret, the refresh instructions name the cookie to copy, and Save
 * PUTs the pasted value. The no-echo guarantee is server-side (integration
 * tests); here we pin the client never even asks for the value.
 */

function mockFetch(settings: {
	psnCookieSet: boolean;
	psnAuthExpired: boolean;
}) {
	const fetchMock = vi.fn(
		async (url: string | URL | Request, _init?: RequestInit) => {
			const href = String(url);
			if (href.includes('/api/settings/psn-cookie')) {
				return {
					ok: true,
					status: 200,
					json: async () => ({ psnCookieSet: true, psnAuthExpired: false }),
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
	return onClose;
}

afterEach(() => vi.unstubAllGlobals());

describe('SettingsPanel', () => {
	it('shows instructions naming the pdccws_p cookie, with an always-empty field', async () => {
		mockFetch({ psnCookieSet: true, psnAuthExpired: false });
		renderPanel();

		expect(screen.getByRole('dialog')).toBeInTheDocument();
		expect(screen.getByText(/pdccws_p/)).toBeInTheDocument();
		// Saved-cookie state is reported as presence only — the field stays empty.
		await waitFor(() =>
			expect(screen.getByTestId('psn-cookie-status')).toHaveTextContent(
				/A cookie is saved/,
			),
		);
		expect(screen.getByLabelText('PlayStation session cookie')).toHaveValue('');
	});

	it('saves the pasted cookie and never sends a GET for the stored value', async () => {
		const fetchMock = mockFetch({ psnCookieSet: false, psnAuthExpired: true });
		renderPanel();

		const input = screen.getByLabelText('PlayStation session cookie');
		await userEvent.type(input, '  fresh-cookie  ');
		await userEvent.click(screen.getByRole('button', { name: 'Save cookie' }));

		await waitFor(() =>
			expect(screen.getByRole('status')).toHaveTextContent('Cookie saved.'),
		);
		const put = fetchMock.mock.calls.find(([url]) =>
			String(url).includes('/api/settings/psn-cookie'),
		);
		expect(put?.[1]).toMatchObject({ method: 'PUT' });
		// Whitespace-trimmed before sending; field cleared after save.
		expect(JSON.parse(put?.[1]?.body as string)).toEqual({
			cookie: 'fresh-cookie',
		});
		expect(input).toHaveValue('');
	});

	it('disables Save while the field is blank and closes via the Close button', async () => {
		mockFetch({ psnCookieSet: false, psnAuthExpired: false });
		const onClose = renderPanel();

		expect(screen.getByRole('button', { name: 'Save cookie' })).toBeDisabled();
		await userEvent.click(screen.getByRole('button', { name: 'Close' }));
		expect(onClose).toHaveBeenCalledTimes(1);
	});
});
