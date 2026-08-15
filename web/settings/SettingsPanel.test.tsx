import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastHost } from '../components/Toast';
import { SettingsPanel } from './SettingsPanel';

/**
 * Settings panel (Story 4.1, stripped of the PSN credential surface by Epic 11
 * story 11.2): region, PS+ claims, CSV backup, About/Help — and nothing
 * credentialed or FAB-shaped renders at all.
 */

function mockFetch(settings: {
	region?: string;
	psPlusClaimCount?: number;
	igdbPlatforms?: string[];
}) {
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
			<ToastHost>
				<SettingsPanel onClose={onClose} />
			</ToastHost>
		</QueryClientProvider>,
	);
	return { client, onClose };
}

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

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
			'IGDB platforms',
			'PlayStation Plus',
			'Keep your own copy',
			'About & Help',
		]);
		expect(screen.queryByText(/token/i)).toBeNull();
	});

	it('loads defaults, requires one platform, saves selection, and invalidates searches', async () => {
		let saved: string[] | undefined;
		const fetchMock = vi.fn(
			async (url: string | URL | Request, init?: RequestInit) => {
				if (String(url).includes('/api/settings/igdb-platforms')) {
					saved = (JSON.parse(init?.body as string) as { platforms: string[] })
						.platforms;
					return {
						ok: true,
						status: 200,
						json: async () => ({ platforms: saved }),
					};
				}
				return {
					ok: true,
					status: 200,
					json: async () => ({ timezone: null, igdbPlatforms: saved }),
				};
			},
		);
		vi.stubGlobal('fetch', fetchMock);
		const { client } = renderPanel();
		const invalidate = vi.spyOn(client, 'invalidateQueries');

		for (const label of ['PS1', 'PS2', 'PS3', 'PS4', 'PS5']) {
			await waitFor(() =>
				expect(screen.getByRole('checkbox', { name: label })).toBeChecked(),
			);
		}
		for (const label of ['PSP', 'PS Vita', 'PSVR 1', 'PSVR 2']) {
			expect(screen.getByRole('checkbox', { name: label })).not.toBeChecked();
		}

		for (const label of ['PS1', 'PS2', 'PS3', 'PS4', 'PS5']) {
			await userEvent.click(screen.getByRole('checkbox', { name: label }));
		}
		expect(screen.getByTestId('save-igdb-platforms')).toBeDisabled();
		expect(screen.getByTestId('igdb-platforms-feedback')).toHaveTextContent(
			'Select at least one platform.',
		);

		await userEvent.click(screen.getByRole('checkbox', { name: 'PSVR 2' }));
		await userEvent.click(screen.getByTestId('save-igdb-platforms'));
		await waitFor(() =>
			expect(screen.getByTestId('igdb-platforms-feedback')).toHaveTextContent(
				'Platforms saved.',
			),
		);
		expect(saved).toEqual(['PSVR2']);
		expect(invalidate).toHaveBeenCalledWith({ queryKey: ['add-preview'] });
		expect(invalidate).toHaveBeenCalledWith({ queryKey: ['igdb-search'] });
		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
		expect(screen.getByRole('checkbox', { name: 'PSVR 2' })).toBeChecked();
		expect(screen.getByTestId('save-igdb-platforms')).toBeDisabled();
	});

	it('hydrates a saved non-default selection and disables editing before load', async () => {
		let finishLoad: ((value: unknown) => void) | undefined;
		const pendingLoad = new Promise((resolve) => {
			finishLoad = resolve;
		});
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => pendingLoad),
		);
		renderPanel();

		expect(
			screen.getByRole('group', { name: /Limit new IGDB/ }),
		).toBeDisabled();
		expect(screen.getByTestId('save-igdb-platforms')).toBeDisabled();
		finishLoad?.({
			ok: true,
			status: 200,
			json: async () => ({
				timezone: null,
				igdbPlatforms: ['PS4', 'PSVita'],
			}),
		});

		await waitFor(() =>
			expect(screen.getByRole('checkbox', { name: 'PS4' })).toBeChecked(),
		);
		expect(screen.getByRole('checkbox', { name: 'PS Vita' })).toBeChecked();
		expect(screen.getByRole('checkbox', { name: 'PS5' })).not.toBeChecked();
		expect(screen.getByTestId('save-igdb-platforms')).toBeDisabled();
	});

	it('keeps unsaved platform edits through a background settings refetch', async () => {
		let serverPlatforms = ['PS1', 'PS2', 'PS3', 'PS4', 'PS5'];
		const fetchMock = vi.fn(async () => ({
			ok: true,
			status: 200,
			json: async () => ({ timezone: null, igdbPlatforms: serverPlatforms }),
		}));
		vi.stubGlobal('fetch', fetchMock);
		const { client } = renderPanel();
		await waitFor(() =>
			expect(screen.getByRole('checkbox', { name: 'PS1' })).toBeChecked(),
		);

		await userEvent.click(screen.getByRole('checkbox', { name: 'PS1' }));
		serverPlatforms = ['PS5'];
		await client.invalidateQueries({ queryKey: ['settings'] });
		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
		expect(screen.getByRole('checkbox', { name: 'PS1' })).not.toBeChecked();
		expect(screen.getByRole('checkbox', { name: 'PS2' })).toBeChecked();
		expect(screen.getByTestId('save-igdb-platforms')).toBeEnabled();
	});

	it('disables the group while saving and preserves a failed selection for retry', async () => {
		let finishSave: ((value: unknown) => void) | undefined;
		let putCount = 0;
		const fetchMock = vi.fn(async (url: string | URL | Request) => {
			if (String(url).includes('/api/settings/igdb-platforms')) {
				putCount += 1;
				if (putCount === 1) {
					return new Promise((resolve) => {
						finishSave = resolve;
					});
				}
				return {
					ok: true,
					status: 200,
					json: async () => ({
						platforms: ['PS1', 'PS2', 'PS3', 'PS4', 'PS5', 'PSVR2'],
					}),
				};
			}
			return { ok: true, status: 200, json: async () => ({ timezone: null }) };
		});
		vi.stubGlobal('fetch', fetchMock);
		renderPanel();
		const psvr2 = screen.getByRole('checkbox', { name: 'PSVR 2' });
		await waitFor(() => expect(psvr2).toBeEnabled());
		await userEvent.click(psvr2);
		await userEvent.click(screen.getByTestId('save-igdb-platforms'));
		expect(
			screen.getByRole('group', { name: /Limit new IGDB/ }),
		).toBeDisabled();

		finishSave?.({
			ok: false,
			status: 503,
			json: async () => ({ error: 'unavailable' }),
		});
		await waitFor(() =>
			expect(screen.getByTestId('igdb-platforms-feedback')).toHaveTextContent(
				'Saving failed — try again.',
			),
		);
		expect(psvr2).toBeChecked();
		expect(screen.getByTestId('save-igdb-platforms')).toBeEnabled();

		await userEvent.click(screen.getByTestId('save-igdb-platforms'));
		await waitFor(() =>
			expect(screen.getByTestId('igdb-platforms-feedback')).toHaveTextContent(
				'Platforms saved.',
			),
		);
		expect(putCount).toBe(2);
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
			expect(screen.getByTestId('psn-region-feedback')).toHaveTextContent(
				'Region saved.',
			),
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

	it('exports a successful CSV with progress and the expected filename', async () => {
		let finishExport: ((value: unknown) => void) | undefined;
		const exportResponse = new Promise((resolve) => {
			finishExport = resolve;
		});
		const blob = new Blob(['title,status\nGame,Playing']);
		const fetchMock = vi.fn(async (url: string | URL | Request) => {
			if (String(url).includes('/api/export.csv')) return exportResponse;
			return {
				ok: true,
				status: 200,
				json: async () => ({ timezone: null }),
			};
		});
		vi.stubGlobal('fetch', fetchMock);
		const createObjectURL = vi.fn(() => 'blob:library');
		const revokeObjectURL = vi.fn();
		vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
		const click = vi
			.spyOn(HTMLAnchorElement.prototype, 'click')
			.mockImplementation(() => {});
		renderPanel();

		const button = await screen.findByTestId('settings-export');
		await userEvent.click(button);
		expect(button).toBeDisabled();
		expect(button).toHaveTextContent('Exporting…');
		expect(screen.getByText('Exporting your library.')).toHaveAttribute(
			'aria-live',
			'polite',
		);
		finishExport?.({
			ok: true,
			status: 200,
			headers: new Headers({ 'content-type': 'text/csv; charset=utf-8' }),
			blob: async () => blob,
		});

		await waitFor(() => expect(button).toHaveTextContent('Export CSV'));
		expect(createObjectURL).toHaveBeenCalledWith(blob);
		expect(click).toHaveBeenCalledTimes(1);
		await waitFor(
			() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:library'),
			{ timeout: 2_000 },
		);
		expect(
			fetchMock.mock.calls.some(([url]) =>
				String(url).includes('/api/export.csv'),
			),
		).toBe(true);
	});

	it('shows a retryable toast and saves nothing when export fails', async () => {
		const fetchMock = vi.fn(async (url: string | URL | Request) => {
			if (String(url).includes('/api/export.csv')) {
				return { ok: false, status: 503 };
			}
			return {
				ok: true,
				status: 200,
				json: async () => ({ timezone: null }),
			};
		});
		vi.stubGlobal('fetch', fetchMock);
		const createObjectURL = vi.fn();
		vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() });
		const click = vi
			.spyOn(HTMLAnchorElement.prototype, 'click')
			.mockImplementation(() => {});
		renderPanel();

		await userEvent.click(await screen.findByTestId('settings-export'));

		expect(
			await screen.findByText('Export failed — try again later.'),
		).toBeInTheDocument();
		expect(screen.getByTestId('settings-export')).toBeEnabled();
		expect(createObjectURL).not.toHaveBeenCalled();
		expect(click).not.toHaveBeenCalled();
	});

	it('rejects a successful response that is not CSV', async () => {
		const fetchMock = vi.fn(async (url: string | URL | Request) => {
			if (String(url).includes('/api/export.csv')) {
				return {
					ok: true,
					status: 200,
					headers: new Headers({ 'content-type': 'text/html' }),
					blob: async () => new Blob(['<html>sign in</html>']),
				};
			}
			return {
				ok: true,
				status: 200,
				json: async () => ({ timezone: null }),
			};
		});
		vi.stubGlobal('fetch', fetchMock);
		const createObjectURL = vi.fn();
		vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() });
		const click = vi
			.spyOn(HTMLAnchorElement.prototype, 'click')
			.mockImplementation(() => {});
		renderPanel();

		await userEvent.click(await screen.findByTestId('settings-export'));

		expect(
			await screen.findByText('Export failed — try again later.'),
		).toBeInTheDocument();
		expect(createObjectURL).not.toHaveBeenCalled();
		expect(click).not.toHaveBeenCalled();
	});

	it('shows a retryable toast and saves nothing when the export request rejects', async () => {
		const fetchMock = vi.fn(async (url: string | URL | Request) => {
			if (String(url).includes('/api/export.csv')) {
				throw new TypeError('network unavailable');
			}
			return {
				ok: true,
				status: 200,
				json: async () => ({ timezone: null }),
			};
		});
		vi.stubGlobal('fetch', fetchMock);
		const createObjectURL = vi.fn();
		vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() });
		const click = vi
			.spyOn(HTMLAnchorElement.prototype, 'click')
			.mockImplementation(() => {});
		renderPanel();

		await userEvent.click(await screen.findByTestId('settings-export'));

		expect(
			await screen.findByText('Export failed — try again later.'),
		).toBeInTheDocument();
		expect(screen.getByTestId('settings-export')).toBeEnabled();
		expect(createObjectURL).not.toHaveBeenCalled();
		expect(click).not.toHaveBeenCalled();
	});

	it('aborts an in-flight export when Settings closes', async () => {
		const fetchMock = vi.fn(
			async (url: string | URL | Request, init?: RequestInit) => {
				if (String(url).includes('/api/export.csv')) {
					return new Promise((_resolve, reject) => {
						init?.signal?.addEventListener('abort', () =>
							reject(new DOMException('aborted', 'AbortError')),
						);
					});
				}
				return {
					ok: true,
					status: 200,
					json: async () => ({ timezone: null }),
				};
			},
		);
		vi.stubGlobal('fetch', fetchMock);
		const { onClose } = renderPanel();

		await userEvent.click(await screen.findByTestId('settings-export'));
		await userEvent.click(screen.getByRole('button', { name: 'Close' }));

		expect(onClose).toHaveBeenCalledTimes(1);
		const exportCall = fetchMock.mock.calls.find(([url]) =>
			String(url).includes('/api/export.csv'),
		);
		expect(exportCall?.[1]?.signal?.aborted).toBe(true);
		expect(screen.queryByText('Export failed — try again later.')).toBeNull();
	});
});
