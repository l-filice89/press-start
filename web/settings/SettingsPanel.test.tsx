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

	/**
	 * The platinum-date backfill trigger (Story 9.3). The fan-out is one PSN call
	 * per platinum title, so the endpoint is CHUNKED and the client is what loops
	 * it — the hazards live here: the loop must follow the cursor to the end, and
	 * it must STOP (never spin) whether or not every title could be dated.
	 */
	/**
	 * `chunks` are answered in order; an entry with a `status` FAILS that chunk
	 * (its `body` is the error body — a failed chunk still carries the `partial`
	 * report of what it wrote before it died).
	 */
	type Chunk = { status?: number; body: unknown };
	function mockBackfill(chunks: (Chunk | unknown)[], status = 200) {
		const queue = chunks.map((chunk) =>
			chunk && typeof chunk === 'object' && 'body' in chunk
				? (chunk as Chunk)
				: { status, body: chunk },
		);
		const fetchMock = vi.fn(async (url: string | URL) => {
			const href = String(url);
			if (href.includes('/api/backfill/platinum-dates')) {
				const next = queue.shift() ?? { status, body: { error: 'expired' } };
				const chunkStatus = next.status ?? 200;
				return {
					ok: chunkStatus === 200,
					status: chunkStatus,
					json: async () => next.body,
				};
			}
			return {
				ok: true,
				status: 200,
				json: async () => ({
					timezone: null,
					syncAttention: [],
					psnNpssoSet: true,
					psnAuthExpired: false,
				}),
			};
		});
		vi.stubGlobal('fetch', fetchMock);
		return fetchMock;
	}

	it('LOOPS the backfill on its cursor to the end and summarizes what was filled and skipped (hazard: one request cannot hold the fan-out)', async () => {
		const fetchMock = mockBackfill([
			{
				filled: [{ gameId: 'g1', title: 'Hades', date: '2026-07-07' }],
				skipped: [],
				nextCursor: 'game-20',
				hasTrophyData: true,
			},
			{
				filled: [{ gameId: 'g2', title: 'Tearaway', date: '2024-02-02' }],
				skipped: [
					{ title: 'Gone Title', reason: 'no trophy data', code: 'not-found' },
				],
				nextCursor: null,
				hasTrophyData: true,
			},
		]);
		renderPanel();

		await userEvent.click(screen.getByTestId('backfill-platinum-dates'));

		await waitFor(() =>
			expect(screen.getByTestId('backfill-summary')).toHaveTextContent(
				/Recovered 2 platinum dates; skipped 1 \(Gone Title — no trophy data\)/,
			),
		);
		// The second call carried the cursor the first one handed back — and the
		// loop stopped on the null cursor rather than re-asking forever.
		const calls = fetchMock.mock.calls.filter(([url]) =>
			String(url).includes('/api/backfill/platinum-dates'),
		);
		expect(calls).toHaveLength(2);
		expect(String(calls[0][0])).not.toContain('cursor=');
		expect(String(calls[1][0])).toContain('cursor=game-20');
		// The recovered dates land on the shelf.
		expect(screen.getByTestId('backfill-filled')).toHaveTextContent(
			'Hades — 2026-07-07',
		);
	});

	it('says so when there is nothing to recover (hazard: zero candidates must not read as a failure)', async () => {
		mockBackfill([
			{ filled: [], skipped: [], nextCursor: null, hasTrophyData: true },
		]);
		renderPanel();

		await userEvent.click(screen.getByTestId('backfill-platinum-dates'));
		await waitFor(() =>
			expect(screen.getByTestId('backfill-summary')).toHaveTextContent(
				/Nothing to recover/,
			),
		);
	});

	it('with NO trophy data at all, points at the trophy sync instead of claiming every platinum is dated (hazard: zero candidates has two very different meanings)', async () => {
		mockBackfill([
			{ filled: [], skipped: [], nextCursor: null, hasTrophyData: false },
		]);
		renderPanel();

		await userEvent.click(screen.getByTestId('backfill-platinum-dates'));
		await waitFor(() =>
			expect(screen.getByTestId('backfill-summary')).toHaveTextContent(
				/No trophy data yet — run the trophy sync first/,
			),
		);
	});

	it('an ALL-SKIP run says PlayStation had no record for any of them (hazard: a run that filled nothing must not read as a successful backfill)', async () => {
		mockBackfill([
			{
				filled: [],
				skipped: [
					{ title: 'A', reason: 'no trophy data', code: 'not-found' },
					{ title: 'B', reason: 'no trophy data', code: 'not-found' },
				],
				nextCursor: null,
				hasTrophyData: true,
			},
		]);
		renderPanel();

		await userEvent.click(screen.getByTestId('backfill-platinum-dates'));
		await waitFor(() =>
			expect(screen.getByTestId('backfill-summary')).toHaveTextContent(
				/PlayStation returned no trophy record for any of these 2 — the trophy sync may need re-running/,
			),
		);
	});

	it('a rejected token stops the loop and says to refresh it (hazard: never auto-retry an expired NPSSO)', async () => {
		const fetchMock = mockBackfill([], 401);
		renderPanel();

		await userEvent.click(screen.getByTestId('backfill-platinum-dates'));
		await waitFor(() =>
			expect(screen.getByTestId('backfill-summary')).toHaveTextContent(
				/PlayStation rejected the token/,
			),
		);
		expect(
			fetchMock.mock.calls.filter(([url]) =>
				String(url).includes('/api/backfill/platinum-dates'),
			),
		).toHaveLength(1);
		// The server persisted the expired flag — settings must be REFETCHED (the
		// initial load + one invalidation) or the banner stays dark until a reload.
		await waitFor(() =>
			expect(
				fetchMock.mock.calls.filter(([url]) => String(url) === '/api/settings')
					.length,
			).toBeGreaterThan(1),
		);
	});

	it('a token that expires MID-RUN still reports what was already recovered (hazard: 40 dates written and the summary says only "token rejected")', async () => {
		mockBackfill([
			{
				body: {
					filled: [{ gameId: 'g1', title: 'Hades', date: '2026-07-07' }],
					skipped: [],
					nextCursor: 'game-15',
					hasTrophyData: true,
				},
			},
			{
				status: 401,
				body: {
					error: 'expired',
					// The failed chunk wrote a row before it died — platinum_on is
					// write-once, so it stands and must be reported.
					partial: {
						filled: [{ gameId: 'g2', title: 'Tearaway', date: '2024-02-02' }],
						skipped: [],
						nextCursor: 'game-16',
						hasTrophyData: true,
					},
				},
			},
		]);
		renderPanel();

		await userEvent.click(screen.getByTestId('backfill-platinum-dates'));
		await waitFor(() =>
			expect(screen.getByTestId('backfill-summary')).toHaveTextContent(
				/PlayStation rejected the token.*already recovered 2 platinum dates \(kept\)/,
			),
		);
		// And they are named, not just counted.
		expect(screen.getByTestId('backfill-filled')).toHaveTextContent(
			'Hades — 2026-07-07',
		);
		expect(screen.getByTestId('backfill-filled')).toHaveTextContent(
			'Tearaway — 2024-02-02',
		);
	});

	it('refuses the run without a timezone and says to set one (hazard: a UTC-guessed date is permanent)', async () => {
		mockBackfill([], 409);
		renderPanel();

		await userEvent.click(screen.getByTestId('backfill-platinum-dates'));
		await waitFor(() =>
			expect(screen.getByTestId('backfill-summary')).toHaveTextContent(
				/Set your timezone first/,
			),
		);
	});

	it('says the run STOPPED EARLY when the chunk brake trips (hazard: a truncated run must not read as a complete one)', async () => {
		// Every chunk hands back a cursor — the brake is the only thing that stops
		// the loop, and the summary has to admit it.
		const fetchMock = mockBackfill(
			Array.from({ length: 45 }, (_, index) => ({
				filled: [
					{ gameId: `g${index}`, title: `Game ${index}`, date: '2026-01-01' },
				],
				skipped: [],
				nextCursor: `cursor-${index}`,
				hasTrophyData: true,
			})),
		);
		renderPanel();

		await userEvent.click(screen.getByTestId('backfill-platinum-dates'));
		await waitFor(() =>
			expect(screen.getByTestId('backfill-summary')).toHaveTextContent(
				/Stopped early — run it again to continue/,
			),
		);
		expect(
			fetchMock.mock.calls.filter(([url]) =>
				String(url).includes('/api/backfill/platinum-dates'),
			),
		).toHaveLength(40);
	});
});
